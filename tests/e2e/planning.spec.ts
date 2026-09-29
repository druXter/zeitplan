import { expect, test, type Page } from '@playwright/test'
import {
  cookieOf, createAccount, createEventRecord, createItemRecord, createTrackRecord, login, pageAlert, prisma, readForm,
  submitForm, SUMMER_DAY, uniqueSlug
} from './helpers'
import { WEDDING_TEMPLATE } from '../../app/lib/planning/template'

// Planung (Phase 2, docs/KONZEPT.md Abschnitt 4 und 7). Jeder Angriffsfall mit Positivkontrolle: Derselbe
// nachgespielte POST wirkt, sobald ein berechtigtes Konto ihn schickt - sonst würde ein kaputtes Formular einen
// Schutz nur vortäuschen.

async function loggedIn(page: Page, role: 'ADMIN' | 'CREATOR' | 'MODERATOR' = 'CREATOR') {
  const user = await createAccount(role)
  await login(page, user.email)
  return user
}

/** Ortszeit (Berlin, Sommer) am 20.06.2026 als UTC-ISO. */
function summer(time: string, day = '2026-06-20'): string {
  const [hours, minutes] = time.split(':').map(Number)
  const base = new Date(`${day}T00:00:00.000Z`).getTime() - 2 * 60 * 60 * 1000
  return new Date(base + (hours * 60 + minutes) * 60_000).toISOString()
}

async function planWithTwoItems(ownerId: string) {
  const event = await createEventRecord(ownerId, { date: SUMMER_DAY })
  const track = await createTrackRecord(event.id)
  const a = await createItemRecord(event, track.id, { title: 'Trauung', start: '14:00', durationMin: 45, sortOrder: 1 })
  const b = await createItemRecord(event, track.id, { title: 'Sektempfang', start: '14:45', durationMin: 45, sortOrder: 2 })
  return { event, track, a, b }
}

test('Neues Event mit Vorlage „Hochzeit“: Spuren, Punkte, geheimer Punkt nur fürs anlegende Konto', async ({ page }) => {
  const user = await loggedIn(page)
  const slug = uniqueSlug('vorlage')
  await page.goto('/admin/events/new')
  await page.getByLabel('Titel').fill('Hochzeit mit Vorlage')
  await page.getByLabel('Adresse').fill(slug)
  await page.getByLabel('Datum').fill('2026-10-24')
  await page.getByLabel('Mit der Vorlage').check()
  await page.getByRole('button', { name: 'Event anlegen' }).click()
  await expect(page.getByText('Event angelegt.')).toBeVisible()

  const event = await prisma.event.findUniqueOrThrow({ where: { slug }, include: { tracks: true, items: { include: { secretViewers: true, waitsFor: true } } } })
  expect(event.tracks.map(t => [t.name, t.visibility])).toEqual(expect.arrayContaining([['Ablauf', 'PUBLIC'], ['Brautpaar', 'PUBLIC'], ['Team', 'TEAM']]))
  expect(event.items).toHaveLength(WEDDING_TEMPLATE.items.length)
  expect(event.items.find(i => i.visibility === 'SECRET')?.secretViewers.map(v => v.userId)).toEqual([user.id])
  expect(event.items.find(i => i.title === 'Anschnitt der Hochzeitstorte')?.waitsFor).toHaveLength(1)
  // Nacht der Zeitumstellung: 00:45 ist noch Sommerzeit, 03:00 (Abbau) schon Winterzeit.
  expect(event.items.find(i => i.title === 'Mitternachtssnack')?.plannedStart.toISOString()).toBe('2026-10-24T22:45:00.000Z')
  expect(event.items.find(i => i.title === 'Abbau')?.plannedStart.toISOString()).toBe('2026-10-25T02:00:00.000Z')

  await page.getByRole('link', { name: 'Ablauf planen' }).click()
  await expect(page.getByText('Überraschung der Trauzeug*innen')).toBeVisible()
  await expect(page.getByText('Notiz: Beginn mit dem Catering vereinbart')).toBeVisible()
  await page.getByRole('link', { name: 'Team (Team)' }).click()
  await expect(page.getByText('Aufbau & Deko')).toBeVisible()
  await expect(page.getByText('Trauung')).toHaveCount(0)
})

