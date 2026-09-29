import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createAccount, createEventRecord, createItemRecord, createTrackRecord, locationOf, login, prisma, readForm, submitForm
} from './helpers'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { zonedDateToUtc } from '../../app/lib/timezone'

// Live-Steuerung (Phase 4, docs/KONZEPT.md Abschnitt 3). Definition of Done: zwei gleichzeitige "Weiter"
// überspringen nur einen Punkt; veraltete Tauschaktion abgelehnt; Rückgängig stellt exakt her; Serverzeit statt
// Client-Zeit; Rechte je Schalter und SECRET; Bedienung bei 390 px Breite. Jeder Angriffsfall mit Positivkontrolle.

const MINUTE = 60_000
const PHONE = { width: 390, height: 844 }

function minuteNow(): number {
  return Math.floor(Date.now() / MINUTE) * MINUTE
}

function today(): Date {
  return zonedDateToUtc(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date()))!
}

/**
 * Laufendes Event mit einer Spur: Trauung (läuft), Sektempfang, Gruppenfoto, Kaffee. Moderator*in mit Freigabe,
 * ohne Schalter. status: LIVE (Standard) oder PUBLISHED; trauungRunning: Trauung schon gestartet.
 */
async function liveEvent(options: { status?: 'LIVE' | 'PUBLISHED'; trauungRunning?: boolean; modsMayInsert?: boolean } = {}) {
  const owner = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const event = await createEventRecord(owner.id, { status: options.status ?? 'LIVE', date: today(), title: 'Live-Hochzeit' })
  if (options.modsMayInsert) await prisma.event.update({ where: { id: event.id }, data: { modsMayInsert: true } })
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  const track = await createTrackRecord(event.id)
  const base = minuteNow()
  const running = options.trauungRunning ?? true
  const trauung = await createItemRecord(event, track.id, {
    title: 'Trauung', start: new Date(base - 10 * MINUTE), durationMin: 45, sortOrder: 1,
    ...(running ? { actualStart: new Date(base - 10 * MINUTE), status: 'RUNNING' as const } : {})
  })
  const sekt = await createItemRecord(event, track.id, { title: 'Sektempfang', start: new Date(base + 35 * MINUTE), durationMin: 30, sortOrder: 2 })
  const foto = await createItemRecord(event, track.id, { title: 'Gruppenfoto', start: new Date(base + 65 * MINUTE), durationMin: 20, sortOrder: 3 })
  const kaffee = await createItemRecord(event, track.id, { title: 'Kaffee', start: new Date(base + 120 * MINUTE), durationMin: 60, sortOrder: 4 })
  return { owner, moderator, event, track, trauung, sekt, foto, kaffee }
}

async function openLive(page: Page, email: string, eventId: string) {
  await page.setViewportSize(PHONE)
  await login(page, email)
  await page.goto(`/admin/events/${eventId}/live`)
}

const item = (id: string) => prisma.item.findUniqueOrThrow({ where: { id } })

/** Klickt einen Live-Knopf und wartet, bis die Action fertig ist (sie leitet immer auf eine neue URL weiter). */
async function press(page: Page, target: Locator) {
  const before = page.url()
  await target.click()
  await page.waitForURL(url => url.href !== before)
}

/** Alles an den Punkten eines Events, was Rückgängig wiederherstellen muss (ohne Version und Zeitstempel der Änderung). */
async function state(eventId: string) {
  const items = await prisma.item.findMany({
    where: { eventId }, orderBy: { id: 'asc' },
    include: { waitsFor: { orderBy: { waitsForItemId: 'asc' } }, waitedOnBy: { orderBy: { itemId: 'asc' } }, secretViewers: true }
  })
  return items.map(entry => {
    const rest: Partial<typeof entry> = { ...entry }
    delete rest.version
    delete rest.updatedAt
    delete rest.guestShownStart
    return rest
  })
}

