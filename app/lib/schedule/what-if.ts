// app/lib/schedule/what-if.ts
import { byTrack } from './dependencies'
import { currentDelayMin, LIVE_LIMITS } from './live'
import { isActive, project } from './project'
import type { Conflict, Projected, ProjectSettings, ScheduleItem } from './types'

const MINUTE = 60_000

/** "Trauung +20": der Punkt verspätet sich um so viele Minuten mehr als jetzt erwartet (Idee L19). */
export type WhatIfScenario = { itemId: string; delayMin: number }

export type WhatIfRefusal = 'not-found' | 'inactive' | 'done' | 'range' | 'cycle'

export type WhatIfRow<T extends ScheduleItem> = {
  /** Prognose jetzt und mit der simulierten Verspätung. */
  before: Projected<T>
  after: Projected<T>
  /** Um so viele Minuten rutschen Beginn und Ende gegenüber der Prognose jetzt. */
  startShiftMin: number
  endShiftMin: number
  /** Davor geschluckt: so viel der Verschiebung der Vorgänger kommt hier nicht an (Puffer). */
  absorbedByGapMin: number
  /** Zusätzlich gekürzt (Idee L11) - so viel schluckt der Punkt selbst. */
  extraShortenedMin: number
  /** Ein Anker, bei dem mehr ankommt, als der Puffer davor schluckt - er rutscht nicht, der Konflikt wächst. */
  anchorHolds: boolean
}

export type WhatIfConflict = Conflict & { previousOverlapMin: number }

export type WhatIfResult<T extends ScheduleItem> =
  | {
    ok: true
    /** Gemeldete Verspätung, die die Simulation am Punkt annimmt (wie der Live-Knopf "+X"). */
    simulatedDelayMin: number
    /** Je Punkt in der Reihenfolge der Eingabe. */
    rows: WhatIfRow<T>[]
    /** Konflikte mit Ankern, die neu entstehen oder größer werden. */
    conflicts: WhatIfConflict[]
    /** Verschiebung des Endes je Spur (letzter aktiver Punkt). */
    trackEnds: { trackId: string; endShiftMin: number }[]
  }
  | { ok: false; reason: WhatIfRefusal }

/**
 * "Was wäre wenn"-Vorschau (Idee L19) als reine Funktion: Der gewählte Punkt verspätet sich um delayMin Minuten mehr
 * als jetzt erwartet - genau wie der Knopf "+X" in der Live-Steuerung (bei einem laufenden Punkt verlängert er ihn,
 * sonst verschiebt er seinen Beginn). Das Ergebnis vergleicht die Prognose jetzt mit der simulierten: wo Puffer die
 * Verspätung schlucken, wo kürzbare Punkte gekürzt werden und wo Konflikte mit Ankern entstehen. Nichts wird
 * gespeichert; now ist wie überall Parameter, damit die Vorschau auch während des Events vom Live-Stand ausgeht.
 */
export function whatIf<T extends ScheduleItem>(items: T[], scenario: WhatIfScenario, now: Date, settings: ProjectSettings): WhatIfResult<T> {
  if (!Number.isInteger(scenario.delayMin) || scenario.delayMin < 1 || scenario.delayMin > LIVE_LIMITS.maxDelayMin) return { ok: false, reason: 'range' }
  const before = project(items, now, settings)
  if (!before.ok) return { ok: false, reason: 'cycle' }
  const target = before.items.find(item => item.id === scenario.itemId)
  if (!target) return { ok: false, reason: 'not-found' }
  if (!isActive(target)) return { ok: false, reason: 'inactive' }
  if (target.actualEnd) return { ok: false, reason: 'done' }

  const simulatedDelayMin = Math.min(currentDelayMin(target) + scenario.delayMin, LIVE_LIMITS.maxDelayMin)
  const after = project(items.map(item => (item.id === target.id ? { ...item, reportedDelayMin: simulatedDelayMin } : item)), now, settings)
  if (!after.ok) return { ok: false, reason: 'cycle' }

  const minutes = (ms: number) => Math.round(ms / MINUTE)
  const beforeById = new Map(before.items.map(item => [item.id, item]))
  const afterById = new Map(after.items.map(item => [item.id, item]))
  const endShift = (id: string) => minutes(afterById.get(id)!.expectedEnd.getTime() - beforeById.get(id)!.expectedEnd.getTime())

  // Vorgänger je aktivem Punkt: der vorherige der Spur und die Punkte aus waitsFor.
  const active = items.filter(isActive)
  const activeIds = new Set(active.map(item => item.id))
  const predecessors = new Map<string, string[]>()
  for (const list of byTrack(active).values()) {
    list.forEach((item, index) => predecessors.set(item.id, [...(index > 0 ? [list[index - 1].id] : []), ...item.waitsFor.filter(id => activeIds.has(id))]))
  }

  const previousOverlap = new Map(before.conflicts.map(c => [`${c.anchorId}/${c.itemId}`, c.overlapMin]))
  const conflicts = after.conflicts
    .map(c => ({ ...c, previousOverlapMin: previousOverlap.get(`${c.anchorId}/${c.itemId}`) ?? 0 }))
    .filter(c => c.overlapMin > c.previousOverlapMin)

  const rows = items.map((item): WhatIfRow<T> => {
    const b = beforeById.get(item.id)!
    const a = afterById.get(item.id)!
    const startShiftMin = minutes(a.expectedStart.getTime() - b.expectedStart.getTime())
    const incoming = Math.max(0, ...(predecessors.get(item.id) ?? []).map(endShift))
    const counts = item.id !== target.id && isActive(item) && item.actualStart === null
    // Beim Anker kommt an, was der Puffer davor nicht schluckt - als größerer Konflikt statt als Verschiebung.
    const overlapGrowth = Math.max(0, ...conflicts.filter(c => c.anchorId === item.id).map(c => c.overlapMin - c.previousOverlapMin))
    return {
      before: b,
      after: a,
      startShiftMin,
      endShiftMin: endShift(item.id),
      absorbedByGapMin: counts ? Math.max(0, incoming - startShiftMin - overlapGrowth) : 0,
      extraShortenedMin: Math.max(0, a.shortenedMin - b.shortenedMin),
      anchorHolds: counts && item.isAnchor && overlapGrowth > 0
    }
  })

  const trackEnds = [...byTrack(active).entries()].map(([trackId, list]) => ({ trackId, endShiftMin: endShift(list[list.length - 1].id) }))

  return { ok: true, simulatedDelayMin, rows, conflicts, trackEnds }
}
