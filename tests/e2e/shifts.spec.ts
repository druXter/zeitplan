import { expect, test } from '@playwright/test'
import { TEST_SHIFTS_BASE_URL, TEST_SHIFTS_SECRET } from '../../playwright.config'
import { createForecastRequest, openShiftsMessage } from '../../app/lib/shifts/token'
import { BASE_URL, createAccount, createEventRecord, createItemRecord, createTrackRecord, login, prisma } from './helpers'

// Anbindung an Schichten (app/lib/shifts/token.ts, Gegenstück dort app/lib/timeline/token.ts): Schichten ruft die
// Prognose ab - ohne SECRET-Punkte, mit TEAM-Punkten, nur für das verknüpfte Schichten-Event.

const SHIFTS_EVENT = 'cmshiftseventzp0001'

function request(timelineEventId: string, options: { secret?: string; aud?: string; shiftsEventId?: string } = {}) {
  return createForecastRequest({ aud: options.aud ?? new URL(BASE_URL).origin, shiftsEventId: options.shiftsEventId ?? SHIFTS_EVENT, timelineEventId }, options.secret ?? TEST_SHIFTS_SECRET)
}

test('verknüpfen, Prognose abrufen: SECRET nie, TEAM ja, Verspätung drin; Schutz', async ({ page, request: http }) => {
  const owner = await createAccount('CREATOR')
  const start = new Date(Date.now() + 60 * 60_000)
  const event = await createEventRecord(owner.id, { status: 'PUBLISHED', date: new Date(start.getTime() - 12 * 3_600_000) })
  const main = await createTrackRecord(event.id, { name: 'Ablauf' })
  const team = await createTrackRecord(event.id, { name: 'Team', visibility: 'TEAM', sortOrder: 2 })
  const dinner = await createItemRecord(event, main.id, { title: 'Dinner', start, durationMin: 60, sortOrder: 1 })
  await createItemRecord(event, main.id, { title: 'Party', start: new Date(start.getTime() + 60 * 60_000), sortOrder: 2 })
  await createItemRecord(event, team.id, { title: 'Abbau-Vorbereitung', start, sortOrder: 1, visibility: 'TEAM' })
  await createItemRecord(event, main.id, { title: 'GEHEIM-UEBERRASCHUNG', start: new Date(start.getTime() + 3 * 3_600_000), sortOrder: 3, visibility: 'SECRET' })

  // Ohne Verknüpfung: 404
  expect((await http.post('/api/schichten/forecast', { data: request(event.id) })).status()).toBe(404)

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/einstellungen?abschnitt=schichten`)
  await page.getByLabel('Schichten-Link').fill('https://fremd.example/zeitplan/cmshiftseventzp0001')
  await page.getByRole('button', { name: 'Verknüpfung speichern' }).click()
  await expect(page.locator('#schichten').getByText('Erwartet wird der Link')).toBeVisible()
  await page.getByLabel('Schichten-Link').fill(`${TEST_SHIFTS_BASE_URL}/zeitplan/${SHIFTS_EVENT}`)
  await page.getByRole('button', { name: 'Verknüpfung speichern' }).click()
  await expect(page.locator('#schichten').getByText('Verknüpft.')).toBeVisible()

  // Verspätung am Dinner: +15
  await prisma.item.update({ where: { id: dinner.id }, data: { reportedDelayMin: 15 } })
  const response = await http.post('/api/schichten/forecast', { data: request(event.id) })
  expect(response.status()).toBe(200)
  const body = await response.text()
  expect(body).not.toContain('GEHEIM')
  const message = openShiftsMessage(body, TEST_SHIFTS_SECRET)!
  expect(message).toMatchObject({ typ: 'timeline-forecast', aud: TEST_SHIFTS_BASE_URL, shiftsEventId: SHIFTS_EVENT, timelineEventId: event.id })
  const items = message.items as { itemId: string; title: string; track: string; plannedStart: string; forecastStart: string; status: string }[]
  expect(items.map(i => i.title).sort()).toEqual(['Abbau-Vorbereitung', 'Dinner', 'Party'])
  const dinnerItem = items.find(i => i.itemId === dinner.id)!
  expect(dinnerItem.plannedStart).toBe(start.toISOString())
  expect(new Date(dinnerItem.forecastStart).getTime() - start.getTime()).toBe(15 * 60_000)
  expect(items.find(i => i.title === 'Abbau-Vorbereitung')!.track).toBe('Team')

  // Falsches Secret, falscher Empfänger: 401; anderes Schichten-Event: 404
  expect((await http.post('/api/schichten/forecast', { data: request(event.id, { secret: 'x'.repeat(40) }) })).status()).toBe(401)
  expect((await http.post('/api/schichten/forecast', { data: request(event.id, { aud: 'https://evil.example' }) })).status()).toBe(401)
  expect((await http.post('/api/schichten/forecast', { data: request(event.id, { shiftsEventId: 'cmanderesevent00001' }) })).status()).toBe(404)
})