test('Live schalten friert den Ursprungsplan ein; Start und Weiter mit Serverzeit, auch bei falscher Handy-Uhr', async ({ page }) => {
  const { moderator, event, trauung, sekt, foto } = await liveEvent({ status: 'PUBLISHED', trauungRunning: false })
  // Die Uhr des Handys geht völlig falsch - die Aktionen nehmen trotzdem die Zeit des Servers.
  await page.clock.setFixedTime(new Date('2020-01-01T10:00:00Z'))
  await openLive(page, moderator.email, event.id)

  await press(page, page.getByRole('button', { name: 'Live schalten' }))
  await expect(page.getByText('Live geschaltet – der Ursprungsplan ist eingefroren.')).toBeVisible()
  const frozen = await item(sekt.id)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('LIVE')
  expect(frozen.originalStart).toEqual(sekt.plannedStart)
  expect(frozen.originalSortOrder).toBe(2)

  const before = Date.now()
  await press(page, page.getByRole('button', { name: 'Start: Trauung' }))
  await expect(page.getByRole('region', { name: 'Jetzt' })).toContainText('Trauung')
  const started = (await item(trauung.id)).actualStart!.getTime()
  expect(started).toBeGreaterThanOrEqual(before - 1000)
  expect(started).toBeLessThanOrEqual(Date.now() + 1000)

  // Ein gefälschtes Zeitfeld im Formular wird ignoriert.
  const weiter = await readForm(page, 'form:has(button:has-text("Weiter:"))')
  const response = await submitForm(page, weiter, { at: '2020-01-01T10:00:00.000Z', actualStart: '2020-01-01T10:00:00.000Z' })
  expect(locationOf(response)?.searchParams.get('done')).toBeTruthy()
  const next = await item(sekt.id)
  expect(next.status).toBe('RUNNING')
  expect(next.actualStart!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  expect((await item(trauung.id)).actualEnd!.getTime()).toBeGreaterThanOrEqual(before - 1000)

  // Gäste sehen den laufenden Punkt; der Ursprungsplan bleibt nach einem Tausch unverändert.
  const guest = await page.request.get(`/api/view/${event.slug}`)
  expect((await guest.json()).items.find((i: { title: string }) => i.title === 'Sektempfang').status).toBe('now')
  await page.reload()
  await press(page, page.getByRole('region', { name: 'Als Nächstes' }).getByRole('button', { name: '↓ nach „Kaffee“' }))
  const moved = await item(foto.id)
  expect(moved.plannedStart).not.toEqual(foto.plannedStart)
  expect(moved.originalStart).toEqual(foto.plannedStart)
  expect(moved.originalSortOrder).toBe(3)
})

test('zwei gleichzeitige „Weiter“ überspringen nur einen Punkt', async ({ page }) => {
  const { moderator, event, trauung, sekt, foto } = await liveEvent()
  await openLive(page, moderator.email, event.id)
  await expect(page.getByRole('button', { name: 'Weiter: Sektempfang' })).toBeVisible()
  const form = await readForm(page, 'form:has(button:has-text("Weiter: Sektempfang"))')

  const responses = await Promise.all([submitForm(page, form), submitForm(page, form), submitForm(page, form)])
  const outcomes = responses.map(r => (locationOf(r)?.searchParams.get('done') ? 'done' : locationOf(r)?.searchParams.get('error'))).sort()
  expect(outcomes).toEqual(['already', 'already', 'done'])

  expect((await item(trauung.id)).status).toBe('DONE')
  expect((await item(sekt.id)).status).toBe('RUNNING')
  const untouched = await item(foto.id)
  expect(untouched.status).toBe('PLANNED')
  expect(untouched.actualStart).toBeNull()
  expect(await prisma.liveAction.count({ where: { eventId: event.id, type: 'advance' } })).toBe(1)

  // Wer das zweite Mal drückt, sieht den aktuellen Stand mit Hinweis.
  await page.goto(`/admin/events/${event.id}/live?error=already`)
  await expect(page.getByText('Das ist schon passiert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Weiter: Gruppenfoto' })).toBeVisible()
})

