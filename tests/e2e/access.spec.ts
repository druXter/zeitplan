import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  BASE_URL, cookieOf, createAccount, createEventRecord, createItemRecord, createTrackRecord, locationOf, login, prisma, readForm,
  sha256, submitForm, SUMMER_DAY, throttleKey, uniqueIp, type ReplayableForm
} from './helpers'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { accessCodeHmac, displayToken } from '../../app/lib/guest/tokens'

// Zugang CODE und ACCOUNT, Gast-Sitzungen, Tafel-Link (Phase 5, docs/KONZEPT.md Abschnitt 6). Kern der Phase:
// Ohne gültigen Zugang gibt es keinen Inhalt - weder in HTML noch über den Polling-Endpunkt -, jeweils mit
// Positivkontrolle, dass derselbe Aufruf mit Zugang wirkt.

const CODE = 'K7QM-4XPA'
const SECRET_TEXT = 'GESCHUETZTER-PUNKT-XYZ'

async function protectedEvent(access: 'CODE' | 'ACCOUNT', options: { status?: 'PUBLISHED' | 'LIVE' | 'DRAFT' } = {}) {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: options.status ?? 'PUBLISHED', access, date: SUMMER_DAY, title: 'Geschützte Hochzeit' })
  if (access === 'CODE') await prisma.event.update({ where: { id: event.id }, data: { accessCodeHmac: accessCodeHmac(event.id, CODE) } })
  const track = await createTrackRecord(event.id)
  await createItemRecord(event, track.id, { title: SECRET_TEXT, start: '14:00', sortOrder: 1, location: 'GESCHUETZTER-ORT-XYZ' })
  return { owner, event: await prisma.event.findUniqueOrThrow({ where: { id: event.id } }) }
}

/** Alles, was ein Aufruf ohne Zugang bekommt: HTML und RSC-Daten von Seite und Tafel, dazu der Endpunkt. */
async function everything(request: APIRequestContext, slug: string, headers: Record<string, string> = {}, query = '') {
  const result: Record<string, { status: number; body: string }> = {}
  for (const path of [`/${slug}${query}`, `/${slug}/tafel${query}`]) {
    for (const [kind, extra] of [['HTML', {}], ['RSC', { RSC: '1' }]] as const) {
      const response = await request.get(path, { headers: { ...headers, ...extra } })
      result[`${path} (${kind})`] = { status: response.status(), body: await response.text() }
    }
  }
  const api = await request.get(`/api/view/${slug}${query}`, { headers })
  result[`/api/view/${slug}${query}`] = { status: api.status(), body: await api.text() }
  return result
}

function expectNoContent(responses: Record<string, { status: number; body: string }>, label: string) {
  for (const [source, { body }] of Object.entries(responses)) {
    expect(body, `${label}: ${source}`).not.toContain(SECRET_TEXT)
    expect(body, `${label}: ${source}`).not.toContain('GESCHUETZTER-ORT-XYZ')
  }
}

async function codeForm(page: Page, slug: string): Promise<ReplayableForm> {
  await page.goto(`/${slug}`)
  return readForm(page, 'form:has(input[name="code"])')
}

/** Code als Formular-POST (wie ein Browser ohne JavaScript) von einer bestimmten IP. */
async function attempt(page: Page, form: ReplayableForm, code: string, ip: string): Promise<'ok' | 'wrong' | 'locked'> {
  const response = await submitForm(page, form, { code }, { 'x-forwarded-for': ip })
  if (response.status() === 303) return 'ok'
  const body = await response.text()
  if (body.includes('Zu viele Versuche')) return 'locked'
  expect(body).toContain('Der Code stimmt nicht.')
  return 'wrong'
}

