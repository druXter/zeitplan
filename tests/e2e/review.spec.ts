import { expect, test } from '@playwright/test'
import {
  cookieOf, createAccount, createEventRecord, createItemRecord, createTrackRecord, locationOf, login, prisma, readForm, submitForm, SUMMER_DAY
} from './helpers'
import { zonedDateToUtc } from '../../app/lib/timezone'

// Rückblick (Idee L24): Plan gegen Ist, Protokollnotizen (Rückblick und live), CSV, Verlauf - auch als
// Dokumentation einer Sitzung. SECRET-Regel wie überall: ohne Eintrag nur Platzhalter, keine Notiz.

const MINUTE = 60_000

/** Ortszeit am Testtag (Sommer) als Zeitpunkt. */
const t = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(SUMMER_DAY.getTime() + (hours * 60 + minutes) * MINUTE)
}

/** Mitgliederversammlung nach dem Event: TOPs mit Ursprungsplan und Ist-Zeiten, ein Einschub, ein geheimer Punkt. */
async function meeting() {
  const owner = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const event = await createEventRecord(owner.id, { status: 'ENDED', date: SUMMER_DAY, title: 'Mitgliederversammlung' })
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  const track = await createTrackRecord(event.id, { name: 'Tagesordnung' })
  const top = async (title: string, start: string, durationMin: number, sortOrder: number, extra: Parameters<typeof createItemRecord>[2] extends infer O ? Partial<O> : never = {}) => {
    const created = await createItemRecord(event, track.id, { title, start, durationMin, sortOrder, ...extra })
    await prisma.item.update({ where: { id: created.id }, data: { originalStart: t(start), originalDurationMin: durationMin, originalSortOrder: sortOrder } })
    return created
  }
  const begruessung = await top('TOP 1 Begrüßung', '18:00', 10, 1, { actualStart: t('18:02'), actualEnd: t('18:12'), status: 'DONE' })
  const haushalt = await top('TOP 2 Haushalt', '18:10', 30, 2, { actualStart: t('18:12'), actualEnd: t('18:57'), status: 'DONE' })
  await top('TOP 3 Satzung', '18:40', 20, 3, { status: 'DEFERRED' })
  await top('TOP 4 Wahlen', '19:00', 15, 4, { status: 'CANCELLED', cancelReason: 'Kandidat*innen fehlen' })
  const geheim = await top('Ehrung Vorstand', '19:15', 10, 5, { actualStart: t('19:00'), actualEnd: t('19:10'), status: 'DONE', visibility: 'SECRET', secretViewers: [moderator.id] })
  await prisma.item.update({ where: { id: geheim.id }, data: { resultNote: 'GEHEIM-NOTIZ' } })
  await createItemRecord(event, track.id, { title: 'Dringlichkeitsantrag', start: t('18:57'), durationMin: 5, sortOrder: 6, actualStart: t('18:57'), actualEnd: t('19:00'), status: 'DONE' })
  await prisma.item.updateMany({ where: { eventId: event.id, title: 'Dringlichkeitsantrag' }, data: { insertedLive: true } })
  await prisma.liveAction.create({ data: { eventId: event.id, actorId: moderator.id, type: 'announce', itemId: null, before: { items: {} }, after: { items: {}, meta: { ids: [], text: 'Pause bis 19:30' } }, createdAt: t('18:58') } })
  return { owner, moderator, event, begruessung, haushalt, geheim }
}

