// app/lib/shifts/forecast.ts
import { prisma } from '../prisma'
import { project } from '../schedule'
import type { ForecastItem } from './token'

/**
 * Prognose aller Programmpunkte für Schichten (app/lib/shifts/token.ts): wie die Team-Ansicht über project(), aber
 * ohne SECRET-Punkte - deren Titel verlassen Zeitplan nie, auch nicht in ein anderes internes Tool. TEAM-Punkte und
 * TEAM-Spuren sind dabei (Schichten ist intern). Keine Notizen, Orte oder Beschreibungen.
 */
export async function forecastForShifts(event: { id: string; autoCreep: boolean; creepCapMin: number; creepNudgeMin: number }, now: Date): Promise<ForecastItem[]> {
  const [tracks, rows] = await Promise.all([
    prisma.track.findMany({ where: { eventId: event.id }, select: { id: true, name: true } }),
    prisma.item.findMany({
      where: { eventId: event.id },
      select: {
        id: true, trackId: true, sortOrder: true, title: true, visibility: true, isAnchor: true, mayStartEarly: true,
        plannedStart: true, plannedDurationMin: true, minDurationMin: true, status: true, actualStart: true, actualEnd: true, reportedDelayMin: true,
        waitsFor: { select: { waitsForItemId: true } }
      }
    })
  ])
  const items = rows.map(row => ({ ...row, waitsFor: row.waitsFor.map(d => d.waitsForItemId) }))
  // Wie in der Gästeansicht: Sollte eine Schleife in der Datenbank stehen, ohne Zusammenführungen rechnen.
  let projection = project(items, now, event)
  if (!projection.ok) projection = project(items.map(item => ({ ...item, waitsFor: [] })), now, event)
  const projected = new Map(projection.ok ? projection.items.map(item => [item.id, item]) : [])
  const trackNames = new Map(tracks.map(track => [track.id, track.name]))

  return rows
    .filter(row => row.visibility !== 'SECRET')
    .map(row => {
      const p = projected.get(row.id)
      // Zurückgestellte und ausgefallene Punkte rechnet der Kern nicht - sie behalten ihren Plan.
      const start = p?.expectedStart ?? row.plannedStart
      const end = p?.expectedEnd ?? new Date(row.plannedStart.getTime() + row.plannedDurationMin * 60_000)
      return {
        itemId: row.id,
        title: row.title,
        track: trackNames.get(row.trackId) ?? '',
        plannedStart: row.plannedStart.toISOString(),
        plannedDurationMin: row.plannedDurationMin,
        forecastStart: start.toISOString(),
        forecastEnd: end.toISOString(),
        status: row.status
      }
    })
    .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart))
}
