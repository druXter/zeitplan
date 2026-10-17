import { expect, test } from '@playwright/test'
import { createAccount, createEventRecord, createItemRecord, createTrackRecord, login, prisma, readForm, submitForm, SUMMER_DAY } from './helpers'
import { crewToken } from '../../app/lib/guest/tokens'
import { zonedDateToUtc } from '../../app/lib/timezone'

// Orte mit Adresse (L22), Team-Link für Dienstleister (L18), Regieplan und Programmheft (L21), Zuständige und
// "Meine Punkte" (L16) - mit Angriffsfällen und Positivkontrolle.

async function setup(status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' = 'PUBLISHED', date = SUMMER_DAY) {
  const owner = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  await prisma.user.update({ where: { id: moderator.id }, data: { name: 'Mo Deratorin' } })
  const event = await createEventRecord(owner.id, { status, date, title: 'Orte-Hochzeit' })
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  const track = await createTrackRecord(event.id)
  const team = await createTrackRecord(event.id, { name: 'Technik', visibility: 'TEAM', sortOrder: 2 })
  const trauung = await createItemRecord(event, track.id, { title: 'Trauung', start: '14:00', durationMin: 45, sortOrder: 1, location: 'Kirche St. Marien', description: 'Bitte pünktlich', internalNote: 'Ringe bei Trauzeugin' })
  await createItemRecord(event, track.id, { title: 'Aufbau Bar', start: '15:00', durationMin: 30, sortOrder: 2, visibility: 'TEAM', location: 'Lager', internalNote: 'Kühlschrank' })
  await createItemRecord(event, track.id, { title: 'Flashmob', start: '16:00', durationMin: 10, sortOrder: 3, visibility: 'SECRET', secretViewers: [owner.id], internalNote: 'Song: Dancing Queen' })
  await createItemRecord(event, team.id, { title: 'Lichtprobe', start: '13:00', durationMin: 30, sortOrder: 1, internalNote: 'Sicherung 3' })
  await prisma.place.create({ data: { eventId: event.id, name: 'Lager', address: 'Geheimweg 7, Hinterhof' } })
  return { owner, moderator, event, trauung }
}