test('Punkte anlegen, Puffer sehen, per „nach oben“ tauschen', async ({ page }) => {
  const owner = await loggedIn(page)
  const event = await createEventRecord(owner.id, { date: SUMMER_DAY })
  const track = await createTrackRecord(event.id)

  async function addItem(title: string, start: string, duration: string) {
    await page.goto(`/admin/events/${event.id}/plan?track=${track.id}`)
    await page.getByRole('link', { name: 'Neuer Punkt' }).click()
    await page.getByLabel('Titel').fill(title)
    await page.getByLabel('Beginn', { exact: true }).fill(`2026-06-20T${start}`)
    await page.getByLabel('Dauer in Minuten').fill(duration)
    await page.getByRole('button', { name: 'Punkt anlegen' }).click()
    await expect(page.getByText('Punkt gespeichert.')).toBeVisible()
  }
  await addItem('Gruppenfoto', '16:00', '30')
  await addItem('Trauung', '14:00', '45')
  await addItem('Sektempfang', '14:45', '45')

  // Einsortiert nach Beginn, obwohl in anderer Reihenfolge angelegt.
  const stored = await prisma.item.findMany({ where: { eventId: event.id }, orderBy: { sortOrder: 'asc' } })
  expect(stored.map(i => [i.title, i.sortOrder])).toEqual([['Trauung', 1], ['Sektempfang', 2], ['Gruppenfoto', 3]])
  expect(stored[0].plannedStart.toISOString()).toBe(summer('14:00'))

  await page.goto(`/admin/events/${event.id}/plan?track=${track.id}`)
  await expect(page.getByText('Puffer 30 Min')).toBeVisible()
  await page.getByRole('button', { name: '„Gruppenfoto“ nach oben' }).click()
  await expect(page.getByText('Reihenfolge geändert.')).toBeVisible()

  // B übernimmt den Beginn von A, A folgt mit demselben Abstand - das Ende des Blocks bleibt.
  const foto = await prisma.item.findFirstOrThrow({ where: { eventId: event.id, title: 'Gruppenfoto' } })
  const sekt = await prisma.item.findFirstOrThrow({ where: { eventId: event.id, title: 'Sektempfang' } })
  expect(foto.plannedStart.toISOString()).toBe(summer('14:45'))
  expect(sekt.plannedStart.toISOString()).toBe(summer('15:45'))
  expect(foto.sortOrder).toBeLessThan(sekt.sortOrder)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).liveVersion).toBeGreaterThanOrEqual(4)
})

test('Gleichzeitig bearbeitet: der zweite veraltete Stand wird abgelehnt statt überschrieben', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const { event, a } = await planWithTwoItems(owner.id)
  const second = await browser.newPage()
  await login(second, owner.email)

  await page.goto(`/admin/events/${event.id}/items/${a.id}`)
  await second.goto(`/admin/events/${event.id}/items/${a.id}`)
  await page.getByLabel('Titel').fill('Trauung im Garten')
  await page.getByRole('button', { name: 'Punkt speichern' }).click()
  await expect(page.getByText('Punkt gespeichert.')).toBeVisible()

  await second.getByLabel('Titel').fill('Trauung in der Kirche')
  await second.getByRole('button', { name: 'Punkt speichern' }).click()
  await expect(pageAlert(second)).toContainText('inzwischen geändert')
  expect((await prisma.item.findUniqueOrThrow({ where: { id: a.id } })).title).toBe('Trauung im Garten')
})

