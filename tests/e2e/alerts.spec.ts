import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto'
import { expect, test } from '@playwright/test'
import ece from 'http_ece'
import { createAccount, createEventRecord, createItemRecord, createTrackRecord, locationOf, login, prisma, readForm, submitForm, unique } from './helpers'
import { PUSH_ORIGIN, pushesTo, type ReceivedPush } from './push-server'
import { TEST_CRON_SECRET, TEST_VAPID_PUBLIC_KEY } from '../../playwright.config'
import { utcToZonedDate, zonedDateToUtc } from '../../app/lib/timezone'

// Vorwarnung fürs Team (Idee L17). Den Browser-Teil (Abo beim Push-Dienst des Herstellers) kann ein Headless-Browser
// nicht - die Tests legen das Abo wie ein Browser an (eigenes Schlüsselpaar, auth-Geheimnis) und prüfen, was beim
// Test-Push-Dienst ankommt: VAPID-Signatur und Inhalt, entschlüsselt mit einer UNABHÄNGIGEN Implementierung von
// RFC 8291 (Paket http_ece). Den Cron ruft der Test selbst auf; gerechnet wird mit der echten Uhrzeit.

const MINUTE = 60_000

async function subscribe(userId: string) {
  const session = await prisma.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } })
  const browserKeys = createECDH('prime256v1')
  const auth = randomBytes(16)
  const path = `/push/${unique()}`
  await prisma.pushSubscription.create({
    data: { userId, sessionId: session.id, endpoint: `${PUSH_ORIGIN}${path}`, p256dh: browserKeys.generateKeys().toString('base64url'), auth: auth.toString('base64url') }
  })
  return { path, read: (push: ReceivedPush) => JSON.parse(ece.decrypt(Buffer.from(push.body, 'base64'), { version: 'aes128gcm', privateKey: browserKeys, authSecret: auth }).toString()) }
}

async function runCron(request: import('@playwright/test').APIRequestContext) {
  const response = await request.get(`/api/cron/alerts?secret=${TEST_CRON_SECRET}`)
  expect(response.status()).toBe(200)
  return response.json() as Promise<{ events: number; sent: number; delivered: number }>
}

async function setup() {
  const owner = await createAccount('CREATOR')
  const dj = await createAccount('MODERATOR')
  await prisma.user.update({ where: { id: dj.id }, data: { name: 'DJ Dora' } })
  const today = zonedDateToUtc(utcToZonedDate(new Date(), 'Europe/Berlin'), 'Europe/Berlin')!
  const event = await createEventRecord(owner.id, { status: 'PUBLISHED', date: today, title: 'Push-Hochzeit' })
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: dj.id } })
  const track = await createTrackRecord(event.id)
  const soon = (minutes: number) => new Date(Math.ceil((Date.now() + minutes * MINUTE) / MINUTE) * MINUTE)
  const tanz = await createItemRecord(event, track.id, { title: 'Eröffnungstanz', start: soon(8), durationMin: 1, sortOrder: 2, location: 'Saal', internalNote: 'Song: Perfect' })
  const abbau = await createItemRecord(event, track.id, { title: 'Abbau Bühne', start: soon(9), durationMin: 1, sortOrder: 3 })
  const geheim = await createItemRecord(event, track.id, { title: 'Flashmob der Trauzeugen', start: soon(7), durationMin: 1, sortOrder: 1, visibility: 'SECRET', secretViewers: [owner.id] })
  // Zuständig: DJ für Tanz und (ohne Eintrag in "Geheim für") für den geheimen Punkt - der bleibt trotzdem geheim.
  await prisma.itemAssignee.createMany({ data: [{ itemId: tanz.id, userId: dj.id }, { itemId: geheim.id, userId: dj.id }] })
  return { owner, dj, event, tanz, abbau, geheim }
}

function checkVapid(push: ReceivedPush) {
  expect(push.headers['content-encoding']).toBe('aes128gcm')
  expect(push.headers.urgency).toBe('high')
  // Gilt nur bis zum erwarteten Beginn.
  expect(Number(push.headers.ttl)).toBeGreaterThan(0)
  expect(Number(push.headers.ttl)).toBeLessThanOrEqual(9 * 60)
  const match = push.headers.authorization.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)
  expect(match).not.toBeNull()
  const [, header, claims, signature, k] = match!
  expect(k).toBe(TEST_VAPID_PUBLIC_KEY)
  expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({ aud: PUSH_ORIGIN, sub: 'mailto:test@example.test' })
  const publicKey = Buffer.from(TEST_VAPID_PUBLIC_KEY, 'base64url')
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: publicKey.subarray(1, 33).toString('base64url'), y: publicKey.subarray(33).toString('base64url') } })
  expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true)
}

