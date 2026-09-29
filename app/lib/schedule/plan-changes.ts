// app/lib/schedule/plan-changes.ts
import { byTrack, checkDependencies } from './dependencies'
import { isActive, project } from './project'
import type { PlanChange, ProjectSettings, ScheduleItem } from './types'

const MINUTE = 60_000

/** Wendet Planänderungen (aus swapAdjacent/insertAfter) auf eine Liste an - für Vorschau und Tests. */
export function applyChanges<T extends ScheduleItem>(items: T[], changes: PlanChange[]): T[] {
  const byId = new Map(changes.map(change => [change.id, change]))
  return items.map(item => {
    const change = byId.get(item.id)
    if (!change) return item
    return {
      ...item,
      ...(change.plannedStart ? { plannedStart: change.plannedStart } : {}),
      ...(change.sortOrder !== undefined ? { sortOrder: change.sortOrder } : {})
    }
  })
}

export type SwapRefusal = 'not-found' | 'not-adjacent' | 'inactive' | 'started' | 'anchor' | 'cycle'

/**
 * Tauscht zwei benachbarte Punkte einer Spur im aktuellen Plan (docs/KONZEPT.md Abschnitt 3): B übernimmt
 * den geplanten Beginn von A, A beginnt nach B mit demselben Abstand wie vorher. Das Ende des Blocks bleibt
 * gleich, alle folgenden Punkte sind unberührt. Ein Tausch ist eine Fahrplanänderung, keine Verspätung.
 *
 * Absichtsbasiert: Beide ids werden genannt, und sie müssen JETZT Nachbarn sein - hat inzwischen jemand
 * anderes getauscht, wird abgelehnt statt etwas anderes zu tauschen. Benachbart heißt: kein aktiver Punkt
 * dazwischen (ausgefallene und zurückgestellte zählen nicht). Nur geplante Punkte, keine Anker. Gemeldete
 * Verspätungen bleiben an ihrem Punkt.
 */
export function swapAdjacent(items: ScheduleItem[], firstId: string, secondId: string): { ok: true; changes: PlanChange[] } | { ok: false; reason: SwapRefusal } {
  if (firstId === secondId) return { ok: false, reason: 'not-adjacent' }
  const first = items.find(i => i.id === firstId)
  const second = items.find(i => i.id === secondId)
  if (!first || !second) return { ok: false, reason: 'not-found' }
  if (!isActive(first) || !isActive(second)) return { ok: false, reason: 'inactive' }
  if (first.actualStart || first.actualEnd || second.actualStart || second.actualEnd) return { ok: false, reason: 'started' }
  if (first.isAnchor || second.isAnchor) return { ok: false, reason: 'anchor' }
  if (first.trackId !== second.trackId) return { ok: false, reason: 'not-adjacent' }

  const track = byTrack(items.filter(i => i.trackId === first.trackId && isActive(i))).get(first.trackId)!
  const [a, b] = first.sortOrder < second.sortOrder ? [first, second] : [second, first]
  if (track.indexOf(b) !== track.indexOf(a) + 1) return { ok: false, reason: 'not-adjacent' }

  const aStart = a.plannedStart.getTime()
  const gap = b.plannedStart.getTime() - (aStart + a.plannedDurationMin * MINUTE)
  const changes: PlanChange[] = [
    { id: b.id, plannedStart: a.plannedStart, sortOrder: a.sortOrder },
    { id: a.id, plannedStart: new Date(aStart + b.plannedDurationMin * MINUTE + gap), sortOrder: b.sortOrder }
  ]
  if (checkDependencies(applyChanges(items, changes))) return { ok: false, reason: 'cycle' }
  return { ok: true, changes }
}

export type InsertRefusal = 'not-found' | 'inactive' | 'duplicate' | 'cycle' | 'unknown'

/**
 * Einschub (docs/KONZEPT.md Abschnitt 3): ein neuer Punkt direkt nach `afterId` in derselben Spur. Er
 * beginnt laut Plan, wenn `afterId` laut Prognose endet - frühestens jetzt, auf die volle Minute
 * aufgerundet -, damit er selbst nicht als verspätet gilt. Die geplanten Zeiten der folgenden Punkte bleiben;
 * sie rutschen über die normale Kette (Puffer schlucken, Anker bleiben, Konflikte erscheinen).
 *
 * changes schafft nur Platz in der Reihenfolge (sortOrder), falls der nächste Wert schon vergeben ist.
 */
export function insertAfter<T extends ScheduleItem>(
  items: T[],
  afterId: string,
  fresh: Omit<T, 'trackId' | 'sortOrder' | 'plannedStart'>,
  now: Date,
  settings: ProjectSettings
): { ok: true; item: T; changes: PlanChange[] } | { ok: false; reason: InsertRefusal } {
  const after = items.find(i => i.id === afterId)
  if (!after) return { ok: false, reason: 'not-found' }
  if (!isActive(after)) return { ok: false, reason: 'inactive' }
  if (items.some(i => i.id === fresh.id)) return { ok: false, reason: 'duplicate' }

  const projection = project(items, now, settings)
  if (!projection.ok) return { ok: false, reason: projection.problem.kind }
  const afterEnd = projection.items.find(i => i.id === afterId)!.expectedEnd.getTime()
  const start = Math.ceil(Math.max(afterEnd, now.getTime()) / MINUTE) * MINUTE

  const sortOrder = after.sortOrder + 1
  const sameTrack = items.filter(i => i.trackId === after.trackId)
  const changes: PlanChange[] = sameTrack.some(i => i.sortOrder === sortOrder)
    ? sameTrack.filter(i => i.sortOrder > after.sortOrder).sort((x, y) => x.sortOrder - y.sortOrder).map(i => ({ id: i.id, sortOrder: i.sortOrder + 1 }))
    : []

  const item = { ...fresh, trackId: after.trackId, sortOrder, plannedStart: new Date(start) } as T
  const problem = checkDependencies([...applyChanges(items, changes), item])
  if (problem) return { ok: false, reason: problem.kind }
  return { ok: true, item, changes }
}