test('„Wartet auf“ mit Schleife wird abgelehnt', async ({ page }) => {
  const owner = await loggedIn(page)
  const { event, a } = await planWithTwoItems(owner.id)
  // Trauung wartet auf den Sektempfang, der in der Kette nach ihr kommt: Schleife.
  await page.goto(`/admin/events/${event.id}/items/${a.id}`)
  await page.getByText('Wartet auf (0 gewählt)').click()
  await page.getByLabel(/Sektempfang/).check()
  await page.getByRole('button', { name: 'Punkt speichern' }).click()
  await expect(pageAlert(page)).toContainText('Schleife (')
  expect(await prisma.itemDependency.count({ where: { itemId: a.id } })).toBe(0)
})

test('Moderator*in ohne Schalter: Plan nur ansehen, nachgespielte Aktionen wirkungslos - mit Schalter wirksam', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const { event, track, a, b } = await planWithTwoItems(owner.id)
  const moderator = await createAccount('MODERATOR')
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })

  // Formulare als Besitzer*in lesen.
  await page.goto(`/admin/events/${event.id}/items/new?track=${track.id}`)
  const create = await readForm(page, 'form:has(input[name="title"])')
  await page.goto(`/admin/events/${event.id}/items/${a.id}`)
  const update = await readForm(page, 'form:has(input[name="title"])')
  const remove = await readForm(page, 'form:has(button:text("Punkt löschen"))')
  await page.goto(`/admin/events/${event.id}/plan?track=${track.id}`)
  const move = await readForm(page, `form:has(input[name="otherId"][value="${a.id}"])`)
  const newTrack = await readForm(page, 'form:has(button:text("Spur anlegen"))')

  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  await modPage.goto(`/admin/events/${event.id}/plan?track=${track.id}`)
  await expect(modPage.getByText('Trauung')).toBeVisible()
  await expect(modPage.getByText('Du kannst den Plan ansehen, aber nicht bearbeiten.')).toBeVisible()
  await expect(modPage.getByRole('link', { name: 'Neuer Punkt' })).toHaveCount(0)
  await expect(modPage.getByRole('link', { name: /bearbeiten/ })).toHaveCount(0)
  await expect(modPage.getByRole('button', { name: /nach oben/ })).toHaveCount(0)
  await expect(modPage.getByRole('heading', { name: 'Spuren' })).toHaveCount(0)
  await modPage.goto(`/admin/events/${event.id}/items/${a.id}`)
  await expect(modPage).toHaveURL(new RegExp(`/admin/events/${event.id}/plan`))

  await submitForm(modPage, create, { title: 'Von Moderation angelegt' })
  await submitForm(modPage, update, { title: 'Von Moderation geändert' })
  await submitForm(modPage, move)
  await submitForm(modPage, remove)
  await submitForm(modPage, newTrack, { name: 'Spur der Moderation' })
  expect(await prisma.item.count({ where: { eventId: event.id } })).toBe(2)
  expect((await prisma.item.findUniqueOrThrow({ where: { id: a.id } })).title).toBe('Trauung')
  expect((await prisma.item.findUniqueOrThrow({ where: { id: b.id } })).sortOrder).toBe(2)
  expect(await prisma.track.count({ where: { eventId: event.id } })).toBe(1)

  // Positivkontrolle: Mit dem Schalter "Plan bearbeiten" wirken dieselben POSTs der Moderation.
  await prisma.event.update({ where: { id: event.id }, data: { modsMayEditPlan: true } })
  await submitForm(modPage, update, { title: 'Von Moderation geändert' })
  expect((await prisma.item.findUniqueOrThrow({ where: { id: a.id } })).title).toBe('Von Moderation geändert')
  await submitForm(modPage, move)
  expect((await prisma.item.findUniqueOrThrow({ where: { id: b.id } })).sortOrder).toBe(1)
  await submitForm(modPage, create, { title: 'Von Moderation angelegt' })
  expect(await prisma.item.count({ where: { eventId: event.id, title: 'Von Moderation angelegt' } })).toBe(1)

  // Spuren bleiben auch mit Schalter bei Besitzer*in - Positivkontrolle: derselbe POST als Besitzer*in.
  await submitForm(modPage, newTrack, { name: 'Spur der Moderation' })
  expect(await prisma.track.count({ where: { eventId: event.id } })).toBe(1)
  await submitForm(page, newTrack, { name: 'Brautpaar' })
  expect(await prisma.track.count({ where: { eventId: event.id } })).toBe(2)

  // Live: Anlegen und Löschen braucht dann den Schalter "Einschübe und Löschen".
  await prisma.event.update({ where: { id: event.id }, data: { status: 'LIVE' } })
  await submitForm(modPage, remove)
  expect(await prisma.item.count({ where: { id: a.id } })).toBe(1)
  await prisma.event.update({ where: { id: event.id }, data: { modsMayInsert: true } })
  await submitForm(modPage, remove)
  expect(await prisma.item.count({ where: { id: a.id } })).toBe(0)
})

