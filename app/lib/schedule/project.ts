// app/lib/schedule/project.ts
import { byTrack, checkDependencies, evaluationOrder } from './dependencies'
import type { Conflict, Phase, Projected, ProjectedFields, Projection, ProjectSettings, ScheduleItem } from './types'

const MINUTE = 60_000

/** Zurückgestellte und ausgefallene Punkte verbrauchen keine Zeit (docs/KONZEPT.md Abschnitt 2). */
export function isActive(item: Pick<ScheduleItem, 'status'>): boolean {
  return item.status !== 'DEFERRED' && item.status !== 'CANCELLED'
}

function addMinutes(date: Date | number, minutes: number): number {
  return (typeof date === 'number' ? date : date.getTime()) + minutes * MINUTE
}

/**
 * Die Prognose (docs/KONZEPT.md Abschnitt 2) als reine Funktion: keine Datenbank, keine Uhr - `now` kommt
 * immer von außen. Server (Gästeansicht, Live-Steuerung) und Browser (Vorschau im Editor) rechnen damit
 * dasselbe.
 *
 * erwarteterBeginn(i):
 *   - gestartet:  tatsächlicher Beginn
 *   - Anker:      geplanter Beginn (+ gemeldete Verspätung)
 *   - sonst:      max(geplanter Beginn [entfällt bei "darf früher beginnen"], Ende des vorherigen Punkts der
 *                 Spur, Ende jedes Punkts aus waitsFor, geplanter Beginn + gemeldete Verspätung)
 *
 * erwartetesEnde(i):
 *   - beendet:    tatsächliches Ende
 *   - läuft:      Grundlage = max(Beginn + Dauer, geplanter Beginn + gemeldete Verspätung + Dauer) - eine
 *                 Meldung am laufenden Punkt verlängert ihn also, ohne die Verspätung vom Start doppelt zu
 *                 zählen. Überzogen und mit Fortschreiben: max(Grundlage, min(now, Grundlage + Deckel)).
 *   - sonst:      Beginn + Dauer
 *
 * Zurückgestellte und ausgefallene Punkte zählen nicht in der Kette; sie behalten ihre Planzeit. Anker
 * rutschen nie - überschneidet sich ein Punkt, auf den der Anker in der Kette oder per waitsFor folgt, mit
 * ihm, entsteht ein Konflikt (nur solange der Anker nicht begonnen hat).
 *
 * Die Ausgabe hat dieselbe Reihenfolge wie die Eingabe; zusätzliche Felder (Titel, Sichtbarkeit ...) werden
 * unverändert durchgereicht.
 */
export function project<T extends ScheduleItem>(items: T[], now: Date, settings: ProjectSettings): Projection<T> {
  const problem = checkDependencies(items)
  if (problem) return { ok: false, problem }

  const active = items.filter(isActive)
  const order = evaluationOrder(active)
  // Kann nicht scheitern: Die Punkte ohne zurückgestellte/ausgefallene sind eine Teilmenge ohne Kreis.
  if (!order.ok) return { ok: false, problem: { kind: 'cycle', itemIds: order.cycle } }

  const byId = new Map(active.map(item => [item.id, item]))
  const previous = new Map<string, T>()
  for (const list of byTrack(active).values()) list.forEach((item, index) => { if (index > 0) previous.set(item.id, list[index - 1]) })

  const start = new Map<string, number>()
  const end = new Map<string, number>()
  const fields = new Map<string, ProjectedFields>()
  const conflicts: Conflict[] = []
  const nowMs = now.getTime()

  for (const id of order.order) {
    const item = byId.get(id)!
    const planned = item.plannedStart.getTime()
    const delay = item.reportedDelayMin ?? 0
    const before = previous.get(id)
    const waited = item.waitsFor.filter(other => byId.has(other))
    const predecessorEnds = [...(before ? [before.id] : []), ...waited].map(other => end.get(other)!)

    // Beginn
    let expectedStart: number
    if (item.actualStart) {
      expectedStart = item.actualStart.getTime()
    } else if (item.isAnchor) {
      expectedStart = addMinutes(planned, delay)
    } else {
      const candidates = [...predecessorEnds]
      if (!item.mayStartEarly || candidates.length === 0) candidates.push(planned)
      if (item.reportedDelayMin !== null) candidates.push(addMinutes(planned, delay))
      expectedStart = Math.max(...candidates)
    }

    // Ende
    const running = item.actualStart !== null && item.actualEnd === null
    let expectedEnd = addMinutes(expectedStart, item.plannedDurationMin)
    let overrun = false
    let capped = false
    let needsCheck = false
    if (item.actualEnd) {
      expectedEnd = item.actualEnd.getTime()
    } else if (running) {
      const base = Math.max(expectedEnd, addMinutes(planned, delay + item.plannedDurationMin))
      expectedEnd = base
      overrun = nowMs > base
      needsCheck = nowMs >= addMinutes(base, settings.creepNudgeMin)
      if (overrun && settings.autoCreep) {
        const cap = addMinutes(base, settings.creepCapMin)
        capped = nowMs >= cap
        expectedEnd = Math.min(nowMs, cap)
      }
    }
    start.set(id, expectedStart)
    end.set(id, expectedEnd)

    // Konflikt: Anker, der noch nicht begonnen hat, und ein Vorgänger, der über seinen Beginn hinaus dauert.
    if (item.isAnchor && !item.actualStart) {
      for (const other of [...(before ? [before.id] : []), ...waited]) {
        const overlap = end.get(other)! - expectedStart
        if (overlap > 0) conflicts.push({ anchorId: id, itemId: other, overlapMin: Math.round(overlap / MINUTE) })
      }
    }

    const confirmed = item.actualStart !== null || item.actualEnd !== null
    let phase: Phase
    if (item.actualEnd) phase = 'past'
    else if (item.actualStart) phase = 'now'
    else if (nowMs >= expectedEnd) phase = 'past'
    else if (nowMs >= expectedStart) phase = 'now'
    else phase = 'upcoming'

    fields.set(id, {
      expectedStart: new Date(expectedStart),
      expectedEnd: new Date(expectedEnd),
      delayMin: Math.round((expectedStart - planned) / MINUTE),
      phase,
      confirmed,
      unconfirmed: !confirmed && nowMs >= expectedStart,
      overrun,
      capped,
      needsCheck
    })
  }

  const projected = items.map((item): Projected<T> => {
    const computed = fields.get(item.id)
    if (computed) return { ...item, ...computed }
    // Zurückgestellt oder ausgefallen: Planzeit, keine Abweichung, keine Live-Zustände.
    return {
      ...item,
      expectedStart: item.plannedStart,
      expectedEnd: new Date(addMinutes(item.plannedStart, item.plannedDurationMin)),
      delayMin: 0,
      phase: item.status === 'DEFERRED' ? 'deferred' : 'cancelled',
      confirmed: false,
      unconfirmed: false,
      overrun: false,
      capped: false,
      needsCheck: false
    }
  })

  return { ok: true, items: projected, conflicts }
}
