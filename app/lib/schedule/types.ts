// app/lib/schedule/types.ts

/**
 * Typen des Prognose-Kerns (docs/KONZEPT.md Abschnitt 2). Bewusst unabhängig von Prisma: Der Kern
 * läuft auch im Browser (Vorschau im Editor), und die Server Actions übersetzen Datenbankzeilen in
 * diese Form. Alle Zeitpunkte sind absolute Zeitpunkte (Date, intern UTC), Dauern ganze Minuten.
 */

/** Wie ItemStatus im Datenmodell (Abschnitt 9). Gestartet/beendet liest der Kern an actualStart/actualEnd ab. */
export type ItemStatus = 'PLANNED' | 'RUNNING' | 'DONE' | 'DEFERRED' | 'CANCELLED'

export type Visibility = 'PUBLIC' | 'TEAM' | 'SECRET'

export type TrackVisibility = 'PUBLIC' | 'TEAM'

/** Was project() von einem Programmpunkt braucht - der aktuelle Plan plus Live-Stand. */
export type ScheduleItem = {
  id: string
  trackId: string
  /** Reihenfolge innerhalb der Spur (eindeutig pro Spur, nicht unbedingt lückenlos). */
  sortOrder: number
  /** Beginn laut aktuellem Plan (Ursprungsplan plus bewusste Änderungen, Abschnitt 1). */
  plannedStart: Date
  plannedDurationMin: number
  isAnchor: boolean
  mayStartEarly: boolean
  status: ItemStatus
  actualStart: Date | null
  actualEnd: Date | null
  /** Gemeldete Verspätung gegenüber dem geplanten Beginn, null = keine Meldung ("im Plan"). */
  reportedDelayMin: number | null
  /** Zusammenführung: ids von Punkten (meist anderer Spuren), deren Ende dieser Punkt abwartet. */
  waitsFor: string[]
}

export type ProjectSettings = {
  /** "Fortschreiben": Ein überzogener laufender Punkt schiebt die Prognose live weiter. */
  autoCreep: boolean
  /** Deckel fürs Fortschreiben in Minuten (Standard 30). */
  creepCapMin: number
  /** Nachfrage "läuft noch?", wenn ein laufender Punkt so viele Minuten über seinem Ende ist (Standard 5). */
  creepNudgeMin: number
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { autoCreep: true, creepCapMin: 30, creepNudgeMin: 5 }

/**
 * Zustand eines Punkts zum Zeitpunkt now:
 * - upcoming: kommt noch
 * - now:      läuft (gemeldet) oder sollte laut Prognose gerade laufen (abgeleitet, siehe confirmed)
 * - past:     beendet (gemeldet) oder laut Prognose vorbei
 * - deferred / cancelled: zurückgestellt bzw. ausgefallen, zählt nicht in der Kette
 */
export type Phase = 'upcoming' | 'now' | 'past' | 'deferred' | 'cancelled'

export type ProjectedFields = {
  expectedStart: Date
  expectedEnd: Date
  /** Abweichung des erwarteten Beginns vom geplanten in Minuten (negativ nur mit "darf früher beginnen"). */
  delayMin: number
  phase: Phase
  /** Stammt die Phase aus einer Meldung (gestartet/beendet) statt aus der Uhr? */
  confirmed: boolean
  /** Geplanter Beginn erreicht, aber niemand hat "gestartet" gemeldet (Team: "nicht bestätigt"). */
  unconfirmed: boolean
  /** Läuft über sein erwartetes Ende hinaus; mit Fortschreiben wächst expectedEnd mit now. */
  overrun: boolean
  /** Fortschreiben hat den Deckel erreicht - das Team sieht "unklar", Gäste den gedeckelten Stand. */
  capped: boolean
  /** Laufender Punkt seit creepNudgeMin über seinem Ende: Nachfrage "läuft noch?". */
  needsCheck: boolean
}

export type Projected<T extends ScheduleItem = ScheduleItem> = T & ProjectedFields

/** Ein Punkt überschneidet einen Anker (nur fürs Team): "Kaffee überschneidet Abendessen um 10 Min". */
export type Conflict = { anchorId: string; itemId: string; overlapMin: number }

export type DependencyProblem =
  | { kind: 'cycle'; itemIds: string[] }
  | { kind: 'unknown'; itemId: string; waitsForId: string }

export type Projection<T extends ScheduleItem = ScheduleItem> =
  | { ok: true; items: Projected<T>[]; conflicts: Conflict[] }
  | { ok: false; problem: DependencyProblem }

/** Änderung am aktuellen Plan, die eine Server Action speichert (Tauschen, Einschub). */
export type PlanChange = { id: string; plannedStart?: Date; sortOrder?: number }