test('veraltete Tauschaktion wird abgelehnt, aktuelle wirkt', async ({ page }) => {
  const { moderator, event, sekt, foto } = await liveEvent()
  await openLive(page, moderator.email, event.id)
  const stale = await readForm(page, 'form:has(button:has-text("↓ nach „Gruppenfoto“"))')

  // Inzwischen meldet jemand eine Verspätung für den Sektempfang - sein Stand ist jetzt ein anderer.
  await press(page, page.getByRole('region', { name: 'Als Nächstes' }).getByRole('button', { name: 'Verspätung +10 Minuten' }))
  const response = await submitForm(page, stale)
  expect(locationOf(response)?.searchParams.get('error')).toBe('stale')
  expect((await item(sekt.id)).sortOrder).toBe(2)
  expect((await item(foto.id)).sortOrder).toBe(3)

  // Positivkontrolle: mit dem aktuellen Stand wird getauscht (B übernimmt den Beginn von A).
  await press(page, page.getByRole('region', { name: 'Als Nächstes' }).getByRole('button', { name: '↓ nach „Gruppenfoto“' }))
  expect((await item(foto.id))).toMatchObject({ sortOrder: 2, plannedStart: sekt.plannedStart })
  expect((await item(sekt.id)).sortOrder).toBe(3)
})

test('Rückgängig stellt jede Aktion exakt her - und nie über eine spätere Änderung hinweg', async ({ page }) => {
  const { owner, event, kaffee } = await liveEvent()
  await openLive(page, owner.email, event.id)
  const now = () => page.getByRole('region', { name: 'Jetzt' })
  const next = () => page.getByRole('region', { name: 'Als Nächstes' })

  const actions: [string, () => Promise<void>][] = [
    ['Verspätung', () => press(page, next().getByRole('button', { name: 'Verspätung +10 Minuten' }))],
    ['Dauert länger', () => press(page, now().getByRole('button', { name: 'Dauert länger +15 Minuten' }))],
    ['Tauschen', () => press(page, next().getByRole('button', { name: '↓ nach „Gruppenfoto“' }))],
    ['Zurückstellen', () => press(page, next().getByRole('button', { name: 'Zurückstellen' }))],
    ['Ausfall mit Grund', async () => { await next().getByLabel('Grund für den Ausfall (optional)').fill('Regen'); await press(page, next().getByRole('button', { name: 'Ausfall' })) }],
    ['Weiter', () => press(page, now().getByRole('button', { name: 'Weiter: Sektempfang' }))],
    ['Beendet vor 5', () => press(page, now().getByRole('button', { name: 'Beendet vor 5 Minuten' }))],
    ['Einschub', async () => {
      await page.getByText('Einschub', { exact: true }).click()
      await page.getByLabel('Titel').fill('Rede von Onkel Horst')
      await page.getByLabel('Dauer (Min)').fill('15')
      await press(page, page.getByRole('button', { name: 'Einschieben' }))
    }]
  ]
  for (const [name, act] of actions) {
    const before = await state(event.id)
    await act()
    expect(await state(event.id), name).not.toEqual(before)
    await press(page, page.getByRole('button', { name: 'Rückgängig', exact: true }).last())
    await expect(page.getByText('Rückgängig gemacht.'), name).toBeVisible()
    expect(await state(event.id), name).toEqual(before)
  }

  // Entfernen eines Einschubs - auch Abhängigkeiten anderer Punkte kommen mit Rückgängig wieder.
  await page.getByText('Einschub', { exact: true }).click()
  await page.getByLabel('Titel').fill('Spontane Rede')
  await press(page, page.getByRole('button', { name: 'Einschieben' }))
  const inserted = await prisma.item.findFirstOrThrow({ where: { eventId: event.id, title: 'Spontane Rede' } })
  expect(inserted.insertedLive).toBe(true)
  await prisma.itemDependency.create({ data: { itemId: kaffee.id, waitsForItemId: inserted.id } })
  await page.goto(`/admin/events/${event.id}/live`)
  const withInsert = await state(event.id)
  await press(page, next().getByRole('button', { name: 'Einschub entfernen' }))
  await expect(page.getByRole('status').filter({ hasText: '„Spontane Rede“ entfernt' })).toBeVisible()
  expect(await prisma.item.count({ where: { id: inserted.id } })).toBe(0)
  await press(page, page.getByRole('button', { name: 'Rückgängig', exact: true }).last())
  await expect(page.getByText('Rückgängig gemacht.')).toBeVisible()
  expect(await state(event.id)).toEqual(withInsert)

  // Nicht über eine spätere Änderung hinweg: erst +5, dann +10 - das +5 lässt sich nicht mehr zurücknehmen.
  await press(page, next().getByRole('button', { name: 'Verspätung +5 Minuten' }))
  const first = await prisma.liveAction.findFirstOrThrow({ where: { eventId: event.id, type: 'delay' }, orderBy: { createdAt: 'desc' } })
  await press(page, next().getByRole('button', { name: 'Verspätung +10 Minuten' }))
  await page.goto(`/admin/events/${event.id}/live`)
  await page.getByText('Verlauf', { exact: true }).click()
  const afterBoth = await state(event.id)
  await press(page, page.locator(`[data-history="${first.id}"]`).getByRole('button', { name: 'Rückgängig' }))
  await expect(page.getByText('Rückgängig geht nicht mehr')).toBeVisible()
  expect(await state(event.id)).toEqual(afterBoth)
  // Der Verlauf nennt Konto und Aktion.
  await page.getByText('Verlauf', { exact: true }).click()
  await expect(page.locator(`[data-history="${first.id}"]`)).toContainText(owner.email)
})