test('Orte (L22): anlegen in der Planung, Gäste sehen Adresse und Route nur an öffentlichen Punkten, Umbenennen zieht mit', async ({ page, browser }) => {
  const { owner, event, trauung } = await setup()
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/plan`)
  const places = page.locator('#orte')
  await places.locator('summary').first().click()
  await places.getByText('Neuer Ort').click()
  await places.getByLabel('Name (wie im Feld „Ort“)').last().fill('kirche st. marien')
  await places.getByLabel('Adresse').last().fill('Marienplatz 1, 12345 Musterstadt')
  await places.getByRole('button', { name: 'Ort anlegen' }).click()
  await expect(places.getByText('Ort angelegt.')).toBeVisible()
  await expect(page.locator('[data-item]', { hasText: 'Trauung' })).toContainText('Marienplatz 1, 12345 Musterstadt')

  // Gäste: Adresse und Route am öffentlichen Punkt, nichts von der Adresse des Team-Punkts.
  const guest = await browser.newPage()
  await guest.goto(`/${event.slug}`)
  await expect(guest.getByText('Marienplatz 1, 12345 Musterstadt')).toBeVisible()
  const route = guest.getByRole('link', { name: 'Route öffnen' })
  await expect(route).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=Marienplatz%201%2C%2012345%20Musterstadt')
  await expect(route).toHaveAttribute('rel', 'noopener noreferrer')
  const json = await (await guest.request.get(`/api/view/${event.slug}`)).text()
  expect(json).toContain('Marienplatz 1')
  expect(json).not.toContain('Geheimweg')
  expect(await guest.content()).not.toContain('Geheimweg')

  // Doppelter Name wird abgelehnt.
  await page.goto(`/admin/events/${event.id}/plan`)
  await places.locator('summary').first().click()
  await places.getByText('Neuer Ort').click()
  await places.getByLabel('Name (wie im Feld „Ort“)').last().fill('LAGER')
  await places.getByLabel('Adresse').last().fill('Irgendwo 1')
  await places.getByRole('button', { name: 'Ort anlegen' }).click()
  await expect(places.getByText('Name: Diesen Ort gibt es schon.')).toBeVisible()

  // Umbenennen ändert den Ort am Punkt mit (neue Version).
  const place = await prisma.place.findFirstOrThrow({ where: { eventId: event.id, address: { startsWith: 'Marienplatz' } } })
  await page.goto(`/admin/events/${event.id}/plan`)
  await places.locator('summary').first().click()
  const entry = page.locator(`[data-place="${place.name}"]`)
  await entry.locator('summary').click()
  await entry.getByLabel('Name (wie im Feld „Ort“)').fill('Marienkirche')
  await entry.getByRole('button', { name: 'Ort speichern' }).click()
  // Der Eintrag heißt danach anders.
  await expect(page.locator('[data-place="Marienkirche"]').getByText('Ort gespeichert.')).toBeVisible()
  const renamed = await prisma.item.findUniqueOrThrow({ where: { id: trauung.id } })
  expect(renamed.location).toBe('Marienkirche')
  expect(renamed.version).toBe(trauung.version + 1)
  await guest.close()
})

test('Orte (L22): Moderator*in ohne Planrecht kann keinen Ort anlegen (Positivkontrolle mit Schalter)', async ({ page }) => {
  const { moderator, event } = await setup()
  await login(page, moderator.email)
  await page.goto(`/admin/events/${event.id}/plan`)
  await expect(page.locator('#orte').getByText('Neuer Ort')).toHaveCount(0)

  // Formular vom Besitzer-Stand nachbauen und direkt abschicken.
  await prisma.event.update({ where: { id: event.id }, data: { modsMayEditPlan: true } })
  await page.goto(`/admin/events/${event.id}/plan`)
  await page.locator('#orte > summary').click()
  await page.locator('#orte').getByText('Neuer Ort').click()
  const form = await readForm(page, '#orte form:has(button:text("Ort anlegen"))')
  await prisma.event.update({ where: { id: event.id }, data: { modsMayEditPlan: false } })
  const fields = form.fields.map(([name, value]): [string, string] => name === 'name' ? [name, 'Hacker-Ort'] : name === 'address' ? [name, 'X'] : [name, value])
  await submitForm(page, { ...form, fields })
  expect(await prisma.place.count({ where: { eventId: event.id, name: 'Hacker-Ort' } })).toBe(0)

  // Positivkontrolle: mit Schalter klappt derselbe Weg.
  await prisma.event.update({ where: { id: event.id }, data: { modsMayEditPlan: true } })
  await submitForm(page, { ...form, fields })
  expect(await prisma.place.count({ where: { eventId: event.id, name: 'Hacker-Ort' } })).toBe(1)
})

test('Team-Link (L18): aus, ein, neu, aus - nur Besitzer*in schaltet, Link zeigt Team-Daten ohne Geheimes', async ({ page, browser }) => {
  const { owner, moderator, event } = await setup()
  const visitor = await browser.newPage()

  // Standardmäßig aus: auch ein (theoretisch) richtiger Schlüssel öffnet nichts.
  expect((await visitor.goto(`/${event.slug}/team?k=${crewToken(event.id, 1)}`))!.status()).toBe(404)

  // Moderator*in sieht den Abschnitt, kann aber nicht einschalten - auch nicht per nachgebautem Formular.
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}`)
  const ownerForm = await readForm(page, '#team-link form')
  const moderatorPage = await browser.newPage()
  await login(moderatorPage, moderator.email)
  await moderatorPage.goto(`/admin/events/${event.id}`)
  await expect(moderatorPage.locator('#team-link')).toContainText('Ausgeschaltet')
  await submitForm(moderatorPage, ownerForm)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).crewLinkEnabled).toBe(false)

  await page.locator('#team-link').getByRole('button', { name: 'Team-Link einschalten' }).click()
  await expect(page.getByText('Team-Link eingeschaltet.')).toBeVisible()
  const link = await page.locator('#team-link').getByRole('textbox', { name: 'Team-Link (nur lesen)' }).inputValue()
  expect(link).toContain(`/${event.slug}/team?k=`)

  // Dienstleister ohne Konto: Team-Punkte, Team-Spur, interne Notizen, Zuständige mit Namen - geheimer Punkt nur als Platzhalter.
  const trauung = await prisma.item.findFirstOrThrow({ where: { eventId: event.id, title: 'Trauung' } })
  await prisma.itemAssignee.create({ data: { itemId: trauung.id, userId: moderator.id } })
  const path = new URL(link).pathname + new URL(link).search
  expect((await visitor.goto(path))!.status()).toBe(200)
  for (const text of ['Trauung', 'Ringe bei Trauzeugin', 'Aufbau Bar', 'Kühlschrank', 'Lichtprobe', 'Sicherung 3', 'Geheimweg 7', 'Zuständig: Mo Deratorin', 'Geheimer Punkt']) {
    await expect(visitor.getByText(text, { exact: false }).first(), text).toBeVisible()
  }
  const html = await visitor.content()
  for (const secret of ['Flashmob', 'Dancing Queen', moderator.email, owner.email, '/admin/events']) expect(html, secret).not.toContain(secret)

  // Falscher Schlüssel, Tafel-Schlüssel statt Team-Schlüssel: 404.
  expect((await visitor.goto(`/${event.slug}/team?k=falsch`))!.status()).toBe(404)
  expect((await visitor.goto(`/${event.slug}/team`))!.status()).toBe(404)

  // Neu erzeugen: alter Link tot, neuer geht.
  page.once('dialog', dialog => dialog.accept())
  await page.locator('#team-link').getByRole('button', { name: 'Neuen Team-Link erzeugen' }).click()
  await expect(page.getByText('Neuer Team-Link erzeugt.')).toBeVisible()
  expect((await visitor.goto(path))!.status()).toBe(404)
  const fresh = await page.locator('#team-link').getByRole('textbox', { name: 'Team-Link (nur lesen)' }).inputValue()
  expect((await visitor.goto(new URL(fresh).pathname + new URL(fresh).search))!.status()).toBe(200)

  // Archiviert: nichts mehr.
  await prisma.event.update({ where: { id: event.id }, data: { status: 'ARCHIVED' } })
  expect((await visitor.goto(new URL(fresh).pathname + new URL(fresh).search))!.status()).toBe(404)
  await prisma.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED' } })

  // Ausschalten: Link tot, auch nach erneutem Einschalten.
  page.once('dialog', dialog => dialog.accept())
  await page.locator('#team-link').getByRole('button', { name: 'Team-Link ausschalten' }).click()
  await expect(page.getByText('Team-Link ausgeschaltet.')).toBeVisible()
  expect((await visitor.goto(new URL(fresh).pathname + new URL(fresh).search))!.status()).toBe(404)
  await page.locator('#team-link').getByRole('button', { name: 'Team-Link einschalten' }).click()
  await expect(page.getByText('Team-Link eingeschaltet.')).toBeVisible()
  expect((await visitor.goto(new URL(fresh).pathname + new URL(fresh).search))!.status()).toBe(404)
  await visitor.close()
  await moderatorPage.close()
})

