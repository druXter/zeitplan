// app/lib/review/review.ts
import type { ItemStatus } from '../schedule'

/**
 * Rückblick: Plan gegen Ist (Idee L24). Vergleicht je Punkt den Ursprungsplan (beim Live-Schalten eingefroren,
 * docs/KONZEPT.md Abschnitt 1) mit dem, was gemeldet wurde - Beginn, Ende, Dauer, Ausfälle, Einschübe. Ohne
 * Ursprungsplan (nie live geschaltet) ist der aktuelle Plan die Grundlage. Taugt auch als Dokumentation einer
 * Sitzung: Tagesordnungspunkte als Programmpunkte, dazu die Protokollnotiz je Punkt.
 *
 * Reine Funktion: Die Punkte kommen schon nach der SECRET-Regel gefiltert (loadPlan); hier wird nur gerechnet.
 */

const MINUTE = 60_000

export type ReviewSource = {
  id: string
  trackId: string
  sortOrder: number
  status: ItemStatus
  insertedLive: boolean
  plannedStart: Date
  plannedDurationMin: number
  originalStart: Date | null
  originalDurationMin: number | null
  actualStart: Date | null
  actualEnd: Date | null
}

/**
 * done: begonnen und beendet · running: begonnen, nicht beendet · cancelled: Ausfall · deferred: zurückgestellt und
 * nicht nachgeholt · skipped: nie begonnen (übersprungen oder das Event endete vorher)
 */
export type ReviewOutcome = 'done' | 'running' | 'cancelled' | 'deferred' | 'skipped'

export type ReviewRow<T extends ReviewSource> = {
  item: T
  outcome: ReviewOutcome
  /** Vergleichsgrundlage: Ursprungsplan, sonst aktueller Plan. Bei Einschüben null - es gab keinen Plan. */
  baseStart: Date | null
  baseDurationMin: number | null
  baseEnd: Date | null
  /** Tatsächliche Dauer in Minuten, nur bei beendeten Punkten. */
  actualDurationMin: number | null
  /** Tatsächlicher gegen geplanten Beginn bzw. Dauer in Minuten (positiv: später bzw. länger). */
  startDeviationMin: number | null
  durationDeviationMin: number | null
  /** Im aktuellen Plan verlegt (getauscht, Block verschoben, Zeit geändert) - gegenüber dem Ursprungsplan. */
  moved: boolean
}

export type ReviewSummary = {
  /** Gibt es einen Ursprungsplan (live geschaltet)? Sonst ist der aktuelle Plan die Grundlage. */
  frozen: boolean
  plannedStart: Date | null
  plannedEnd: Date | null
  actualStart: Date | null
  actualEnd: Date | null
  /** Tatsächliches gegen geplantes Ende des Ablaufs, sobald nichts mehr läuft. */
  endDeviationMin: number | null
  counts: Record<ReviewOutcome, number> & { inserted: number }
  /** Die (bis zu drei) Punkte, die am meisten überzogen haben - dort ist die Verspätung entstanden. */
  overruns: { id: string; minutes: number }[]
}

const minutesBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / MINUTE)

function outcomeOf(item: ReviewSource): ReviewOutcome {
  if (item.actualStart && item.actualEnd) return 'done'
  if (item.actualStart) return 'running'
  if (item.status === 'CANCELLED') return 'cancelled'
  if (item.status === 'DEFERRED') return 'deferred'
  return 'skipped'
}

/**
 * Zeilen chronologisch (tatsächlicher Beginn, sonst Planzeit; dann Spur und Reihenfolge) und eine
 * Zusammenfassung. trackOrder: ids der Spuren in ihrer Reihenfolge.
 */
export function buildReview<T extends ReviewSource>(items: T[], trackOrder: string[]): { rows: ReviewRow<T>[]; summary: ReviewSummary } {
  const frozen = items.some(item => item.originalStart !== null)
  const rank = new Map(trackOrder.map((id, index) => [id, index]))

  const rows = items.map((item): ReviewRow<T> => {
    const outcome = outcomeOf(item)
    const inserted = item.insertedLive && item.originalStart === null
    const baseStart = inserted ? null : item.originalStart ?? item.plannedStart
    const baseDurationMin = inserted ? null : item.originalDurationMin ?? item.plannedDurationMin
    const baseEnd = baseStart && baseDurationMin !== null ? new Date(baseStart.getTime() + baseDurationMin * MINUTE) : null
    const actualDurationMin = item.actualStart && item.actualEnd ? minutesBetween(item.actualStart, item.actualEnd) : null
    return {
      item,
      outcome,
      baseStart,
      baseDurationMin,
      baseEnd,
      actualDurationMin,
      startDeviationMin: baseStart && item.actualStart ? minutesBetween(baseStart, item.actualStart) : null,
      durationDeviationMin: baseDurationMin !== null && actualDurationMin !== null ? actualDurationMin - baseDurationMin : null,
      moved: item.originalStart !== null && (item.originalStart.getTime() !== item.plannedStart.getTime() || item.originalDurationMin !== item.plannedDurationMin)
    }
  })
  const when = (row: ReviewRow<T>) => (row.item.actualStart ?? row.baseStart ?? row.item.plannedStart).getTime()
  rows.sort((a, b) => when(a) - when(b) || (rank.get(a.item.trackId) ?? 0) - (rank.get(b.item.trackId) ?? 0) || a.item.sortOrder - b.item.sortOrder)

  const counts = { done: 0, running: 0, cancelled: 0, deferred: 0, skipped: 0, inserted: 0 }
  for (const row of rows) {
    counts[row.outcome]++
    if (row.baseStart === null) counts.inserted++
  }
  const earliest = (dates: (Date | null)[]) => dates.reduce<Date | null>((min, d) => (d && (!min || d < min) ? d : min), null)
  const latest = (dates: (Date | null)[]) => dates.reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null)
  const plannedEnd = latest(rows.map(row => row.baseEnd))
  const actualEnd = latest(rows.map(row => row.item.actualEnd))

  return {
    rows,
    summary: {
      frozen,
      plannedStart: earliest(rows.map(row => row.baseStart)),
      plannedEnd,
      actualStart: earliest(rows.map(row => row.item.actualStart)),
      actualEnd,
      endDeviationMin: plannedEnd && actualEnd && counts.running === 0 ? minutesBetween(plannedEnd, actualEnd) : null,
      counts,
      overruns: rows
        .filter(row => (row.durationDeviationMin ?? 0) > 0)
        .sort((a, b) => b.durationDeviationMin! - a.durationDeviationMin!)
        .slice(0, 3)
        .map(row => ({ id: row.item.id, minutes: row.durationDeviationMin! }))
    }
  }
}