test('Rechte: Einschub nur mit Schalter, geheime Punkte nur für Eingetragene - nachgespielte Aktionen wirkungslos', async ({ page, browser }) => {
  const { owner, moderator, event, sekt, foto } = await liveEvent()
  await prisma.item.update({ where: { id: sekt.id }, data: { visibility: 'SECRET', title: 'GEHEIM-SEKT-XYZ', secretViewers: { create: [{ userId: owner.id }] } } })

  const ownerPage = await browser.newPage()
  await openLive(ownerPage, owner.email, event.id)
  const insertForm = await (async () => {
    await ownerPage.getByText('Einschub', { exact: true }).click()
    return readForm(ownerPage, 'form:has(button:has-text("Einschieben"))')
  })()
  const advanceForm = await readForm(ownerPage, 'form:has(button:has-text("Weiter: GEHEIM-SEKT-XYZ"))')

  // Moderatorin ohne Schalter und ohne Eintrag: kein Einschub, kein "Weiter" in den geheimen Punkt, kein Titel.
  await openLive(page, moderator.email, event.id)
  await expect(page.getByText('Einschub', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Weiter:/ })).toHaveCount(0)
  await expect(page.getByText('Als Nächstes kommt ein geheimer Punkt')).toBeVisible()
  expect(await page.content()).not.toContain('GEHEIM-SEKT-XYZ')

  const inserted = await submitForm(page, insertForm, { title: 'Eingeschmuggelt' })
  expect(locationOf(inserted)?.searchParams.get('error')).toBe('forbidden')
  expect(await prisma.item.count({ where: { eventId: event.id, title: 'Eingeschmuggelt' } })).toBe(0)
  const advanced = await submitForm(page, advanceForm)
  expect(locationOf(advanced)?.searchParams.get('error')).toBe('forbidden')
  expect((await item(sekt.id)).actualStart).toBeNull()
  // Auch Verspätung, Tauschen und Ausfall am geheimen Punkt sind verboten.
  for (const [command, fields] of [['delay', { baseDelay: '0', addMin: '5' }], ['cancel', {}], ['defer', {}]] as const) {
    const forged = await submitForm(page, advanceForm, { command, itemId: sekt.id, ...fields })
    expect(locationOf(forged)?.searchParams.get('error'), command).toBe('forbidden')
  }
  const swapForged = await submitForm(page, advanceForm, { command: 'swap', itemId: foto.id, otherId: sekt.id, version: '1', otherVersion: '1' })
  expect(locationOf(swapForged)?.searchParams.get('error')).toBe('forbidden')
  expect(await item(sekt.id)).toMatchObject({ status: 'PLANNED', reportedDelayMin: null, sortOrder: 2 })

  // Positivkontrolle: mit Schalter darf die Moderatorin einschieben ...
  await prisma.event.update({ where: { id: event.id }, data: { modsMayInsert: true } })
  const allowed = await submitForm(page, insertForm, { title: 'Erlaubter Einschub' })
  expect(locationOf(allowed)?.searchParams.get('done')).toBeTruthy()
  expect(await prisma.item.count({ where: { eventId: event.id, title: 'Erlaubter Einschub', insertedLive: true } })).toBe(1)
  // ... und die eingetragene Besitzerin startet den geheimen Punkt (Einschub kam dazwischen - also neu lesen).
  await ownerPage.goto(`/admin/events/${event.id}/live`)
  await press(ownerPage, ownerPage.getByRole('button', { name: 'Weiter: Erlaubter Einschub' }))
  await press(ownerPage, ownerPage.getByRole('button', { name: 'Weiter: GEHEIM-SEKT-XYZ' }))
  expect((await item(sekt.id)).status).toBe('RUNNING')
  await ownerPage.close()
})