test('Geheimer Punkt: Besitzer*in ohne Eintrag sieht nur Zeit und Dauer und ändert nichts - eingetragene Moderator*in schon', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const event = await createEventRecord(owner.id, { date: SUMMER_DAY })
  const track = await createTrackRecord(event.id)
  const moderator = await createAccount('MODERATOR')
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  await prisma.event.update({ where: { id: event.id }, data: { modsMayEditPlan: true } })
  const party = await createItemRecord(event, track.id, { title: 'Party', start: '21:00', durationMin: 60, sortOrder: 1 })
  const secret = await createItemRecord(event, track.id, {
    title: 'Überraschung Feuerwerk', location: 'Seewiese', description: 'Pyroshow am Steg', internalNote: 'Zünder bei Tom',
    visibility: 'SECRET', secretViewers: [moderator.id], start: '22:00', durationMin: 15, sortOrder: 2
  })
  const secretTexts = ['Überraschung Feuerwerk', 'Seewiese', 'Pyroshow', 'Zünder bei Tom', moderator.email]

  // Besitzer*in: weder im HTML (inkl. RSC-Daten) der Liste noch im Export - nur der Platzhalter mit Zeit.
  for (const url of [`/admin/events/${event.id}/plan`, `/admin/events/${event.id}/plan?track=${track.id}`]) {
    const html = await (await page.goto(url))!.text()
    for (const text of secretTexts) expect(html).not.toContain(text)
    expect(html).toContain('Geheimer Punkt')
  }
  await expect(page.getByRole('link', { name: '„Geheimer Punkt“ bearbeiten' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '„Party“ nach unten' })).toHaveCount(0)
  const exported = await page.request.get(`/admin/events/${event.id}/export`, { headers: { cookie: await cookieOf(page) } })
  expect(exported.status()).toBe(200)
  const file = await exported.text()
  for (const text of secretTexts) expect(file).not.toContain(text)
  expect(JSON.parse(file).items[1]).toMatchObject({ title: 'Geheimer Punkt', visibility: 'SECRET', durationMin: 15 })
  await page.goto(`/admin/events/${event.id}/items/${secret.id}`)
  await expect(page).toHaveURL(new RegExp(`/admin/events/${event.id}/plan`))

  // Eingetragene Moderator*in sieht alles und liefert die Formulare.
  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  await modPage.goto(`/admin/events/${event.id}/items/${secret.id}`)
  await expect(modPage.getByLabel('Titel')).toHaveValue('Überraschung Feuerwerk')
  const update = await readForm(modPage, 'form:has(input[name="title"])')
  const remove = await readForm(modPage, 'form:has(button:text("Punkt löschen"))')
  await modPage.goto(`/admin/events/${event.id}/plan?track=${track.id}`)
  await expect(modPage.getByText('Notiz: Zünder bei Tom')).toBeVisible()
  const moveUp = await readForm(modPage, `form:has(input[name="itemId"][value="${secret.id}"])`)

  // Besitzer*in spielt sie nach: ändern, tauschen (auch vom Nachbarn aus), löschen - alles wirkungslos.
  await submitForm(page, update, { title: 'Enthüllt' })
  await submitForm(page, moveUp)
  await submitForm(page, moveUp, { itemId: party.id, otherId: secret.id })
  await submitForm(page, remove)
  const unchanged = await prisma.item.findUniqueOrThrow({ where: { id: secret.id } })
  expect(unchanged).toMatchObject({ title: 'Überraschung Feuerwerk', sortOrder: 2, version: 1 })

  // Positivkontrolle: dieselben POSTs der eingetragenen Moderator*in wirken.
  await submitForm(modPage, update, { title: 'Überraschung Lichtshow' })
  expect((await prisma.item.findUniqueOrThrow({ where: { id: secret.id } })).title).toBe('Überraschung Lichtshow')
  await submitForm(modPage, moveUp)
  expect((await prisma.item.findUniqueOrThrow({ where: { id: secret.id } })).sortOrder).toBe(1)
  await submitForm(modPage, remove)
  expect(await prisma.item.count({ where: { id: secret.id } })).toBe(0)
})