test('Vorwarnung (L17): in der Team-Ansicht einstellen, verschlüsselte Mitteilung vor dem eigenen Punkt, nur einmal, neu nach Verschiebung', async ({ page, request }) => {
  const { dj, event, tanz, abbau } = await setup()
  await login(page, dj.email)
  await page.goto(`/admin/events/${event.id}/team`)
  const box = page.locator('#vorwarnung')
  await expect(box).toContainText('Vorwarnung aufs Handy: aus')
  await box.locator('summary').click()
  await box.getByLabel('Für').selectOption('MINE')
  await box.getByLabel('Wie lange vorher').selectOption('10')
  await box.getByRole('button', { name: 'Speichern' }).click()
  await expect(box.getByText('Vorwarnung gespeichert.')).toBeVisible()
  await expect(box).toContainText('10 Min vorher, nur meine Punkte')
  expect(await prisma.alertSetting.findUnique({ where: { eventId_userId: { eventId: event.id, userId: dj.id } } })).toMatchObject({ scope: 'MINE', leadMin: 10 })

  const device = await subscribe(dj.id)
  const first = await runCron(request)
  expect(first.sent).toBeGreaterThanOrEqual(1)
  await expect.poll(() => pushesTo(device.path).length).toBe(1)
  const push = pushesTo(device.path)[0]
  checkVapid(push)
  const message = device.read(push)
  expect(message.title).toMatch(/^In [6-9] Min: Eröffnungstanz$/)
  expect(message.body).toMatch(/^Push-Hochzeit: \d\d:\d\d Uhr · Saal · Notiz: Song: Perfect$/)
  expect(message).toMatchObject({ url: `/admin/events/${event.id}/team?meine=1#punkt-${tanz.id}`, tag: `punkt-${tanz.id}` })
  // Weder der fremde Punkt (MINE) noch der geheime (kein Eintrag in "Geheim für").
  expect(await prisma.alertSent.findMany({ where: { userId: dj.id } })).toEqual([expect.objectContaining({ itemId: tanz.id })])

  // Zweiter Lauf: nichts doppelt.
  await runCron(request)
  await page.waitForTimeout(300)
  expect(pushesTo(device.path)).toHaveLength(1)

  // Angekündigt war ein deutlich früherer Beginn (der Punkt ist seitdem gerutscht) - dann kommt eine neue.
  await prisma.alertSent.update({ where: { itemId_userId: { itemId: tanz.id, userId: dj.id } }, data: { expectedStart: new Date(Date.now() - 10 * MINUTE) } })
  await runCron(request)
  await expect.poll(() => pushesTo(device.path).length).toBe(2)
  expect(device.read(pushesTo(device.path)[1]).tag).toBe(`punkt-${tanz.id}`)

  // "Alle Punkte": jetzt auch der fremde Punkt, der geheime weiterhin nicht.
  await page.goto(`/admin/events/${event.id}/team`)
  await box.locator('summary').click()
  await box.getByLabel('Für').selectOption('ALL')
  await box.getByRole('button', { name: 'Speichern' }).click()
  await expect(box).toContainText('10 Min vorher, alle Punkte')
  await runCron(request)
  await expect.poll(() => pushesTo(device.path).length).toBe(3)
  const third = device.read(pushesTo(device.path)[2])
  expect(third.title).toMatch(/: Abbau Bühne$/)
  expect(third.url).toBe(`/admin/events/${event.id}/team#punkt-${abbau.id}`)
  for (const received of pushesTo(device.path)) expect(JSON.stringify(device.read(received))).not.toContain('Flashmob')

  // Ausschalten: keine weiteren Mitteilungen.
  await page.goto(`/admin/events/${event.id}/team`)
  await box.locator('summary').click()
  await box.getByLabel('Für').selectOption('OFF')
  await box.getByRole('button', { name: 'Speichern' }).click()
  await expect(box.getByText('Vorwarnung für dieses Event ausgeschaltet.')).toBeVisible()
  expect(await prisma.alertSetting.count({ where: { eventId: event.id, userId: dj.id } })).toBe(0)
})

