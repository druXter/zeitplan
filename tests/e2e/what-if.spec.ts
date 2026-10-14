import { expect, test } from '@playwright/test'
import { cookieOf, createAccount, createEventRecord, createItemRecord, createTrackRecord, login, prisma } from './helpers'
import { utcToZonedDate, zonedDateToUtc } from '../../app/lib/timezone'

// Kürzbare Programmpunkte (Idee L11) und "Was wäre wenn"-Vorschau (Idee L19) auf dem Beispiel aus docs/KONZEPT.md
// Abschnitt 2 - an einem Tag in der Zukunft, damit alles noch kommt.

async function setup() {
  const owner = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const day = zonedDateToUtc(utcToZonedDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), 'Europe/Berlin'), 'Europe/Berlin')!
  const event = await createEventRecord(owner.id, { status: 'PUBLISHED', date: day, title: 'Probe-Hochzeit' })
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  const track = await createTrackRecord(event.id)
  const team = await createTrackRecord(event.id, { name: 'Team', visibility: 'TEAM', sortOrder: 2 })
  const add = (title: string, start: string, durationMin: number, sortOrder: number, extra: { isAnchor?: boolean } = {}) =>
    createItemRecord(event, track.id, { title, start, durationMin, sortOrder, ...extra })
  const trauung = await add('Trauung', '14:00', 45, 1)
  await add('Sektempfang', '14:45', 45, 2)
  await add('Gruppenfoto', '15:30', 30, 3)
  const kaffee = await add('Kaffee & Kuchen', '16:30', 90, 4)
  await add('Abendessen', '18:30', 120, 5, { isAnchor: true })
  await createItemRecord(event, team.id, { title: 'Überraschung der Trauzeugen', start: '20:00', durationMin: 15, sortOrder: 1, visibility: 'SECRET', secretViewers: [owner.id] })
  return { owner, moderator, event, trauung, kaffee }
}

test('Was wäre wenn (L19): Verspätung durchspielen - Puffer, Konflikt mit dem Anker, nichts gespeichert, Geheimes bleibt geheim', async ({ page }) => {
  const { moderator, event, trauung } = await setup()
  const versionBefore = (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).liveVersion
  await login(page, moderator.email)
  await page.goto(`/admin/events/${event.id}/plan`)
  await page.getByRole('link', { name: 'Was wäre wenn?' }).click()
  await expect(page.getByRole('heading', { name: /Was wäre wenn\?/ })).toBeVisible()
  expect(await page.content()).not.toContain('Überraschung')

  await page.getByLabel('Punkt', { exact: true }).selectOption((await page.locator('#whatif-item option', { hasText: 'Trauung' }).getAttribute('value'))!)
  await page.getByRole('button', { name: '+45' }).click()
  await expect(page).toHaveURL(new RegExp(`punkt=${trauung.id}.*schnell=45`))
  const result = page.locator('[data-whatif]')
  await expect(result.getByRole('heading', { name: '„Trauung“ +45 Min' })).toBeVisible()
  const kaffee = result.locator('[data-item]', { hasText: 'Kaffee & Kuchen' })
  await expect(kaffee).toContainText('16:45–18:15')
  await expect(kaffee).toContainText('+15 Min')
  await expect(kaffee).toContainText('Puffer davor schluckt 30 Min.')
  await expect(result.getByText('Kein Konflikt mit einem Anker.')).toBeVisible()
  await expect(result).toContainText('Ende der Spur „Ablauf“: unverändert')

  // +75: Der Puffer reicht nicht mehr, Kaffee überschneidet das Abendessen.
  await page.getByLabel('Minuten später').fill('75')
  await page.getByRole('button', { name: 'Durchspielen' }).click()
  await expect(result.getByText('„Kaffee & Kuchen“ überschneidet den Anker „Abendessen“ um 15 Min.')).toBeVisible()
  await expect(result.locator('[data-item]', { hasText: 'Abendessen' })).toContainText('Anker – rutscht nicht mit')

  // Nichts gespeichert.
  expect(await prisma.item.findUniqueOrThrow({ where: { id: trauung.id } })).toMatchObject({ reportedDelayMin: null })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).liveVersion).toBe(versionBefore)

  // Ungültige Minuten und fremde Punkte werden abgelehnt.
  await page.goto(`/admin/events/${event.id}/was-waere-wenn?punkt=${trauung.id}&plus=0`)
  await expect(page.getByText('Bitte eine Verspätung von 1 bis 600 Minuten angeben.')).toBeVisible()
  await page.goto(`/admin/events/${event.id}/was-waere-wenn?punkt=gibt-es-nicht&plus=10`)
  await expect(page.getByText('Den Punkt gibt es nicht mehr.')).toBeVisible()
})

