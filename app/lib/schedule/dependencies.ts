// app/lib/schedule/dependencies.ts
import type { DependencyProblem, ScheduleItem } from './types'

type Node = Pick<ScheduleItem, 'id' | 'trackId' | 'sortOrder' | 'waitsFor'>

/** Punkte je Spur, nach sortOrder sortiert. */
export function byTrack<T extends Pick<ScheduleItem, 'trackId' | 'sortOrder'>>(items: T[]): Map<string, T[]> {
  const tracks = new Map<string, T[]>()
  for (const item of items) {
    const list = tracks.get(item.trackId)
    if (list) list.push(item)
    else tracks.set(item.trackId, [item])
  }
  for (const list of tracks.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)
  return tracks
}

/**
 * Vorgänger jedes Punkts im Abhängigkeitsgraphen: der vorherige Punkt derselben Spur und alle Punkte aus
 * waitsFor. Unbekannte ids in waitsFor bleiben hier außen vor (die meldet checkDependencies).
 */
function predecessors(items: Node[]): Map<string, string[]> {
  const known = new Set(items.map(i => i.id))
  const result = new Map<string, string[]>()
  for (const list of byTrack(items).values()) {
    list.forEach((item, index) => {
      const before = index > 0 ? [list[index - 1].id] : []
      result.set(item.id, [...before, ...item.waitsFor.filter(id => known.has(id))])
    })
  }
  return result
}

/**
 * Reihenfolge, in der jeder Punkt erst nach allen seinen Vorgängern drankommt (topologische Sortierung,
 * docs/KONZEPT.md Abschnitt 2), oder der gefundene Zyklus. Bei Gleichstand in der Reihenfolge der Eingabe -
 * das Ergebnis ist also für dieselbe Eingabe immer gleich.
 */
export function evaluationOrder(items: Node[]): { ok: true; order: string[] } | { ok: false; cycle: string[] } {
  const preds = predecessors(items)
  const done = new Set<string>()
  const order: string[] = []
  let progress = true
  while (progress && order.length < items.length) {
    progress = false
    for (const item of items) {
      if (done.has(item.id)) continue
      if ((preds.get(item.id) ?? []).every(id => done.has(id))) {
        done.add(item.id)
        order.push(item.id)
        progress = true
      }
    }
  }
  if (order.length === items.length) return { ok: true, order }
  return { ok: false, cycle: findCycle(items.filter(i => !done.has(i.id)).map(i => i.id), preds) }
}

/**
 * Sucht unter den übrig gebliebenen Punkten einen tatsächlichen Kreis (Tiefensuche über die Vorgänger).
 * Übrig bleiben auch Punkte, die nur HINTER einem Kreis liegen - gemeldet wird nur der Kreis selbst.
 */
function findCycle(remaining: string[], preds: Map<string, string[]>): string[] {
  const open = new Set(remaining)
  const path: string[] = []
  const onPath = new Set<string>()
  const visited = new Set<string>()

  function visit(id: string): string[] | null {
    if (onPath.has(id)) return path.slice(path.indexOf(id))
    if (visited.has(id)) return null
    visited.add(id)
    onPath.add(id)
    path.push(id)
    for (const pred of preds.get(id) ?? []) {
      if (!open.has(pred)) continue
      const cycle = visit(pred)
      if (cycle) return cycle
    }
    path.pop()
    onPath.delete(id)
    return null
  }

  for (const id of remaining) {
    const cycle = visit(id)
    if (cycle) return cycle
  }
  return remaining // nicht erreichbar: übrig gebliebene Punkte enthalten immer einen Kreis
}

/**
 * Prüft die Abhängigkeiten eines Plans: unbekannte ids in waitsFor und Kreise (auch solche, die erst mit der
 * Reihenfolge der Spuren entstehen). Geprüft werden ALLE Punkte, auch zurückgestellte und ausgefallene - ein
 * zurückgestellter Punkt kann wieder eingereiht werden und würde den Kreis dann schließen. Für die Planung
 * (Speichern, Import) und als erster Schritt von project().
 */
export function checkDependencies(items: Node[]): DependencyProblem | null {
  const known = new Set(items.map(i => i.id))
  for (const item of items) {
    const unknown = item.waitsFor.find(id => !known.has(id))
    if (unknown !== undefined) return { kind: 'unknown', itemId: item.id, waitsForId: unknown }
  }
  const order = evaluationOrder(items)
  return order.ok ? null : { kind: 'cycle', itemIds: order.cycle }
}
