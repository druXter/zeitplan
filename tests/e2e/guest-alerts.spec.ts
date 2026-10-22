import { createECDH, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import ece from 'http_ece'
import { createAccount, createEventRecord, createItemRecord, createTrackRecord, login, prisma, unique } from './helpers'
import { PUSH_ORIGIN, pushesTo, type ReceivedPush } from './push-server'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { utcToZonedDate, zonedDateToUtc } from '../../app/lib/timezone'

// Erinnerungen für Gäste (Idee L12). Wie bei der Vorwarnung fürs Team (alerts.spec.ts) legt der Test das Abo wie ein
// Browser an - ein Headless-Browser kann sich bei keinem echten Push-Dienst anmelden - und entschlüsselt, was beim
// Test-Push-Dienst ankommt, mit einer unabhängigen Implementierung von RFC 8291 (http_ece).

const MINUTE = 60_000

async function guestDevice(eventId: string, binding: { guestSessionId?: string; sessionId?: string } = {}) {
  const browserKeys = createECDH('prime256v1')
  const auth = randomBytes(16)
  const path = `/push/${unique()}`
  await prisma.guestPushSubscription.create({
    data: {
      eventId, endpoint: `${PUSH_ORIGIN}${path}`, p256dh: browserKeys.generateKeys().toString('base64url'), auth: auth.toString('base64url'),
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * MINUTE), ...binding
    }
  })
  return { path, read: (push: ReceivedPush) => JSON.parse(ece.decrypt(Buffer.from(push.body, 'base64'), { version: 'aes128gcm', privateKey: browserKeys, authSecret: auth }).toString()) }
}

async function runCron(request: import('@playwright/test').APIRequestContext) {
  const response = await request.get(`/api/cron/alerts?secret=${TEST_CRON_SECRET}`)
  expect(response.status()).toBe(200)
  return (await response.json()) as { guests: { events: number; sent: number; delivered: number } }
}

/** Punkte auf glatte Minuten, damit Gäste genau die Planzeit sehen (ohne "ca."). */
const soon = (minutes: number) => new Date(Math.ceil((Date.now() + minutes * MINUTE) / MINUTE) * MINUTE)

async function setup(access: 'PUBLIC' | 'CODE' = 'PUBLIC') {
  const owner = await createAccount('CREATOR')
  const today = zonedDateToUtc(utcToZonedDate(new Date(), 'Europe/Berlin'), 'Europe/Berlin')!
  const event = await createEventRecord(owner.id, { status: 'PUBLISHED', date: today, title: 'Gäste-Hochzeit', access })
  const track = await createTrackRecord(event.id)
  const torte = await createItemRecord(event, track.id, { title: 'Torte anschneiden', start: soon(8), durationMin: 1, sortOrder: 1, location: 'Saal', internalNote: 'Messer bei Tante Ute' })
  const tanz = await createItemRecord(event, track.id, { title: 'Eröffnungstanz', start: soon(9), durationMin: 1, sortOrder: 2 })
  const aufbau = await createItemRecord(event, track.id, { title: 'Aufbau Bühne', start: soon(7), durationMin: 1, sortOrder: 0, visibility: 'TEAM' })
  await prisma.item.updateMany({ where: { id: { in: [torte.id, aufbau.id] } }, data: { guestAlert: true } })
  return { owner, event, torte, tanz, aufbau }
}