test('Zugangscode: ohne Sitzung kein Inhalt (auch nicht über den Endpunkt), mit richtigem Code Gast-Sitzung nur als Hash', async ({ page, request }) => {
  const { event } = await protectedEvent('CODE')

  const before = await everything(request, event.slug)
  expectNoContent(before, 'ohne Sitzung')
  expect(before[`/api/view/${event.slug}`].status).toBe(403)

  await page.goto(`/${event.slug}`)
  await expect(page.getByText('Dieser Ablauf ist nur mit Zugang sichtbar.')).toBeVisible()
  await page.getByLabel('Zugangscode').fill('FALSCHER-CODE')
  await page.getByRole('button', { name: 'Ablauf öffnen' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Der Code stimmt nicht.')
  await expect(page.getByText(SECRET_TEXT)).toHaveCount(0)

  // Richtiger Code - klein, mit Leerzeichen statt Bindestrich, wie ihn jemand abtippt.
  await page.getByLabel('Zugangscode').fill(' k7qm 4xpa ')
  await page.getByRole('button', { name: 'Ablauf öffnen' }).click()
  await expect(page.getByText(SECRET_TEXT)).toBeVisible()
  await expect(page.getByText('Vorschau:')).toHaveCount(0)
  await expect(page.getByLabel('Zugangscode')).toHaveCount(0)

  // Cookie pro Event, HttpOnly und Secure; in der Datenbank nur der Hash, gültig bis nach dem Eventende.
  const cookie = (await page.context().cookies()).find(c => c.name === `__Host-guest-${event.id}`)
  expect(cookie, 'Gast-Cookie').toBeDefined()
  expect(cookie!.httpOnly).toBe(true)
  expect(cookie!.secure).toBe(true)
  expect(cookie!.sameSite).toBe('Lax')
  const sessions = await prisma.guestSession.findMany({ where: { eventId: event.id } })
  expect(sessions).toHaveLength(1)
  expect(sessions[0].tokenHash).toBe(sha256(cookie!.value))
  expect(sessions[0].tokenHash).not.toContain(cookie!.value)
  expect(sessions[0].rsvpId).toBeNull()
  expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(SUMMER_DAY.getTime() + 24 * 60 * 60 * 1000)
  // Der Code selbst steht nirgends in der Datenbank.
  expect(JSON.stringify(await prisma.event.findUniqueOrThrow({ where: { id: event.id } }))).not.toMatch(/K7QM/i)

  // Positivkontrolle über den Endpunkt und die rohe Seite: mit Cookie 200 und Inhalt, nicht zwischengespeichert.
  const headers = { cookie: await cookieOf(page) }
  const api = await page.request.get(`/api/view/${event.slug}`, { headers })
  expect(api.status()).toBe(200)
  expect(await api.text()).toContain(SECRET_TEXT)
  const html = await page.request.get(`/${event.slug}`, { headers })
  expect(await html.text()).toContain(SECRET_TEXT)
  expect(html.headers()['cache-control']).toContain('no-store')

  // Die Sitzung gilt nur für dieses Event - nicht für ein anderes mit demselben Code.
  const { event: other } = await protectedEvent('CODE')
  expect((await page.request.get(`/api/view/${other.slug}`, { headers: { cookie: await cookieOf(page) } })).status()).toBe(403)

  // Ein gefälschtes Cookie hilft nicht.
  expect((await request.get(`/api/view/${event.slug}`, { headers: { cookie: `__Host-guest-${event.id}=erfunden` } })).status()).toBe(403)
})

test('Zugangscode: abgelaufene Sitzung und Wechsel des Zugangs beenden den Zugang', async ({ page }) => {
  const { event } = await protectedEvent('CODE')
  await page.goto(`/${event.slug}`)
  await page.getByLabel('Zugangscode').fill(CODE)
  await page.getByRole('button', { name: 'Ablauf öffnen' }).click()
  await expect(page.getByText(SECRET_TEXT)).toBeVisible()
  const view = async () => (await page.request.get(`/api/view/${event.slug}`, { headers: { cookie: await cookieOf(page) } })).status()
  expect(await view()).toBe(200)

  // Abgelaufen (in der Datenbank): kein Zugang mehr, auch wenn der Browser das Cookie noch hat.
  await prisma.guestSession.updateMany({ where: { eventId: event.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
  expect(await view()).toBe(403)
  await prisma.guestSession.updateMany({ where: { eventId: event.id }, data: { expiresAt: new Date(Date.now() + 60 * 60 * 1000) } })
  expect(await view()).toBe(200)

  // Zugang direkt in der Datenbank auf ACCOUNT und zurück: Code-Sitzungen gelten nur bei CODE.
  await prisma.event.update({ where: { id: event.id }, data: { access: 'ACCOUNT' } })
  expect(await view()).toBe(403)
  await prisma.event.update({ where: { id: event.id }, data: { access: 'CODE' } })
  expect(await view()).toBe(200)
})

test('Zugang in der Verwaltung: neuer Code beendet alte Sitzungen, nur Besitzer*in darf ihn ändern', async ({ page, browser }) => {
  const { owner, event } = await protectedEvent('CODE')
  const moderator = await createAccount('MODERATOR')
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })

  // Ein Gast mit gültiger Sitzung.
  const guest = await browser.newPage()
  await guest.goto(`/${event.slug}`)
  await guest.getByLabel('Zugangscode').fill(CODE)
  await guest.getByRole('button', { name: 'Ablauf öffnen' }).click()
  await expect(guest.getByText(SECRET_TEXT)).toBeVisible()
  const guestView = async () => (await guest.request.get(`/api/view/${event.slug}`, { headers: { cookie: await cookieOf(guest) } })).status()
  expect(await guestView()).toBe(200)

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}`)
  await expect(page.getByText('1 Gast-Zugang ist gerade aktiv.')).toBeVisible()
  const accessForm = await readForm(page, 'form:has(input[name="access"])')

  // Moderator*in: sieht den Abschnitt nicht, ein nachgespielter POST ändert nichts.
  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  await modPage.goto(`/admin/events/${event.id}`)
  await expect(modPage.getByRole('heading', { name: 'Zugang für Gäste' })).toHaveCount(0)
  await submitForm(modPage, accessForm, { access: 'CODE', code: 'MODERATION-CODE' })
  await submitForm(modPage, accessForm, { access: 'PUBLIC', code: '' })
  const unchanged = await prisma.event.findUniqueOrThrow({ where: { id: event.id } })
  expect(unchanged.access).toBe('CODE')
  expect(unchanged.accessCodeHmac).toBe(accessCodeHmac(event.id, CODE))
  expect(await guestView()).toBe(200)

  // Zu kurzer Code wird abgelehnt.
  await page.getByLabel('Neuer Zugangscode (optional)').fill('kurz')
  await page.getByRole('button', { name: 'Zugang speichern' }).click()
  await expect(page.getByText('Zugangscode: mindestens 8 Zeichen')).toBeVisible()

  // Vorschlag übernehmen und speichern: Der Code steht einmal in der Meldung, der alte Gast fliegt raus.
  await page.getByRole('button', { name: 'Vorschlag' }).click()
  const suggested = await page.getByLabel('Neuer Zugangscode (optional)').inputValue()
  expect(suggested).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  await page.getByRole('button', { name: 'Zugang speichern' }).click()
  await expect(page.getByText(`Der Zugangscode lautet „${suggested}“`)).toBeVisible()
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).accessCodeHmac).toBe(accessCodeHmac(event.id, suggested))
  expect(await prisma.guestSession.count({ where: { eventId: event.id } })).toBe(0)
  expect(await guestView()).toBe(403)
  await page.reload()
  await expect(page.getByText(suggested)).toHaveCount(0)

  // Der alte Code gilt nicht mehr, der neue schon.
  await guest.goto(`/${event.slug}`)
  await guest.getByLabel('Zugangscode').fill(CODE)
  await guest.getByRole('button', { name: 'Ablauf öffnen' }).click()
  await expect(guest.getByRole('main').getByRole('alert')).toContainText('Der Code stimmt nicht.')
  await guest.getByLabel('Zugangscode').fill(suggested)
  await guest.getByRole('button', { name: 'Ablauf öffnen' }).click()
  await expect(guest.getByText(SECRET_TEXT)).toBeVisible()

  // Positivkontrolle für den nachgespielten POST: als Besitzer*in wirkt er.
  await submitForm(page, accessForm, { access: 'PUBLIC', code: '' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).access).toBe('PUBLIC')
  expect(await prisma.guestSession.count({ where: { eventId: event.id } })).toBe(0)
  await guest.close()
  await modPage.close()
})

test('Code-Drosselung: 21. Fehlversuch pro IP gesperrt (auch mit richtigem Code), andere IP weiter möglich', async ({ page }) => {
  const { event } = await protectedEvent('CODE')
  const form = await codeForm(page, event.slug)
  const ip = uniqueIp()
  for (let i = 1; i <= 20; i++) expect(await attempt(page, form, `FALSCH-${i}-CODE`, ip), `Versuch ${i}`).toBe('wrong')
  expect(await attempt(page, form, CODE, ip)).toBe('locked')
  // Gespeichert wird nur der Hash von Bereich und IP.
  expect(await prisma.loginThrottle.findUnique({ where: { key: throttleKey('code:ip', ip) } })).not.toBeNull()

  // Positivkontrolle: dieselbe Anfrage von einer anderen IP wirkt - und zählt als Erfolg nicht mit.
  const eventCount = async () => (await prisma.loginThrottle.findUnique({ where: { key: throttleKey('code:event', event.id) } }))?.count
  const countBefore = await eventCount()
  const response = await submitForm(page, form, { code: CODE }, { 'x-forwarded-for': uniqueIp() })
  expect(response.status()).toBe(303)
  expect(locationOf(response)?.pathname).toBe(`/${event.slug}`)
  expect(response.headers()['set-cookie']).toContain(`__Host-guest-${event.id}=`)
  expect(await eventCount()).toBe(countBefore)
})

test('Code-Drosselung pro Event: nach 100 Fehlversuchen von verschiedenen IPs gesperrt, andere Events nicht', async ({ page }) => {
  const { event } = await protectedEvent('CODE')
  const { event: other } = await protectedEvent('CODE')
  const form = await codeForm(page, event.slug)
  for (let batch = 0; batch < 10; batch++) {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => attempt(page, form, `FALSCH-${batch}-${i}-X`, uniqueIp())))
    expect(results.every(result => result === 'wrong'), `Runde ${batch}`).toBe(true)
  }
  expect(await attempt(page, form, CODE, uniqueIp())).toBe('locked')

  const otherForm = await codeForm(page, other.slug)
  expect(await attempt(page, otherForm, CODE, uniqueIp())).toBe('ok')
})

test('Zugang ACCOUNT: ohne Anmeldung kein Inhalt, jedes angemeldete Konto sieht den Ablauf', async ({ page, request }) => {
  const { event } = await protectedEvent('ACCOUNT')
  const responses = await everything(request, event.slug)
  expectNoContent(responses, 'ohne Konto')
  expect(responses[`/api/view/${event.slug}`].status).toBe(403)

  await page.goto(`/${event.slug}`)
  await expect(page.getByText('Melde dich mit deinem Konto an')).toBeVisible()
  await expect(page.getByLabel('Zugangscode')).toHaveCount(0)

  // Anmelden führt zurück zum Ablauf - ein Konto ohne Freigabe fürs Event sieht ihn wie ein Gast.
  const stranger = await createAccount('MODERATOR')
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await page.getByRole('main').getByRole('link', { name: 'Anmelden' }).click()
  await page.getByLabel('E-Mail').fill(stranger.email)
  await page.getByLabel('Passwort').fill('ein sicheres Testpasswort')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page).toHaveURL(`${BASE_URL}/${event.slug}`)
  await expect(page.getByText(SECRET_TEXT)).toBeVisible()
  await expect(page.getByText('Vorschau:')).toHaveCount(0)
  expect((await page.request.get(`/api/view/${event.slug}`, { headers: { cookie: await cookieOf(page) } })).status()).toBe(200)

  // Entwürfe bleiben auch für angemeldete Konten ohne Freigabe verborgen.
  await prisma.event.update({ where: { id: event.id }, data: { status: 'DRAFT' } })
  expect((await page.request.get(`/api/view/${event.slug}`, { headers: { cookie: await cookieOf(page) } })).status()).toBe(404)
})

test('Tafel-Link: zeigt das geschützte Event ohne Anmeldung, alter Link nach Neuerzeugung ungültig', async ({ page, request, browser }) => {
  const { owner, event } = await protectedEvent('CODE', { status: 'LIVE' })
  // Die Tafel zeigt nur, was noch kommt - der Punkt liegt deshalb in einer Stunde.
  await prisma.item.updateMany({ where: { eventId: event.id }, data: { plannedStart: new Date(Date.now() + 60 * 60 * 1000) } })
  const moderator = await createAccount('MODERATOR')
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })

  // Ohne Schlüssel: nichts; ein falscher oder fremder Schlüssel hilft nicht.
  const { event: other } = await protectedEvent('CODE')
  for (const key of [null, 'erfunden', displayToken(other.id, 1)]) {
    const query = key === null ? '' : `?k=${encodeURIComponent(key)}`
    const responses = await everything(request, event.slug, {}, query)
    expectNoContent(responses, `Schlüssel ${key}`)
    expect(responses[`/api/view/${event.slug}${query}`].status).toBe(403)
  }

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}`)
  const link = await page.getByLabel('Link für die Anzeigetafel (Beamer, TV)').inputValue()
  const key = displayToken(event.id, 1)
  expect(link).toBe(`${BASE_URL}/${event.slug}/tafel?k=${key}`)

  // Mit Schlüssel: Tafel und Endpunkt zeigen den Ablauf (ohne Cookies), die Gästeansicht nicht.
  const board = await request.get(`/${event.slug}/tafel?k=${key}`)
  expect(await board.text()).toContain(SECRET_TEXT)
  expect(board.headers()['referrer-policy']).toBe('no-referrer')
  const api = await request.get(`/api/view/${event.slug}?k=${key}`)
  expect(api.status()).toBe(200)
  expect(await api.text()).toContain(SECRET_TEXT)
  expect(await (await request.get(`/${event.slug}?k=${key}`)).text()).not.toContain(SECRET_TEXT)

  // Die Tafel im Browser aktualisiert sich über den Endpunkt mit Schlüssel.
  const tv = await browser.newPage()
  await tv.clock.install()
  await tv.goto(link)
  await expect(tv.locator('[data-board]')).toContainText(SECRET_TEXT)
  await prisma.item.updateMany({ where: { eventId: event.id }, data: { title: 'NEUER-TITEL-XYZ' } })
  await tv.clock.fastForward(31_000)
  await expect(tv.locator('[data-board]')).toContainText('NEUER-TITEL-XYZ')

  // Moderator*in sieht den Link, darf ihn aber nicht neu erzeugen (auch nicht per nachgespieltem POST).
  const regenerate = await readForm(page, 'form:has(button:has-text("Neuen Tafel-Link erzeugen"))')
  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  await modPage.goto(`/admin/events/${event.id}`)
  await expect(modPage.getByLabel('Link für die Anzeigetafel (Beamer, TV)')).toHaveValue(link)
  await expect(modPage.getByRole('button', { name: 'Neuen Tafel-Link erzeugen' })).toHaveCount(0)
  await submitForm(modPage, regenerate)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).displayTokenVersion).toBe(1)

  // Besitzer*in erzeugt neu: Der alte Link zeigt nichts mehr - auch nicht der offenen Tafel.
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Neuen Tafel-Link erzeugen' }).click()
  await expect(page.getByText('Neuer Tafel-Link erzeugt.')).toBeVisible()
  const newLink = await page.getByLabel('Link für die Anzeigetafel (Beamer, TV)').inputValue()
  expect(newLink).not.toBe(link)
  expect((await request.get(`/api/view/${event.slug}?k=${key}`)).status()).toBe(403)
  expect(await (await request.get(`/${event.slug}/tafel?k=${key}`)).text()).not.toContain('NEUER-TITEL-XYZ')
  await tv.clock.fastForward(31_000)
  await expect(tv.locator('[data-board]')).toContainText('Dieser Ablauf ist gerade nicht verfügbar.')
  await expect(tv.locator('[data-board]')).not.toContainText('NEUER-TITEL-XYZ')
  // Positivkontrolle: der neue Link wirkt.
  expect(await (await request.get(newLink)).text()).toContain('NEUER-TITEL-XYZ')

  // Entwurf: auch mit gültigem Schlüssel 404.
  await prisma.event.update({ where: { id: event.id }, data: { status: 'DRAFT' } })
  expect((await request.get(newLink)).status()).toBe(404)
  await tv.close()
  await modPage.close()
})