test('Rückblick: Plan gegen Ist, Ausfall, Einschub, Verlauf - geheime Punkte ohne Eintrag nur als Platzhalter; CSV', async ({ page, browser, playwright }) => {
  const { owner, event } = await meeting()
  await page.setViewportSize({ width: 360, height: 800 })
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/rueckblick`)

  const haushalt = page.locator('[data-review-item]', { hasText: 'TOP 2 Haushalt' })
  await expect(haushalt).toContainText('18:10–18:40')
  await expect(haushalt).toContainText('18:12–18:57')
  await expect(haushalt).toContainText('Beginn +2 Min · Dauer +15 Min')
  await expect(page.locator('[data-review-item]', { hasText: 'Dringlichkeitsantrag' })).toContainText('Einschub')
  await expect(page.locator('[data-review-item]', { hasText: 'TOP 4 Wahlen' })).toContainText('Grund: Kandidat*innen fehlen')
  await expect(page.locator('[data-review-item]', { hasText: 'TOP 3 Satzung' })).toContainText('zurückgestellt, nicht nachgeholt')
  await expect(page.getByText('„TOP 2 Haushalt“ +15 Min')).toBeVisible()
  await expect(page.locator('[data-history]', { hasText: 'Durchsage: „Pause bis 19:30“' })).toHaveCount(1)

  // Geheimer Punkt ohne Eintrag: Zeiten ja, Titel und Notiz nein, kein Formular.
  const html = await page.content()
  expect(html).not.toContain('GEHEIM-NOTIZ')
  expect(html).not.toContain('Ehrung Vorstand')
  await expect(page.locator('[data-review-item]', { hasText: 'Geheimer Punkt' }).getByText('Protokollnotiz hinzufügen')).toHaveCount(0)

  // Am Handy kein seitliches Scrollen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)

  // CSV: für Konten mit Zugriff, mit derselben SECRET-Regel.
  const csv = await page.request.get(`/admin/events/${event.id}/rueckblick/csv`, { headers: { cookie: await cookieOf(page) } })
  expect(csv.status()).toBe(200)
  expect(csv.headers()['content-type']).toContain('text/csv')
  expect(csv.headers()['content-disposition']).toContain(`rueckblick-${event.slug}.csv`)
  const body = await csv.text()
  expect(body).toContain('2026-06-20 18:10;2026-06-20 18:40;30;2026-06-20 18:12;2026-06-20 18:57;45;2;15;Tagesordnung;TOP 2 Haushalt')
  expect(body).toContain('Geheimer Punkt')
  expect(body).not.toContain('GEHEIM-NOTIZ')
  expect(body).not.toContain('Ehrung Vorstand')

  const stranger = await createAccount('CREATOR')
  const strangerPage = await browser.newPage()
  await login(strangerPage, stranger.email)
  expect((await strangerPage.request.get(`/admin/events/${event.id}/rueckblick/csv`, { headers: { cookie: await cookieOf(strangerPage) } })).status()).toBe(404)
  const anonymous = await playwright.request.newContext({ baseURL: new URL(page.url()).origin })
  expect((await anonymous.get(`/admin/events/${event.id}/rueckblick/csv`)).status()).toBe(401)
  await anonymous.dispose()
})

test('Protokollnotiz: speichern im Rückblick, gleichzeitige Änderung abgelehnt, geheime nur für Eingetragene, fremde Konten wirkungslos', async ({ page, browser }) => {
  const { owner, moderator, event, begruessung, haushalt, geheim } = await meeting()
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/rueckblick`)

  const entry = page.locator('[data-review-item]', { hasText: 'TOP 2 Haushalt' })
  await entry.getByText('Protokollnotiz hinzufügen').click()
  await entry.getByLabel('Protokollnotiz zu „TOP 2 Haushalt“').fill('Haushalt angenommen (12/3/1)')
  await entry.getByRole('button', { name: 'Notiz speichern' }).click()
  await expect(page.getByText('Protokollnotiz gespeichert.')).toBeVisible()
  await expect(page.locator(`#item-${haushalt.id} [data-result-note]`)).toHaveText('Haushalt angenommen (12/3/1)')
  expect((await prisma.item.findUniqueOrThrow({ where: { id: haushalt.id } })).resultNote).toBe('Haushalt angenommen (12/3/1)')

  // Gleichzeitig geändert: Der zweite Stand überschreibt nicht.
  const form = await readForm(page, `form:has(input[name="itemId"][value="${begruessung.id}"])`)
  await prisma.item.update({ where: { id: begruessung.id }, data: { resultNote: 'Von woanders' } })
  const refused = await submitForm(page, form, { note: 'Meine Fassung' })
  expect(locationOf(refused)?.searchParams.get('noteError')).toBe('changed')
  expect((await prisma.item.findUniqueOrThrow({ where: { id: begruessung.id } })).resultNote).toBe('Von woanders')

  // Geheimer Punkt: Besitzer*in ohne Eintrag wirkungslos - die eingetragene Moderatorin schon (Positivkontrolle).
  await submitForm(page, form, { itemId: geheim.id, previous: 'GEHEIM-NOTIZ', note: 'Überschrieben' })
  expect((await prisma.item.findUniqueOrThrow({ where: { id: geheim.id } })).resultNote).toBe('GEHEIM-NOTIZ')
  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  await submitForm(modPage, form, { itemId: geheim.id, previous: 'GEHEIM-NOTIZ', note: 'Ehrung mit Blumen' })
  expect((await prisma.item.findUniqueOrThrow({ where: { id: geheim.id } })).resultNote).toBe('Ehrung mit Blumen')

  // Fremdes Konto: wirkungslos.
  const stranger = await createAccount('CREATOR')
  const strangerPage = await browser.newPage()
  await login(strangerPage, stranger.email)
  await submitForm(strangerPage, form, { previous: 'Von woanders', note: 'Von außen' })
  expect((await prisma.item.findUniqueOrThrow({ where: { id: begruessung.id } })).resultNote).toBe('Von woanders')
})

test('Protokollnotiz live beim laufenden Punkt - landet im Rückblick', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const today = zonedDateToUtc(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date()))!
  const event = await createEventRecord(owner.id, { status: 'LIVE', date: today, title: 'Sitzung' })
  const track = await createTrackRecord(event.id)
  const now = Date.now()
  const top = await createItemRecord(event, track.id, { title: 'TOP 1 Bericht', start: new Date(now - 5 * MINUTE), durationMin: 30, sortOrder: 1, actualStart: new Date(now - 5 * MINUTE), status: 'RUNNING' })
  await createItemRecord(event, track.id, { title: 'TOP 2 Wahlen', start: new Date(now + 25 * MINUTE), durationMin: 30, sortOrder: 2 })

  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/live`)
  await page.getByText('Protokollnotiz hinzufügen').click()
  await page.getByLabel('Protokollnotiz zu „TOP 1 Bericht“').fill('Bericht ohne Rückfragen angenommen')
  await page.getByRole('button', { name: 'Notiz speichern' }).click()
  await expect(page).toHaveURL(/\/live\?.*noted=1/)
  await expect(page.getByText('Protokollnotiz gespeichert.')).toBeVisible()
  expect((await prisma.item.findUniqueOrThrow({ where: { id: top.id } })).resultNote).toBe('Bericht ohne Rückfragen angenommen')

  await page.getByRole('link', { name: 'Rückblick' }).click()
  await expect(page.locator(`#item-${top.id} [data-result-note]`)).toHaveText('Bericht ohne Rückfragen angenommen')
  await expect(page.getByText('Das Event läuft noch')).toBeVisible()
})