test('Bedienung bei 390 px: nichts ragt heraus, große Knöpfe, Rückgängig unten erreichbar, Nachfrage bei Überziehen', async ({ page }) => {
  const { moderator, event, trauung } = await liveEvent()
  // Trauung läuft seit 60 Min bei 45 Min Dauer: Die Seite fragt nach.
  await prisma.item.update({ where: { id: trauung.id }, data: { actualStart: new Date(minuteNow() - 60 * MINUTE), plannedStart: new Date(minuteNow() - 60 * MINUTE) } })
  await openLive(page, moderator.email, event.id)

  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const weiter = await page.getByRole('button', { name: 'Weiter: Sektempfang' }).boundingBox()
  expect(weiter!.height).toBeGreaterThanOrEqual(48)
  expect(weiter!.width).toBeGreaterThan(300)
  for (const name of ['Beendet', 'Dauert länger +5 Minuten', 'Verspätung +5 Minuten', 'Zurückstellen']) {
    const box = await page.getByRole('button', { name, exact: true }).first().boundingBox()
    expect(box!.height, name).toBeGreaterThanOrEqual(44)
  }

  await expect(page.getByText('„Trauung“ läuft noch?')).toBeVisible()
  await press(page, page.getByRole('button', { name: 'Ja, +5 Min' }))
  await expect(page.getByText('„Trauung“ läuft noch?')).toHaveCount(0)
  // Bisherige Abweichung (15 Min, je nach Sekunde auf 16 gerundet - sie wächst mit) + 5.
  expect([20, 21]).toContain((await item(trauung.id)).reportedDelayMin)

  const undo = page.getByRole('button', { name: 'Rückgängig', exact: true }).last()
  const box = await undo.boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height)
  expect(box!.y).toBeGreaterThan(PHONE.height / 2)
  expect(box!.height).toBeGreaterThanOrEqual(48)
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})

test('nach Eventende automatisch beendet: Live-Steuerung gesperrt, auch per Cron', async ({ page, request, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'LIVE', date: today() })
  const track = await createTrackRecord(event.id)
  await createItemRecord(event, track.id, { title: 'Längst vorbei', start: new Date(Date.now() - 8 * 60 * MINUTE), durationMin: 30, sortOrder: 1 })
  await createItemRecord(event, track.id, { title: 'Auch vorbei', start: new Date(Date.now() - 7 * 60 * MINUTE), durationMin: 30, sortOrder: 2 })

  // Per Cron: dieses Event endet, ein laufendes mit Punkten in der Zukunft nicht (Positivkontrolle).
  const running = await liveEvent()
  const cron = await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)
  expect((await cron.json()).endedEvents).toBeGreaterThanOrEqual(1)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('ENDED')
  expect((await prisma.event.findUniqueOrThrow({ where: { id: running.event.id } })).status).toBe('LIVE')

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/live`)
  await expect(page.getByText('Das Event ist beendet – die Live-Steuerung ist gesperrt.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Start:|^Weiter:/ })).toHaveCount(0)
  await expect(page.getByText('Event automatisch beendet')).toBeVisible()

  // Beim Aufruf der Live-Seite selbst: ebenfalls beendet; Aktionen danach wirkungslos.
  await prisma.event.update({ where: { id: event.id }, data: { status: 'LIVE' } })
  await page.goto(`/admin/events/${event.id}/live`)
  await expect(page.getByText('Das Event ist beendet')).toBeVisible()
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('ENDED')

  // Positivkontrolle für das laufende Event: Weiter wirkt.
  const other = await browser.newPage()
  await openLive(other, running.moderator.email, running.event.id)
  const form = await readForm(other, 'form:has(button:has-text("Weiter:"))')
  expect(locationOf(await submitForm(other, form))?.searchParams.get('done')).toBeTruthy()
  // Dasselbe Formular gegen das beendete Event: gesperrt.
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: running.moderator.id } })
  const blocked = await submitForm(other, form, { eventId: event.id })
  expect(locationOf(blocked)?.searchParams.get('error')).toBe('not-live')
  await other.close()
})