test('Vorwarnung (L17): geheime Punkte nur für Eingetragene, kein Versand ohne Zugriff, ohne Gerät oder im Entwurf', async ({ page, request }) => {
  const { owner, dj, event, geheim } = await setup()
  // Besitzerin ist für den geheimen Punkt eingetragen und bekommt ihn mit "alle Punkte".
  await login(page, owner.email)
  const ownerDevice = await subscribe(owner.id)
  await prisma.alertSetting.create({ data: { eventId: event.id, userId: owner.id, scope: 'ALL', leadMin: 15 } })
  await runCron(request)
  await expect.poll(() => pushesTo(ownerDevice.path).length).toBe(3)
  const titles = pushesTo(ownerDevice.path).map(push => ownerDevice.read(push).title as string)
  expect(titles.some(title => title.endsWith(': Flashmob der Trauzeugen'))).toBe(true)
  expect(await prisma.alertSent.count({ where: { itemId: geheim.id, userId: owner.id } })).toBe(1)

  // DJ ohne Gerät: nichts gesendet, nichts als gesendet vermerkt.
  await prisma.alertSetting.create({ data: { eventId: event.id, userId: dj.id, scope: 'ALL', leadMin: 15 } })
  await runCron(request)
  expect(await prisma.alertSent.count({ where: { userId: dj.id } })).toBe(0)

  // DJ mit Gerät, aber ohne Freigabe mehr: nichts.
  await page.context().clearCookies()
  await login(page, dj.email)
  const djDevice = await subscribe(dj.id)
  await prisma.eventAccess.deleteMany({ where: { eventId: event.id, userId: dj.id } })
  await runCron(request)
  await page.waitForTimeout(300)
  expect(pushesTo(djDevice.path)).toHaveLength(0)

  // Mit Freigabe, aber im Entwurf: nichts. Positivkontrolle: veröffentlicht kommt sie.
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: dj.id } })
  await prisma.event.update({ where: { id: event.id }, data: { status: 'DRAFT' } })
  await runCron(request)
  await page.waitForTimeout(300)
  expect(pushesTo(djDevice.path)).toHaveLength(0)
  await prisma.event.update({ where: { id: event.id }, data: { status: 'LIVE' } })
  await runCron(request)
  await expect.poll(() => pushesTo(djDevice.path).length).toBe(2)
  for (const received of pushesTo(djDevice.path)) expect(JSON.stringify(djDevice.read(received))).not.toContain('Flashmob')

  // Abmelden beendet die Mitteilungen dieses Geräts (Abo hängt an der Sitzung).
  await page.goto('/account')
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await page.waitForURL(url => url.pathname !== '/account')
  await expect.poll(() => prisma.pushSubscription.count({ where: { userId: dj.id } })).toBe(0)
})

test('Vorwarnung (L17): Einstellung nur mit Zugriff aufs Event, Cron nur mit Secret, ungültige Werte abgelehnt', async ({ page, browser, request }) => {
  const { dj, event } = await setup()
  await login(page, dj.email)
  await page.goto(`/admin/events/${event.id}/team`)
  const form = await readForm(page, '#vorwarnung form')

  const response = await submitForm(page, form, { leadMin: '7' })
  expect(locationOf(response)?.searchParams.get('alert')).toBe('invalid')
  expect(await prisma.alertSetting.count({ where: { eventId: event.id } })).toBe(0)
  const scope = await submitForm(page, form, { scope: 'EVERYTHING' })
  expect(locationOf(scope)?.searchParams.get('alert')).toBe('invalid')

  // Ein Konto ohne Zugriff schickt dasselbe Formular: nichts angelegt.
  const stranger = await createAccount('CREATOR')
  const other = await browser.newPage()
  await login(other, stranger.email)
  const foreign = await submitForm(other, form, { scope: 'ALL', leadMin: '10' })
  expect(locationOf(foreign)?.pathname).toBe('/admin/events')
  expect(await prisma.alertSetting.count({ where: { eventId: event.id } })).toBe(0)
  // Positivkontrolle: dasselbe Formular vom DJ legt sie an.
  await submitForm(page, form, { scope: 'ALL', leadMin: '10' })
  expect(await prisma.alertSetting.count({ where: { eventId: event.id, userId: dj.id } })).toBe(1)
  await other.close()

  for (const query of ['', '?secret=', '?secret=falsch']) expect((await request.get(`/api/cron/alerts${query}`)).status()).toBe(401)
})