test('Erinnerungen für Gäste (L12): Planende stellen ein, Gäste sehen Kasten und 🔔, Mitteilung nur für markierte öffentliche Punkte, einmal', async ({ page, request }) => {
  const { owner, event, torte, tanz } = await setup()
  await login(page, owner.email)

  // Ohne Einstellung: kein Kasten in der Gästeansicht, kein Versand.
  const device = await guestDevice(event.id)
  await page.goto(`/${event.slug}`)
  await expect(page.getByTestId('event-header')).toBeVisible()
  await expect(page.getByTestId('guest-reminders')).toHaveCount(0)
  await runCron(request)
  await page.waitForTimeout(300)
  expect(pushesTo(device.path)).toHaveLength(0)

  // Einstellen: nur markierte Punkte, 10 Minuten vorher.
  await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=erinnerungen`)
  const section = page.locator('#erinnerungen')
  await section.getByLabel('nur markierte Punkte').check()
  await section.getByLabel('Vorlauf').selectOption('10')
  await section.getByLabel('Verschiebungen melden').selectOption('30')
  await section.getByRole('button', { name: 'Speichern' }).click()
  await expect(section.getByText('Einstellungen gespeichert.')).toBeVisible()
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ guestAlerts: 'MARKED', guestAlertLeadMin: 10, guestShiftAlertMin: 30 })

  // Häkchen im Punkt: sichtbar bei öffentlichen Punkten, gespeichert mit dem Punkt.
  await page.goto(`/admin/events/${event.id}/items/${tanz.id}`)
  await page.getByLabel('Gäste erinnern').check()
  await page.getByRole('button', { name: 'Punkt speichern' }).click()
  await expect.poll(async () => (await prisma.item.findUniqueOrThrow({ where: { id: tanz.id } })).guestAlert).toBe(true)
  await page.goto(`/admin/events/${event.id}/items/${tanz.id}`)
  await page.getByRole('radio', { name: /^Nur Team/ }).check()
  await expect(page.getByLabel('Gäste erinnern')).toHaveCount(0)
  await prisma.item.update({ where: { id: tanz.id }, data: { guestAlert: false } })

  // Gästeansicht (ohne Konto): Kasten mit Beschreibung, 🔔 nur am markierten öffentlichen Punkt.
  await page.context().clearCookies()
  await page.goto(`/${event.slug}`)
  const box = page.getByTestId('guest-reminders')
  await expect(box).toContainText('Du bekommst 10 Minuten vor den Programmpunkten mit 🔔 eine Mitteilung')
  await expect(box).toContainText('um 30 Minuten oder mehr')
  await expect(page.locator(`#punkt-${torte.id}`).getByTestId('reminder-bell')).toBeVisible()
  await expect(page.locator(`#punkt-${tanz.id}`).getByTestId('reminder-bell')).toHaveCount(0)
  await expect(page.getByText('Aufbau Bühne')).toHaveCount(0)

  // Cron: Erinnerung an die Torte - Zeit und Ort wie in der Gästeansicht, ohne interne Notiz. Der TEAM-Punkt ist
  // markiert und früher dran, bekommt aber nie eine Mitteilung an Gäste.
  const first = await runCron(request)
  expect(first.guests.sent).toBe(1)
  await expect.poll(() => pushesTo(device.path).length).toBe(1)
  const push = pushesTo(device.path)[0]
  expect(push.headers.urgency).toBe('high')
  expect(Number(push.headers.ttl)).toBeLessThanOrEqual(9 * 60)
  const message = device.read(push)
  expect(message.title).toMatch(/^In [6-9] Min: Torte anschneiden$/)
  expect(message.body).toMatch(/^Gäste-Hochzeit: \d\d:\d\d Uhr · Saal$/)
  expect(message).toMatchObject({ url: `/${event.slug}#punkt-${torte.id}`, tag: `gast-${torte.id}` })
  expect(JSON.stringify(message)).not.toContain('Tante Ute')
  expect(await prisma.guestAlertSent.findMany({ where: { item: { eventId: event.id } } })).toEqual([expect.objectContaining({ itemId: torte.id, kind: 'START' })])

  // Zweiter Lauf: nichts doppelt.
  await runCron(request)
  await page.waitForTimeout(300)
  expect(pushesTo(device.path)).toHaveLength(1)

  // "Alle Punkte": jetzt auch der Tanz (ohne Häkchen), der TEAM-Punkt weiterhin nicht.
  await prisma.event.update({ where: { id: event.id }, data: { guestAlerts: 'ALL' } })
  await runCron(request)
  await expect.poll(() => pushesTo(device.path).length).toBe(2)
  expect(device.read(pushesTo(device.path)[1]).title).toMatch(/: Eröffnungstanz$/)
  for (const received of pushesTo(device.path)) expect(JSON.stringify(device.read(received))).not.toContain('Aufbau')
  await page.reload()
  await expect(page.getByTestId('reminder-bell')).toHaveCount(0)

  // Ausschalten löscht die Abos der Gäste.
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=erinnerungen`)
  await section.getByRole('radio', { name: /^aus/ }).check()
  await section.getByRole('button', { name: 'Speichern' }).click()
  await expect(section.getByText('Erinnerungen sind aus, die Abos der Gäste gelöscht.')).toBeVisible()
  expect(await prisma.guestPushSubscription.count({ where: { eventId: event.id } })).toBe(0)
})

test('Erinnerungen für Gäste (L12): "Neue Zeit" nur live und ab der Schwelle', async ({ request }) => {
  const { event, torte } = await setup()
  await prisma.event.update({ where: { id: event.id }, data: { guestAlerts: 'MARKED', guestAlertLeadMin: 5, guestShiftAlertMin: 30 } })
  const device = await guestDevice(event.id)
  // Die Torte stand beim Live-Schalten 40 Minuten früher - Gäste kannten diese Zeit.
  const original = new Date(torte.plannedStart.getTime() - 40 * MINUTE)
  await prisma.item.update({ where: { id: torte.id }, data: { originalStart: original } })

  await runCron(request)
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(pushesTo(device.path)).toHaveLength(0) // nicht live

  await prisma.event.update({ where: { id: event.id }, data: { status: 'LIVE' } })
  await runCron(request)
  await expect.poll(() => pushesTo(device.path).length).toBe(1)
  const message = device.read(pushesTo(device.path)[0])
  expect(message.title).toBe('Neue Zeit: Torte anschneiden')
  expect(message.body).toMatch(/^Gäste-Hochzeit: jetzt \d\d:\d\d Uhr statt \d\d:\d\d Uhr · Saal$/)

  await runCron(request)
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(pushesTo(device.path)).toHaveLength(1)
})

test('Erinnerungen für Gäste (L12): bei Zugangscode nur Geräte mit gültigem Zugang, Zugangswechsel beendet alle', async ({ page, request }) => {
  const { owner, event } = await setup('CODE')
  await prisma.event.update({ where: { id: event.id }, data: { guestAlerts: 'MARKED', accessCodeHmac: 'x' } })
  const guestSession = await prisma.guestSession.create({ data: { eventId: event.id, tokenHash: unique(), expiresAt: new Date(Date.now() + 24 * 60 * MINUTE) } })
  const withAccess = await guestDevice(event.id, { guestSessionId: guestSession.id })
  // Ohne Bindung (z. B. aus der Zeit, als das Event öffentlich war): keine Erinnerungen mehr.
  const stale = await guestDevice(event.id)

  await runCron(request)
  await expect.poll(() => pushesTo(withAccess.path).length).toBe(1)
  expect(pushesTo(stale.path)).toHaveLength(0)
  expect(withAccess.read(pushesTo(withAccess.path)[0]).title).toMatch(/: Torte anschneiden$/)

  // Gast-Sitzung endet (z. B. Absage in rsvp-app): ihr Abo verschwindet mit ihr.
  await prisma.guestSession.delete({ where: { id: guestSession.id } })
  expect(await prisma.guestPushSubscription.count({ where: { eventId: event.id } })).toBe(1)

  // Zugang ändern (Planende): auch das übrige Abo wird gelöscht.
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=zugang`)
  await page.locator('#zugang').getByLabel('Öffentlich').check()
  await page.locator('#zugang').getByRole('button', { name: /speichern/i }).click()
  await expect(page.locator('#zugang').getByText('Zugang gespeichert.')).toBeVisible()
  expect(await prisma.guestPushSubscription.count({ where: { eventId: event.id } })).toBe(0)
})