export const OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  done: 'stattgefunden',
  running: 'läuft noch',
  cancelled: 'ausgefallen',
  deferred: 'zurückgestellt, nicht nachgeholt',
  skipped: 'nicht begonnen'
}

/** "+5", "−10", "±0" - Abweichung in Minuten. */
export function formatDeviation(minutes: number): string {
  if (minutes === 0) return '±0'
  return minutes > 0 ? `+${minutes}` : `−${Math.abs(minutes)}`
}

/** Was die CSV je Punkt zusätzlich braucht - Texte schon nach der SECRET-Regel (Platzhalter, keine Notiz). */
export type ReviewCsvItem = ReviewSource & {
  title: string
  visibility: 'PUBLIC' | 'TEAM' | 'SECRET'
  cancelReason: string | null
  resultNote: string | null
}

const VISIBILITY_LABELS = { PUBLIC: 'öffentlich', TEAM: 'Team', SECRET: 'geheim' } as const

/**
 * Tabelle für die CSV (app/lib/csv.ts): eine Zeile je Punkt in der Reihenfolge des Rückblicks. time formatiert
 * einen Zeitpunkt in der Zeitzone des Events (z. B. "2026-06-20 14:00"), trackName liefert den Namen der Spur.
 */
export function reviewTable<T extends ReviewCsvItem>(
  rows: ReviewRow<T>[],
  time: (date: Date) => string,
  trackName: (trackId: string) => string
): { header: string[]; rows: (string | number | null)[][] } {
  const at = (date: Date | null) => (date ? time(date) : null)
  return {
    header: [
      'Beginn geplant', 'Ende geplant', 'Dauer geplant (Min)', 'Beginn tatsächlich', 'Ende tatsächlich', 'Dauer tatsächlich (Min)',
      'Abweichung Beginn (Min)', 'Abweichung Dauer (Min)', 'Spur', 'Punkt', 'Sichtbarkeit', 'Ergebnis', 'Einschub', 'verlegt',
      'Ausfallgrund', 'Protokollnotiz'
    ],
    rows: rows.map(row => [
      at(row.baseStart), at(row.baseEnd), row.baseDurationMin,
      at(row.item.actualStart), at(row.item.actualEnd), row.actualDurationMin,
      row.startDeviationMin, row.durationDeviationMin,
      trackName(row.item.trackId), row.item.title, VISIBILITY_LABELS[row.item.visibility], OUTCOME_LABELS[row.outcome],
      row.baseStart === null ? 'ja' : null, row.moved ? 'ja' : null,
      row.item.cancelReason, row.item.resultNote
    ])
  }
}

/**
 * Ordnet zeitgestempelte Einträge (Kommen und Gehen, Beschlüsse aus rsvp-app) dem Punkt zu, der zu dem Zeitpunkt lief:
 * tatsächlich begonnen und noch nicht beendet (Ende inklusive); laufen mehrere, gewinnt der zuletzt begonnene. Alles
 * andere (vor dem ersten Punkt, in Pausen, danach) landet in `outside`. Reihenfolge der Einträge bleibt erhalten.
 */
export function placeByTime<E extends { at: Date }>(rows: ReviewRow<ReviewSource>[], entries: readonly E[]): { byItem: Map<string, E[]>; outside: E[] } {
  const started = rows.filter(row => row.item.actualStart).sort((a, b) => b.item.actualStart!.getTime() - a.item.actualStart!.getTime())
  const byItem = new Map<string, E[]>()
  const outside: E[] = []
  for (const entry of entries) {
    const t = entry.at.getTime()
    const row = started.find(r => r.item.actualStart!.getTime() <= t && (!r.item.actualEnd || t <= r.item.actualEnd.getTime()))
    if (row) byItem.set(row.item.id, [...(byItem.get(row.item.id) ?? []), entry])
    else outside.push(entry)
  }
  return { byItem, outside }
}