test('Einstellungen, Schalter und Status nur für Besitzer*in - Moderator*in und fremdes Konto wirkungslos', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const { event, track } = await planWithTwoItems(owner.id)
  const moderator = await createAccount('MODERATOR')
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })

  await page.goto(`/admin/events/${event.id}`)
  const options = await readForm(page, 'form:has(input[name="guestHorizonMin"])')
  const publish = await readForm(page, 'form:has(input[name="status"][value="PUBLISHED"])')
  await page.goto(`/admin/events/${event.id}/items/new?track=${track.id}`)
  const create = await readForm(page, 'form:has(input[name="title"])')

  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  await submitForm(modPage, options, { modsMayEditPlan: 'on', guestHorizonMin: '30' })
  await submitForm(modPage, publish)

  const stranger = await browser.newPage()
  await login(stranger, (await createAccount('CREATOR')).email)
  expect((await stranger.goto(`/admin/events/${event.id}/plan`))?.status()).toBe(404)
  expect((await stranger.request.get(`/admin/events/${event.id}/export`, { headers: { cookie: await cookieOf(stranger) } })).status()).toBe(404)
  await submitForm(stranger, options, { modsMayEditPlan: 'on', guestHorizonMin: '30' })
  await submitForm(stranger, publish)
  await submitForm(stranger, create, { title: 'Fremd angelegt' })

  let stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } })
  expect(stored).toMatchObject({ modsMayEditPlan: false, guestHorizonMin: 120, status: 'DRAFT' })
  expect(await prisma.item.count({ where: { eventId: event.id } })).toBe(2)

  // Positivkontrolle
  await submitForm(page, options, { modsMayEditPlan: 'on', guestHorizonMin: '30' })
  await submitForm(page, publish)
  await submitForm(page, create, { title: 'Von Besitzer*in' })
  stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } })
  expect(stored).toMatchObject({ modsMayEditPlan: true, guestHorizonMin: 30, status: 'PUBLISHED' })
  expect(await prisma.item.count({ where: { eventId: event.id } })).toBe(3)

  // LIVE setzt nur die Live-Steuerung, auch nicht nachgespielt.
  await submitForm(page, publish, { status: 'LIVE' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('PUBLISHED')
})

