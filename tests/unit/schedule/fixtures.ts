import type { ScheduleItem } from '../../../app/lib/schedule/types'
import { zonedInputToUtc } from '../../../app/lib/timezone'

/** Hochzeitstag der Tests (Sommerzeit, Berlin = UTC+2). */
export const DAY = '2026-06-20'

/** "14:00" am Testtag (oder an `day`) in Berliner Zeit als Zeitpunkt. */
export function at(time: string, day = DAY): Date {
  const date = zonedInputToUtc(`${day}T${time}`)
  if (!date) throw new Error(`Ungültige Zeit ${day} ${time}`)
  return date
}

/** "14:00" für einen Zeitpunkt in Berliner Zeit - zum Vergleichen in Tabellen. */
export function hhmm(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

let counter = 0

/** Programmpunkt mit sinnvollen Standardwerten: Spur "main", geplant, ohne Meldung. */
export function item(overrides: Partial<ScheduleItem> & { start: string; min: number; day?: string }): ScheduleItem {
  const { start, min, day, ...rest } = overrides
  counter++
  return {
    id: rest.id ?? `i${counter}`,
    trackId: 'main',
    sortOrder: counter,
    plannedStart: at(start, day),
    plannedDurationMin: min,
    isAnchor: false,
    mayStartEarly: false,
    status: 'PLANNED',
    actualStart: null,
    actualEnd: null,
    reportedDelayMin: null,
    waitsFor: [],
    ...rest
  }
}

/**
 * Der Ablauf aus docs/KONZEPT.md Abschnitt 2 ("Beispiel"): Trauung, Sektempfang, Gruppenfoto, 30 Min Puffer,
 * Kaffee & Kuchen, Abendessen als Anker.
 */
export function weddingPlan(): ScheduleItem[] {
  return [
    item({ id: 'trauung', start: '14:00', min: 45, sortOrder: 1 }),
    item({ id: 'sekt', start: '14:45', min: 45, sortOrder: 2 }),
    item({ id: 'foto', start: '15:30', min: 30, sortOrder: 3 }),
    item({ id: 'kaffee', start: '16:30', min: 90, sortOrder: 4 }),
    item({ id: 'essen', start: '18:30', min: 120, sortOrder: 5, isAnchor: true })
  ]
}

/** Ersetzt einzelne Punkte (per id) durch geänderte Kopien. */
export function patch(items: ScheduleItem[], changes: Record<string, Partial<ScheduleItem>>): ScheduleItem[] {
  return items.map(i => (changes[i.id] ? { ...i, ...changes[i.id] } : i))
}