test('Druck (L21): Regieplan mit Notizen, Adressen und Zuständigen; Programmheft nur mit Öffentlichem', async ({ page }) => {
  const { owner, moderator, event } = await setup()
  const trauung = await prisma.item.findFirstOrThrow({ where: { eventId: event.id, title: 'Trauung' } })
  await prisma.itemAssignee.create({ data: { itemId: trauung.id, userId: moderator.id } })
  await prisma.place.create({ data: { eventId: event.id, name: 'Kirche St. Marien', address: 'Marienplatz 1' } })
  await prisma.item.create({ data: { eventId: event.id, trackId: trauung.trackId, title: 'Kutschfahrt', sortOrder: 4, plannedStart: new Date(trauung.plannedStart.getTime() + 3 * 3600_000), plannedDurationMin: 20, status: 'CANCELLED', cancelReason: 'Regen' } })

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/druck`)
  const plan = page.locator('main')
  for (const text of ['Regieplan: Orte-Hochzeit – Ablauf', 'Regieplan: Orte-Hochzeit – Technik', 'Ringe bei Trauzeugin', 'Marienplatz 1', 'Zuständig: Mo Deratorin', 'Flashmob', 'Sicherung 3', '[fällt aus: Regen]']) {
    await expect(plan.getByText(text, { exact: false }).first(), text).toBeVisible()
  }

  // Moderatorin ohne Eintrag sieht den geheimen Punkt nur als Platzhalter.
  const other = await page.context().browser()!.newPage()
  await login(other, moderator.email)
  await other.goto(`/admin/events/${event.id}/druck?spur=alle`)
  await expect(other.getByText('Geheimer Punkt').first()).toBeVisible()
  expect(await other.content()).not.toContain('Dancing Queen')

  // Programmheft: nur öffentliche, nicht ausgefallene Punkte in öffentlichen Spuren.
  await page.goto(`/admin/events/${event.id}/druck?art=programm`)
  await expect(page.getByText('Trauung')).toBeVisible()
  await expect(page.getByText('Kirche St. Marien, Marienplatz 1')).toBeVisible()
  await expect(page.getByAltText(/QR-Code/)).toBeVisible()
  const html = await page.content()
  for (const hidden of ['Aufbau Bar', 'Flashmob', 'Lichtprobe', 'Kutschfahrt', 'Ringe bei', 'Sicherung', 'Mo Deratorin']) expect(html, hidden).not.toContain(hidden)

  // Ohne Zugriff aufs Event: 404.
  const stranger = await createAccount('CREATOR')
  const strangerPage = await page.context().browser()!.newPage()
  await login(strangerPage, stranger.email)
  expect((await strangerPage.goto(`/admin/events/${event.id}/druck`))!.status()).toBe(404)
  await other.close()
  await strangerPage.close()
})

test('Zuständige (L16): im Formular wählen, „Meine Punkte“ in der Team-Ansicht, geheime Punkte nur für Eingetragene', async ({ page, browser }) => {
  // In der Zukunft, damit die Punkte noch kommen ("Meine Punkte" zeigt nur Kommendes und Laufendes).
  const { owner, moderator, event, trauung } = await setup('PUBLISHED', zonedDateToUtc('2027-06-19')!)
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/items/${trauung.id}`)
  await page.getByRole('checkbox', { name: 'Mo Deratorin' }).first().check()
  await page.getByRole('button', { name: 'Punkt speichern' }).click()
  await expect(page.getByText('Punkt gespeichert.')).toBeVisible()
  expect(await prisma.itemAssignee.findMany({ where: { itemId: trauung.id }, select: { userId: true } })).toEqual([{ userId: moderator.id }])

  // Geheimer Punkt: Zuständige nur aus "Geheim für" - nachgebautes Formular mit fremdem Konto scheitert.
  const flashmob = await prisma.item.findFirstOrThrow({ where: { eventId: event.id, title: 'Flashmob' } })
  await page.goto(`/admin/events/${event.id}/items/${flashmob.id}`)
  const form = await readForm(page, 'form:has(button:text("Punkt speichern"))')
  await submitForm(page, { ...form, fields: [...form.fields, ['assignees', moderator.id]] })
  expect(await prisma.itemAssignee.count({ where: { itemId: flashmob.id } })).toBe(0)
  // Positivkontrolle: das eingetragene Konto selbst geht.
  await submitForm(page, { ...form, fields: [...form.fields, ['assignees', owner.id]] })
  expect(await prisma.itemAssignee.count({ where: { itemId: flashmob.id, userId: owner.id } })).toBe(1)

  // Moderatorin: "Meine Punkte" mit erwarteter Zeit und Filter.
  const mod = await browser.newPage()
  await login(mod, moderator.email)
  await mod.goto(`/admin/events/${event.id}/team`)
  const mine = mod.locator('[data-mine]')
  await expect(mine).toContainText('Trauung')
  await expect(mine).toContainText('14:00')
  await expect(mod.locator('[data-item]', { hasText: 'Trauung' })).toContainText('deins')
  await mod.getByRole('link', { name: 'Nur meine Punkte zeigen' }).click()
  await expect(mod.locator('[data-item]')).toHaveCount(1)
  await expect(mod.getByRole('heading', { name: /Meine Punkte/ })).toBeVisible()
  await mod.close()
})
