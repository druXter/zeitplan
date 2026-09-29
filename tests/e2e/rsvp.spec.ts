import { expect, test, type Page } from '@playwright/test'
import {
  BASE_URL, cookieOf, createAccount, createEventRecord, createItemRecord, createTrackRecord, login, prisma, readForm, sha256,
  submitForm, SUMMER_DAY
} from './helpers'
import { RSVP_ORIGIN, rsvpRedirectUrl, sendRsvpChange, timelineLinkToken } from './rsvp-server'

// Zugang RSVP (Phase 7b, docs/KONZEPT.md Abschnitt 8) gegen das Test-Doppel von rsvp-app: Link-Token (Signatur,
// aud, exp, Verknüpfung), Gast-Sitzung mit rsvpId, Webhook bei Absage - jeweils mit Positivkontrolle.

const ZEITPLAN = new URL(BASE_URL).origin
const SECRET_TEXT = 'ZUSAGE-PUNKT-XYZ'
let counter = 0
/** Eine id im Format beider Seiten (cuid-artig: Kleinbuchstaben und Ziffern, 10-40 Zeichen). */
const cuid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(++counter).toString(36)}`.padEnd(12, '0').slice(0, 40)

async function rsvpEvent(options: { status?: 'PUBLISHED' | 'LIVE' | 'DRAFT'; access?: 'RSVP' | 'CODE' } = {}) {
  const owner = await createAccount('CREATOR')
  const rsvpEventId = cuid('termin')
  const created = await createEventRecord(owner.id, { status: options.status ?? 'PUBLISHED', access: options.access ?? 'RSVP', date: SUMMER_DAY, title: 'Hochzeit mit Zusage' })
  const event = await prisma.event.update({ where: { id: created.id }, data: { rsvpLink: { rsvpEventId } } })
  const track = await createTrackRecord(event.id)
  await createItemRecord(event, track.id, { title: SECRET_TEXT, start: '14:00', sortOrder: 1 })
  return { owner, event, rsvpEventId }
}

const guestCookie = async (page: Page, eventId: string) => (await page.context().cookies()).find(c => c.name === `__Host-guest-${eventId}`)
const apiStatus = async (page: Page, slug: string) => (await page.request.get(`/api/view/${slug}`, { headers: { cookie: await cookieOf(page) } })).status()

/** Öffnet den Zeitplan über "Zeitplan" in rsvp-app (Weiterleitung des Test-Doppels) und wartet auf die Ankunft. */
async function openViaRsvp(page: Page, eventId: string, rsvpEventId: string, rsvpId: string) {
  await page.goto(rsvpRedirectUrl(eventId, rsvpEventId, rsvpId))
  await page.waitForURL(url => url.origin === ZEITPLAN && !url.pathname.startsWith('/rsvp/'))
}

test('Zeitplan über die Zusage in rsvp-app: frischer Link ergibt eine Gast-Sitzung mit rsvpId, nur als Hash', async ({ page, request }) => {
  const { event, rsvpEventId } = await rsvpEvent()

  // Ohne Sitzung: kein Inhalt, auch nicht über den Endpunkt; Hinweis auf die Zusage.
  expect((await request.get(`/api/view/${event.slug}`)).status()).toBe(403)
  await page.goto(`/${event.slug}`)
  await expect(page.getByText('Den Ablauf öffnest du über deine Zusage')).toBeVisible()
  await expect(page.getByText(SECRET_TEXT)).toHaveCount(0)

  const rsvpId = cuid('zusage')
  await openViaRsvp(page, event.id, rsvpEventId, rsvpId)
  expect(page.url()).toBe(`${ZEITPLAN}/${event.slug}`)
  await expect(page.getByText(SECRET_TEXT)).toBeVisible()
  expect(await apiStatus(page, event.slug)).toBe(200)

  const cookie = await guestCookie(page, event.id)
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.secure).toBe(true)
  const sessions = await prisma.guestSession.findMany({ where: { eventId: event.id } })
  expect(sessions).toHaveLength(1)
  expect(sessions[0].rsvpId).toBe(rsvpId)
  expect(sessions[0].tokenHash).toBe(sha256(cookie!.value))

  // Erneuter Klick in rsvp-app ersetzt die Sitzung dieses Browsers, statt eine zweite anzulegen.
  await openViaRsvp(page, event.id, rsvpEventId, rsvpId)
  expect(await prisma.guestSession.count({ where: { eventId: event.id } })).toBe(1)

  // Einstieg und Fehlerseite: nicht zwischengespeichert, kein Referer (Token in der URL), nicht einbettbar.
  const entry = await request.get(`/rsvp/${event.id}?t=x`, { maxRedirects: 0 })
  expect(entry.status()).toBe(303)
  for (const headers of [entry.headers(), (await request.get('/rsvp?ungueltig=1')).headers()]) {
    expect(headers['referrer-policy']).toBe('no-referrer')
    expect(headers['cache-control']).toContain('no-store')
    expect(headers['x-frame-options']).toBe('DENY')
  }
})

test('Link-Token: falsche Signatur, Empfänger, Frist, Art oder Verknüpfung - keine Sitzung', async ({ page, browser }) => {
  const { event, rsvpEventId } = await rsvpEvent()
  const { event: other } = await rsvpEvent()
  const rsvpId = cuid('zusage')
  const base = { timelineEventId: event.id, rsvpEventId, rsvpId }
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000)

  const cases: Record<string, { path?: string; token: string }> = {
    'anderes Secret': { token: timelineLinkToken(ZEITPLAN, base, { secret: 'ein-ganz-anderes-secret-0123456789abcdef' }) },
    'anderer Empfänger': { token: timelineLinkToken(ZEITPLAN, { ...base, aud: RSVP_ORIGIN }) },
    abgelaufen: { token: timelineLinkToken(ZEITPLAN, base, { now: past }) },
    'zu lange gültig': { token: timelineLinkToken(ZEITPLAN, base, { ttlSeconds: 3 * 60 * 60 }) },
    'nicht verknüpfter Termin': { token: timelineLinkToken(ZEITPLAN, { ...base, rsvpEventId: cuid('fremd') }) },
    'anderes Event in der Adresse': { path: `/rsvp/${other.id}`, token: timelineLinkToken(ZEITPLAN, base) },
    'manipulierte Zusage': { token: (() => {
      const [payload, signature] = timelineLinkToken(ZEITPLAN, base).split('.')
      const changed = { ...JSON.parse(Buffer.from(payload, 'base64url').toString()), rsvpId: cuid('fremd') }
      return `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`
    })() }
  }
  for (const [label, { path, token }] of Object.entries(cases)) {
    const context = await browser.newContext()
    const guest = await context.newPage()
    await guest.goto(`${path ?? `/rsvp/${event.id}`}?t=${encodeURIComponent(token)}`)
    expect(new URL(guest.url()).pathname + new URL(guest.url()).search, label).toBe('/rsvp?ungueltig=1')
    await expect(guest.getByText('Dieser Link ist ungültig oder abgelaufen')).toBeVisible()
    expect(await guestCookie(guest, event.id), label).toBeUndefined()
    await context.close()
  }
  // Ein Webhook-Token (andere Art) öffnet keinen Zugang.
  const webhookAsLink = (await import('../../app/lib/rsvp/token')).createMessage(
    'rsvp-change', { aud: ZEITPLAN, ...base, attending: true }, (await import('./rsvp-server')).TEST_RSVP_TIMELINE_SECRET
  )
  await page.goto(`/rsvp/${event.id}?t=${encodeURIComponent(webhookAsLink)}`)
  expect(page.url()).toContain('/rsvp?ungueltig=1')
  expect(await prisma.guestSession.count({ where: { eventId: { in: [event.id, other.id] } } })).toBe(0)

  // Positivkontrolle: derselbe Aufbau mit gültigem Token wirkt.
  await page.goto(`/rsvp/${event.id}?t=${encodeURIComponent(timelineLinkToken(ZEITPLAN, base))}`)
  expect(page.url()).toBe(`${ZEITPLAN}/${event.slug}`)
  expect(await prisma.guestSession.count({ where: { eventId: event.id, rsvpId } })).toBe(1)
})

test('echter Link, aber Entwurf oder anderer Zugang: kein Inhalt, keine Sitzung', async ({ page }) => {
  const draft = await rsvpEvent({ status: 'DRAFT' })
  await openViaRsvp(page, draft.event.id, draft.rsvpEventId, cuid('zusage'))
  expect(page.url()).toBe(`${ZEITPLAN}/rsvp?ungueltig=1`)
  expect(await prisma.guestSession.count({ where: { eventId: draft.event.id } })).toBe(0)

  // Zugang per Code: Weiter zur Gästeansicht, dort fragt sie nach dem Code - die Zusage allein genügt nicht.
  const code = await rsvpEvent({ access: 'CODE' })
  await openViaRsvp(page, code.event.id, code.rsvpEventId, cuid('zusage'))
  expect(page.url()).toBe(`${ZEITPLAN}/${code.event.slug}`)
  await expect(page.getByText(SECRET_TEXT)).toHaveCount(0)
  expect(await prisma.guestSession.count({ where: { eventId: code.event.id } })).toBe(0)
})

test('Webhook: Absage beendet die Sitzungen genau dieser Zusage; ungültige Nachrichten wirken nicht', async ({ browser }) => {
  const { event, rsvpEventId } = await rsvpEvent()
  const anna = cuid('anna')
  const ben = cuid('ben')
  const annaPage = await (await browser.newContext()).newPage()
  const benPage = await (await browser.newContext()).newPage()
  await openViaRsvp(annaPage, event.id, rsvpEventId, anna)
  await openViaRsvp(benPage, event.id, rsvpEventId, ben)
  expect(await apiStatus(annaPage, event.slug)).toBe(200)
  expect(await apiStatus(benPage, event.slug)).toBe(200)
  const absage = { timelineEventId: event.id, rsvpEventId, rsvpId: anna, attending: false }

  // Ungültig: 401 ohne Wirkung.
  expect((await sendRsvpChange(ZEITPLAN, absage, { secret: 'ein-ganz-anderes-secret-0123456789abcdef' })).status).toBe(401)
  expect((await sendRsvpChange(ZEITPLAN, { ...absage, aud: RSVP_ORIGIN })).status).toBe(401)
  expect((await sendRsvpChange(ZEITPLAN, absage, { now: new Date(Date.now() - 2 * 60 * 60 * 1000) })).status).toBe(401)
  // Gültig, aber für einen anderen Termin: 200, ohne Wirkung (verrät nichts).
  expect((await sendRsvpChange(ZEITPLAN, { ...absage, rsvpEventId: cuid('fremd') })).status).toBe(200)
  // Zusage (attending true) legt nichts an und beendet nichts.
  expect((await sendRsvpChange(ZEITPLAN, { ...absage, attending: true })).status).toBe(200)
  // Eine alte Absage (vor dem Link ausgestellt, verspätet zugestellt) beendet den neueren Zugang nicht.
  expect((await sendRsvpChange(ZEITPLAN, absage, { now: new Date(Date.now() - 10 * 60 * 1000), ttlSeconds: 30 * 60 })).status).toBe(200)
  // Zu großer Body: 413.
  expect((await fetch(`${ZEITPLAN}/api/rsvp-webhook`, { method: 'POST', body: 'x'.repeat(6000) })).status).toBe(413)
  expect(await apiStatus(annaPage, event.slug)).toBe(200)

  // Positivkontrolle: die echte Absage beendet Annas Zugang - Bens bleibt.
  expect((await sendRsvpChange(ZEITPLAN, absage)).status).toBe(200)
  expect(await apiStatus(annaPage, event.slug)).toBe(403)
  expect(await prisma.guestSession.count({ where: { eventId: event.id, rsvpId: anna } })).toBe(0)
  expect(await apiStatus(benPage, event.slug)).toBe(200)
  // Die offene Seite verschwindet beim nächsten Abruf.
  await annaPage.reload()
  await expect(annaPage.getByText(SECRET_TEXT)).toHaveCount(0)

  // Nach erneuter Zusage kommt Anna über einen frischen Link wieder herein.
  await openViaRsvp(annaPage, event.id, rsvpEventId, anna)
  expect(await apiStatus(annaPage, event.slug)).toBe(200)
})

test('Verwaltung: Zugang RSVP mit Termin-id, Zeitplan-Link zum Eintragen; neuer Termin beendet alte Sitzungen', async ({ page, browser }) => {
  const { owner, event, rsvpEventId } = await rsvpEvent()
  const guest = await (await browser.newContext()).newPage()
  await openViaRsvp(guest, event.id, rsvpEventId, cuid('zusage'))
  expect(await apiStatus(guest, event.slug)).toBe(200)

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}`)
  await expect(page.getByLabel('Nur mit Zusage in rsvp-app')).toBeChecked()
  await expect(page.getByLabel('Termin in rsvp-app (id)')).toHaveValue(rsvpEventId)
  await expect(page.getByLabel('Zeitplan-Link – in rsvp-app beim Termin eintragen')).toHaveValue(`${ZEITPLAN}/rsvp/${event.id}`)

  // Ungültige id wird abgelehnt (am Browser vorbei, wie ein gefälschter POST).
  const form = await readForm(page, 'form:has(input[name="access"])')
  const rejected = await submitForm(page, form, { access: 'RSVP', rsvpEventId: 'Nicht Gültig!' })
  expect(await rejected.text()).toContain('Termin in rsvp-app: Bitte gib die id des Termins ein')
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).rsvpLink).toEqual({ rsvpEventId })
  expect(await apiStatus(guest, event.slug)).toBe(200)

  // Neuer Termin: Verknüpfung umgestellt, alte Zugänge enden, alte Links gelten nicht mehr.
  const next = cuid('neu')
  await page.getByLabel('Termin in rsvp-app (id)').fill(next)
  await page.getByRole('button', { name: 'Zugang speichern' }).click()
  await expect(page.getByText('Zugang gespeichert.')).toBeVisible()
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).rsvpLink).toEqual({ rsvpEventId: next })
  expect(await apiStatus(guest, event.slug)).toBe(403)
  await openViaRsvp(guest, event.id, rsvpEventId, cuid('zusage'))
  expect(guest.url()).toBe(`${ZEITPLAN}/rsvp?ungueltig=1`)
  await openViaRsvp(guest, event.id, next, cuid('zusage'))
  expect(await apiStatus(guest, event.slug)).toBe(200)

  // Moderator*in ändert den Zugang auch per nachgespieltem POST nicht.
  const moderator = await createAccount('MODERATOR')
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  const modPage = await (await browser.newContext()).newPage()
  await login(modPage, moderator.email)
  await submitForm(modPage, form, { access: 'RSVP', rsvpEventId: cuid('mod') })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).rsvpLink).toEqual({ rsvpEventId: next })
})
