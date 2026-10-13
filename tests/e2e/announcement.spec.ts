import { expect, test, type Page } from '@playwright/test'
import { createAccount, createEventRecord, createItemRecord, createTrackRecord, locationOf, login, prisma, readForm, submitForm } from './helpers'
import { zonedDateToUtc } from '../../app/lib/timezone'

// Durchsagen (Idee L15): aus der Live-Steuerung an Gästeansicht und Tafel - über den Polling-Endpunkt, mit
// Ablaufzeit, im Verlauf, nicht rückgängig zu machen. Angriffsfälle mit Positivkontrolle.

const MINUTE = 60_000
const TEXT = 'Bitte zum Gruppenfoto in den Garten'

function today(): Date {
  return zonedDateToUtc(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date()))!
}

async function setup(status: 'LIVE' | 'PUBLISHED' | 'DRAFT' | 'ENDED' = 'LIVE') {
  const owner = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const event = await createEventRecord(owner.id, { status, date: today(), title: 'Durchsagen-Fest' })
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  const track = await createTrackRecord(event.id)
  const now = Date.now()
  await createItemRecord(event, track.id, { title: 'Trauung', start: new Date(now - 10 * MINUTE), durationMin: 45, sortOrder: 1, actualStart: new Date(now - 10 * MINUTE), status: 'RUNNING' })
  await createItemRecord(event, track.id, { title: 'Sektempfang', start: new Date(now + 35 * MINUTE), durationMin: 30, sortOrder: 2 })
  return { owner, moderator, event }
}

async function guestJson(page: Page, slug: string) {
  const response = await page.request.get(`/api/view/${slug}`)
  expect(response.status()).toBe(200)
  return (await response.json()) as { announcement: { text: string; until: string | null } | null }
}

test('Durchsage am Handy veröffentlichen: Gästeansicht, Tafel und JSON zeigen sie, Verlauf ohne Rückgängig, Entfernen', async ({ page, browser }) => {
  const { moderator, event } = await setup()
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, moderator.email)
  await page.goto(`/admin/events/${event.id}/live`)

  await page.getByText('Durchsage an Gäste').click()
  await page.getByLabel('Text').fill(TEXT)
  await page.getByLabel('Anzeigen für').selectOption('15')
  const before = Date.now()
  await page.getByRole('button', { name: 'Durchsage veröffentlichen' }).click()
  await expect(page.getByText('Durchsage veröffentlicht')).toBeVisible()
  await expect(page.locator('[data-announcement]')).toContainText(TEXT)

  const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } })
  expect(stored.announcementText).toBe(TEXT)
  const until = stored.announcementUntil!.getTime() - stored.announcementAt!.getTime()
  expect(until).toBe(15 * MINUTE)
  expect(stored.announcementAt!.getTime()).toBeGreaterThanOrEqual(before - 5_000) // Serverzeit

  // Verlauf: Eintrag mit Text, aber kein Rückgängig dafür.
  const entry = page.locator('[data-history]', { hasText: `Durchsage: „${TEXT}“` })
  await expect(entry).toHaveCount(1)
  await expect(entry.getByRole('button', { name: 'Rückgängig' })).toHaveCount(0)

  // Gäste ohne Konto: Banner in Gästeansicht und Tafel, Text im JSON.
  const guest = await browser.newPage()
  await guest.goto(`/${event.slug}`)
  await expect(guest.locator('[data-announcement]')).toContainText(TEXT)
  await guest.goto(`/${event.slug}/tafel`)
  await expect(guest.locator('[data-board] [data-announcement]')).toContainText(TEXT)
  expect((await guestJson(guest, event.slug)).announcement?.text).toBe(TEXT)

  // Die offene Gästeansicht verliert sie nach dem Entfernen (nächste Abfrage).
  await guest.goto(`/${event.slug}`)
  await page.getByRole('button', { name: 'Durchsage entfernen' }).click()
  await expect(page.getByText('Durchsage entfernt.')).toBeVisible()
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).announcementText).toBeNull()
  expect((await guestJson(guest, event.slug)).announcement).toBeNull()
  await guest.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(guest.locator('[data-announcement]')).toHaveCount(0)
  await expect(page.locator('[data-history]', { hasText: 'Durchsage entfernt' })).toHaveCount(1)
})

test('Entfernen nennt die gemeinte Durchsage: eine inzwischen neuere bleibt stehen', async ({ page }) => {
  const { moderator, event } = await setup()
  await prisma.event.update({ where: { id: event.id }, data: { announcementText: 'Alte Durchsage', announcementAt: new Date(Date.now() - MINUTE) } })
  await login(page, moderator.email)
  await page.goto(`/admin/events/${event.id}/live`)
  const clear = await readForm(page, 'form:has(button:text("Durchsage entfernen"))')

  await prisma.event.update({ where: { id: event.id }, data: { announcementText: 'Neue Durchsage', announcementAt: new Date() } })
  const refused = await submitForm(page, clear)
  expect(locationOf(refused)?.searchParams.get('error')).toBe('announcement-changed')
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).announcementText).toBe('Neue Durchsage')

  // Positivkontrolle: das frisch gelesene Formular entfernt sie.
  await page.goto(`/admin/events/${event.id}/live`)
  await submitForm(page, await readForm(page, 'form:has(button:text("Durchsage entfernen"))'))
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).announcementText).toBeNull()
})

test('Abgelaufen, beendet oder Entwurf: keine Durchsage für Gäste; fremde Konten und gesperrte Events können keine setzen', async ({ page, browser }) => {
  const { owner, event } = await setup('PUBLISHED')
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/live`)
  const set = await readForm(page, 'form:has(button:text("Durchsage veröffentlichen"))')

  // Fremdes Konto: wirkungslos. Positivkontrolle: derselbe POST als Besitzer*in (auch schon bei "veröffentlicht").
  const stranger = await createAccount('CREATOR')
  const strangerPage = await browser.newPage()
  await login(strangerPage, stranger.email)
  await submitForm(strangerPage, set, { text: 'Von außen' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).announcementText).toBeNull()
  await submitForm(page, set, { text: TEXT, durationMin: '0' })
  const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } })
  expect([stored.announcementText, stored.announcementUntil]).toEqual([TEXT, null])

  // Ungültige Dauer oder zu langer Text: abgelehnt.
  const invalid = await submitForm(page, set, { text: 'Andere', durationMin: '45' })
  expect(locationOf(invalid)?.searchParams.get('error')).toBe('announcement')
  await submitForm(page, set, { text: 'x'.repeat(281) })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).announcementText).toBe(TEXT)

  // Abgelaufen: nicht mehr im JSON.
  await prisma.event.update({ where: { id: event.id }, data: { announcementUntil: new Date(Date.now() - 1000) } })
  expect((await guestJson(page, event.slug)).announcement).toBeNull()

  // Beendet: die Durchsage gehört nicht in den Rückblick, und neue gibt es nicht mehr.
  await prisma.event.update({ where: { id: event.id }, data: { status: 'ENDED', announcementUntil: null } })
  expect((await guestJson(page, event.slug)).announcement).toBeNull()
  const ended = await submitForm(page, set, { text: 'Nach dem Ende' })
  expect(locationOf(ended)?.searchParams.get('error')).toBe('not-live')
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).announcementText).toBe(TEXT)

  // Entwurf: ebenso gesperrt.
  await prisma.event.update({ where: { id: event.id }, data: { status: 'DRAFT' } })
  await submitForm(page, set, { text: 'Im Entwurf' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).announcementText).toBe(TEXT)
})