test('Eingebettet: geschütztes Event verweist auf einen neuen Tab statt auf die Code-Eingabe', async ({ page }) => {
  const { event } = await protectedEvent('CODE')
  const html = `<!doctype html><title>Unsere Hochzeit</title><iframe name="gast" src="${BASE_URL}/${event.slug}" width="400" height="600"></iframe>`
  const server = createServer((_request, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
    const guest = page.frameLocator('iframe[name="gast"]')
    const open = guest.getByRole('link', { name: 'Ablauf in neuem Tab öffnen' })
    await expect(open).toHaveAttribute('target', '_blank')
    await expect(open).toHaveAttribute('href', `/${event.slug}`)
    await expect(guest.getByLabel('Zugangscode')).toHaveCount(0)
  } finally {
    server.close()
  }
})

test('Cron löscht abgelaufene Gast-Sitzungen, gültige bleiben', async ({ request }) => {
  const { event } = await protectedEvent('CODE')
  const expired = await prisma.guestSession.create({ data: { eventId: event.id, tokenHash: sha256(`abgelaufen-${event.id}`), expiresAt: new Date(Date.now() - 1000) } })
  const valid = await prisma.guestSession.create({ data: { eventId: event.id, tokenHash: sha256(`gueltig-${event.id}`), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } })
  const response = await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)
  expect(response.status()).toBe(200)
  expect((await response.json()).deletedGuestSessions).toBeGreaterThanOrEqual(1)
  expect(await prisma.guestSession.findUnique({ where: { id: expired.id } })).toBeNull()
  expect(await prisma.guestSession.findUnique({ where: { id: valid.id } })).not.toBeNull()
})
