import type { ItemVisibility, TrackVisibility } from '@prisma/client'

/**
 * Grenzen und Anzeigenamen der Planung (docs/KONZEPT.md Abschnitt 4). Gelten für Formulare UND Import - der
 * Import prüft mit denselben Werten wie jedes Speichern.
 */
export const PLAN_LIMITS = {
  titleMax: 120,
  locationMax: 200,
  descriptionMax: 2000,
  noteMax: 2000,
  trackNameMax: 60,
  /** Ein Punkt dauert höchstens einen Tag. */
  durationMaxMin: 24 * 60,
  maxTracks: 20,
  maxItems: 300,
  /** Zusammenführung: so viele Punkte, auf die einer wartet. */
  maxWaitsFor: 20,
  maxSecretViewers: 50,
  /**
   * Punkte beginnen frühestens am Vortag (Aufbau) und spätestens 3 Tage nach dem Eventtag - längere Abläufe
   * sind mehrere Events in einer Reihe (Abschnitt 4).
   */
  daysBefore: 1,
  daysAfter: 3
} as const

export const ITEM_VISIBILITY_LABELS: Record<ItemVisibility, string> = {
  PUBLIC: 'Öffentlich',
  TEAM: 'Nur Team',
  SECRET: 'Geheim'
}

export const TRACK_VISIBILITY_LABELS: Record<TrackVisibility, string> = {
  PUBLIC: 'Öffentlich',
  TEAM: 'Nur Team'
}

/** Was Konten außerhalb der SECRET-Liste statt des Titels sehen. */
export const SECRET_PLACEHOLDER = 'Geheimer Punkt'

const DAY_MS = 24 * 60 * 60 * 1000

/** Erlaubter Beginn eines Punkts relativ zum Eventtag (Beginn des Tages als UTC-Zeitpunkt). */
export function startRange(eventDate: Date): { from: Date; until: Date } {
  return {
    from: new Date(eventDate.getTime() - PLAN_LIMITS.daysBefore * DAY_MS),
    until: new Date(eventDate.getTime() + (PLAN_LIMITS.daysAfter + 1) * DAY_MS)
  }
}

export function isValidVisibility(value: string): value is ItemVisibility {
  return value === 'PUBLIC' || value === 'TEAM' || value === 'SECRET'
}

export function isValidTrackVisibility(value: string): value is TrackVisibility {
  return value === 'PUBLIC' || value === 'TEAM'
}

/** Entfernt Steuerzeichen (außer Zeilenumbruch in mehrzeiligen Feldern) - React maskiert den Rest bei der Ausgabe. */
export function cleanText(value: string, multiline = false): string {
  const pattern = multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g
  return value.replace(/\r\n?/g, '\n').replace(pattern, '').trim()
}