test('Import: gültige Datei legt ein neues Event an, Schleifen und ungültige Daten werden abgelehnt', async ({ page }) => {
  const user = await loggedIn(page)

  async function tryImport(name: string, content: string, slug: string, date = '') {
    await page.goto('/admin/events/import')
    await page.getByLabel('Datei (JSON)').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) })
    await page.getByLabel('Adresse').fill(slug)
    if (date) await page.getByLabel('Datum').fill(date)
    await page.getByRole('button', { name: 'Importieren' }).click()
  }

  const cyclic = structuredClone(WEDDING_TEMPLATE)
  cyclic.items.find(i => i.key === 'shooting')!.waitsFor = ['kaffee']
  const slug = uniqueSlug('import')
  await tryImport('schleife.json', JSON.stringify(cyclic), slug)
  await expect(pageAlert(page)).toContainText('Schleife')

  await tryImport('kaputt.json', '{ kein json', slug)
  await expect(pageAlert(page)).toContainText('kein gültiges JSON')

  const invalid = structuredClone(WEDDING_TEMPLATE)
  ;(invalid.items[0] as { durationMin: number }).durationMin = -1
  await tryImport('ungueltig.json', JSON.stringify(invalid), slug)
  await expect(pageAlert(page)).toContainText('items.0.durationMin')

  await tryImport('fremd.json', JSON.stringify({ format: 'seating-plan', layout: {} }), slug)
  await expect(pageAlert(page)).toContainText('keine Ablauf-Datei')
  expect(await prisma.event.count({ where: { slug } })).toBe(0)

  // Gültig: Tag aus dem Formular, Titel aus der Datei.
  await tryImport('hochzeit.json', JSON.stringify(WEDDING_TEMPLATE), slug, '2026-06-27')
  await expect(page.getByText('Ablauf importiert.')).toBeVisible()
  const event = await prisma.event.findUniqueOrThrow({ where: { slug }, include: { items: { include: { secretViewers: true } } } })
  expect(event).toMatchObject({ title: 'Hochzeit', status: 'DRAFT', ownerId: user.id, modsMayEditPlan: false })
  expect(event.items.find(i => i.title === 'Trauung')?.plannedStart.toISOString()).toBe(summer('14:00', '2026-06-27'))
  expect(event.items.find(i => i.visibility === 'SECRET')?.secretViewers.map(v => v.userId)).toEqual([user.id])
})

test('Duplizieren: neuer Tag, gleiche Uhrzeiten, ohne Freigaben - geheime Punkte ohne Eintrag als Platzhalter', async ({ page }) => {
  const owner = await loggedIn(page)
  const event = await createEventRecord(owner.id, { date: SUMMER_DAY })
  const track = await createTrackRecord(event.id)
  const moderator = await createAccount('MODERATOR')
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  await prisma.event.update({ where: { id: event.id }, data: { modsMayEditPlan: true, guestHorizonMin: 60 } })
  const trauung = await createItemRecord(event, track.id, { title: 'Trauung', start: '14:00', durationMin: 45, sortOrder: 1, internalNote: 'Mikro 2' })
  const secret = await createItemRecord(event, track.id, { title: 'Überraschung', description: 'Feuerwerk', visibility: 'SECRET', secretViewers: [moderator.id], start: '22:00', sortOrder: 2 })
  await prisma.itemDependency.create({ data: { itemId: secret.id, waitsForItemId: trauung.id } })

  await page.goto(`/admin/events/${event.id}`)
  await page.getByRole('link', { name: 'Duplizieren' }).click()
  await expect(page.getByRole('heading', { name: 'Event duplizieren' })).toBeVisible()
  const slug = uniqueSlug('kopie')
  await page.getByLabel('Adresse', { exact: true }).fill(slug)
  await page.getByLabel('Datum').fill('2026-07-04')
  await page.getByRole('button', { name: 'Kopie anlegen' }).click()
  await expect(page.getByText('Kopie angelegt.')).toBeVisible()

  const copy = await prisma.event.findUniqueOrThrow({
    where: { slug },
    include: { shares: true, items: { include: { secretViewers: true, waitsFor: true }, orderBy: { sortOrder: 'asc' } } }
  })
  expect(copy).toMatchObject({ title: 'Testevent (Kopie)', status: 'DRAFT', ownerId: owner.id, modsMayEditPlan: false, guestHorizonMin: 60 })
  expect(copy.shares).toHaveLength(0)
  expect(copy.items[0]).toMatchObject({ title: 'Trauung', internalNote: 'Mikro 2', plannedStart: new Date(summer('14:00', '2026-07-04')) })
  expect(copy.items[1]).toMatchObject({ title: 'Geheimer Punkt', description: null, visibility: 'SECRET', plannedDurationMin: 30 })
  expect(copy.items[1].secretViewers.map(v => v.userId)).toEqual([owner.id])
  expect(copy.items[1].waitsFor.map(d => d.waitsForItemId)).toEqual([copy.items[0].id])
})