test('Was wäre wenn (L19): nur mit Zugriff aufs Event', async ({ page }) => {
  const { event, trauung } = await setup()
  const stranger = await createAccount('CREATOR')
  await login(page, stranger.email)
  const response = await page.request.get(`/admin/events/${event.id}/was-waere-wenn?punkt=${trauung.id}&plus=20`, { headers: { cookie: await cookieOf(page) } })
  expect(response.status()).toBe(404)
  expect(await response.text()).not.toContain('Trauung')
})

test('Kürzbare Punkte (L11): im Formular festlegen, Prognose kürzt statt zu verschieben, Team sieht es, Gäste nicht', async ({ page, browser }) => {
  const { owner, event, trauung, kaffee } = await setup()
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/items/${kaffee.id}`)
  const field = page.getByLabel('Kürzbar bis (Minuten, optional)')
  await field.fill('90')
  await page.getByRole('button', { name: 'Punkt speichern' }).click()
  await expect(page.getByText('Kürzbar bis: ganze Minuten, kürzer als die Dauer – oder leer lassen.')).toBeVisible()
  await field.fill('60')
  await page.getByRole('button', { name: 'Punkt speichern' }).click()
  await expect(page.getByText('Punkt gespeichert.')).toBeVisible()
  await expect(page.locator(`[data-item="${kaffee.id}"]`)).toContainText('kürzbar bis 1 Std')
  expect((await prisma.item.findUniqueOrThrow({ where: { id: kaffee.id } })).minDurationMin).toBe(60)

  // In der Vorschau schluckt das Kürzen den Konflikt von eben.
  await page.goto(`/admin/events/${event.id}/was-waere-wenn?punkt=${trauung.id}&plus=75`)
  const result = page.locator('[data-whatif]')
  await expect(result.locator('[data-item]', { hasText: 'Kaffee & Kuchen' })).toContainText('Wird um 15 Min gekürzt (kürzbar bis 1 Std).')
  await expect(result.getByText('Kein Konflikt mit einem Anker.')).toBeVisible()

  // Echte Verspätung: Team-Ansicht und Live-Steuerung zeigen die Kürzung, kein Konflikt.
  await prisma.item.update({ where: { id: trauung.id }, data: { reportedDelayMin: 75 } })
  await page.goto(`/admin/events/${event.id}/team`)
  const row = page.locator(`[data-item="${kaffee.id}"]`)
  await expect(row).toContainText('gekürzt um 15 Min')
  await expect(row).toContainText('bis 18:30')
  await expect(page.getByText(/überschneidet/)).toHaveCount(0)

  // Gäste: neue Zeit, aber kein Wort von Kürzung oder Mindestdauer.
  const guest = await browser.newPage()
  const json = await (await guest.request.get(`/api/view/${event.slug}`)).text()
  for (const word of ['gekürzt', 'minDuration', 'shortened']) expect(json).not.toContain(word)
  await guest.goto(`/${event.slug}`)
  expect(await guest.content()).not.toContain('gekürzt')
  await guest.close()

  // Export enthält die Mindestdauer.
  const exported = await page.request.get(`/admin/events/${event.id}/export`, { headers: { cookie: await cookieOf(page) } })
  const file = await exported.json()
  expect(file.items.find((item: { title: string }) => item.title === 'Kaffee & Kuchen').minDurationMin).toBe(60)
  expect('minDurationMin' in file.items.find((item: { title: string }) => item.title === 'Trauung')).toBe(false)
})