test('Neues Datum verschiebt alle Punkte mit, Uhrzeiten bleiben - auch über die Zeitumstellung', async ({ page }) => {
  const owner = await loggedIn(page)
  const { event, a } = await planWithTwoItems(owner.id)
  await page.goto(`/admin/events/${event.id}`)
  await page.getByLabel('Datum').fill('2026-10-25')
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText('alle Punkte auf den neuen Tag verschoben')).toBeVisible()
  // 14:00 Winterzeit = 13:00 UTC
  expect((await prisma.item.findUniqueOrThrow({ where: { id: a.id } })).plannedStart.toISOString()).toBe('2026-10-25T13:00:00.000Z')
})

test('Reihen: anlegen, Event zuordnen, Adressen teilen sich einen Namensraum mit Events', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const event = await createEventRecord(owner.id, { slug: uniqueSlug('reihen-event') })

  await page.goto('/admin/series')
  await page.getByLabel('Titel').fill('Hochzeitswochenende')
  await page.getByLabel('Adresse').fill(event.slug)
  await page.getByRole('button', { name: 'Reihe anlegen' }).click()
  await expect(pageAlert(page)).toContainText('schon vergeben')

  const seriesSlug = uniqueSlug('wochenende')
  await page.getByLabel('Adresse').fill(seriesSlug)
  await page.getByRole('button', { name: 'Reihe anlegen' }).click()
  await expect(page.getByText('Reihe angelegt.')).toBeVisible()
  const series = await prisma.series.findUniqueOrThrow({ where: { slug: seriesSlug } })

  // Event der Reihe zuordnen; seine Adresse darf nicht die der Reihe werden.
  await page.goto(`/admin/events/${event.id}`)
  await page.getByLabel('Reihe (optional)').selectOption({ label: 'Hochzeitswochenende' })
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible()
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).seriesId).toBe(series.id)
  await page.getByLabel('Adresse', { exact: true }).fill(seriesSlug)
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(pageAlert(page)).toContainText('schon vergeben')

  // Fremde Reihen: keine Seite, keine Zuordnung (nachgespielt) - Positivkontrolle über die eigene.
  const other = await browser.newPage()
  const otherUser = await createAccount('CREATOR')
  await login(other, otherUser.email)
  expect((await other.goto(`/admin/series/${series.id}`))?.status()).toBe(404)
  const otherEvent = await createEventRecord(otherUser.id)
  await other.goto(`/admin/events/${otherEvent.id}`)
  const settings = await readForm(other, 'form:has(input[name="title"])')
  await submitForm(other, settings, { seriesId: series.id })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: otherEvent.id } })).seriesId).toBeNull()
  const ownSeries = await prisma.series.create({ data: { slug: uniqueSlug('eigene'), title: 'Eigene', ownerId: otherUser.id } })
  await submitForm(other, settings, { seriesId: ownSeries.id })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: otherEvent.id } })).seriesId).toBe(ownSeries.id)

  // Löschen der Reihe lässt die Events stehen.
  await page.goto(`/admin/series/${series.id}`)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Reihe löschen' }).click()
  await expect(page.getByText('Reihe gelöscht.')).toBeVisible()
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).seriesId).toBeNull()
})
