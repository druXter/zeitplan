// app/lib/live/history.ts
import type { ItemStatus, ItemVisibility } from '@prisma/client'
import { SECRET_PLACEHOLDER } from '../planning/rules'

/**
 * Verlauf der Live-Steuerung (docs/KONZEPT.md Abschnitt 3, LiveAction): Jede Aktion speichert für jeden
 * betroffenen Punkt den Stand vorher und nachher. Daraus entsteht "Rückgängig" - aber nur, solange die Punkte
 * noch GENAU so sind wie nach der Aktion (sonst würde Rückgängig eine spätere Änderung überschreiben). Rein,
 * ohne Datenbank; die Momentaufnahmen liest und schreibt app/lib/live/store.ts.
 */

/** Was eine Live-Aktion an einem Punkt ändern kann. Zeiten als ISO-Strings (JSON in der Datenbank). */
export type ItemSnapshot = {
  trackId: string
  sortOrder: number
  plannedStart: string
  status: ItemStatus
  actualStart: string | null
  actualEnd: string | null
  reportedDelayMin: number | null
  reportedAt: string | null
  cancelReason: string | null
}

/** Der Rest eines Punkts - nur bei Einschub und Entfernen, damit Rückgängig ihn exakt wieder anlegen kann. */
export type ItemContent = {
  title: string
  location: string | null
  description: string | null
  internalNote: string | null
  visibility: ItemVisibility
  isAnchor: boolean
  mayStartEarly: boolean
  plannedDurationMin: number
  insertedLive: boolean
  originalStart: string | null
  originalDurationMin: number | null
  originalSortOrder: number | null
  waitsFor: string[]
  waitedOnBy: string[]
  secretViewerIds: string[]
  createdAt: string
}

export type ItemRecord = ItemSnapshot & { content?: ItemContent }

export type ActionMeta = {
  /** Die gemeinten Punkte in der Reihenfolge des Befehls (Weiter: von, nach; Tauschen: beide). */
  ids: (string | null)[]
  minutesAgo?: number
  delayMin?: number
  auto?: boolean
}

/** before/after einer LiveAction: null = Punkt gab es (vorher bzw. nachher) nicht. */
export type ActionState = { items: Record<string, ItemRecord | null>; meta?: ActionMeta }

export const LIVE_ACTION_TYPES = [
  'advance', 'start', 'end', 'delay', 'ontime', 'swap', 'defer', 'cancel', 'restore', 'requeue', 'insert', 'remove', 'golive', 'endevent'
] as const
export type LiveActionType = (typeof LIVE_ACTION_TYPES)[number]

/** Live schalten und Beenden sind Statuswechsel des Events, keine Änderungen an Punkten - nicht rückgängig zu machen. */
export function isUndoable(type: string): boolean {
  return (LIVE_ACTION_TYPES as readonly string[]).includes(type) && type !== 'golive' && type !== 'endevent'
}

type SnapshotSource = {
  trackId: string
  sortOrder: number
  plannedStart: Date
  status: ItemStatus
  actualStart: Date | null
  actualEnd: Date | null
  reportedDelayMin: number | null
  reportedAt: Date | null
  cancelReason: string | null
}

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function snapshotOf(row: SnapshotSource): ItemSnapshot {
  return {
    trackId: row.trackId,
    sortOrder: row.sortOrder,
    plannedStart: row.plannedStart.toISOString(),
    status: row.status,
    actualStart: iso(row.actualStart),
    actualEnd: iso(row.actualEnd),
    reportedDelayMin: row.reportedDelayMin,
    reportedAt: iso(row.reportedAt),
    cancelReason: row.cancelReason
  }
}

const SNAPSHOT_KEYS: (keyof ItemSnapshot)[] = [
  'trackId', 'sortOrder', 'plannedStart', 'status', 'actualStart', 'actualEnd', 'reportedDelayMin', 'reportedAt', 'cancelReason'
]

/** Gleicher Stand? null/undefined heißt "gibt es nicht" - zwei fehlende Punkte sind gleich. */
export function sameSnapshot(a: ItemRecord | null | undefined, b: ItemRecord | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return SNAPSHOT_KEYS.every(key => a[key] === b[key])
}

/** Sind alle Punkte noch so wie nach der Aktion? Nur dann darf Rückgängig den Stand davor herstellen. */
export function unchangedSince(after: ActionState, current: Record<string, ItemRecord | null>): boolean {
  return Object.entries(after.items).every(([id, record]) => sameSnapshot(record, current[id]))
}

/** Liest before/after aus der Datenbank (Json) - defensiv, ein kaputter Eintrag ist einfach nicht rückgängig zu machen. */
export function parseState(value: unknown): ActionState | null {
  if (!value || typeof value !== 'object' || !('items' in value)) return null
  const items = (value as { items: unknown }).items
  if (!items || typeof items !== 'object' || Array.isArray(items)) return null
  return value as ActionState
}

/** Titel eines Punkts aus einer Momentaufnahme - bei SECRET nur für eingetragene Konten (sonst der Platzhalter). */
export function recordTitle(record: ItemRecord | null | undefined, userId: string): string | null {
  if (!record?.content) return null
  const { content } = record
  return content.visibility !== 'SECRET' || content.secretViewerIds.includes(userId) ? content.title : SECRET_PLACEHOLDER
}

/**
 * Beschreibung einer Aktion für den Verlauf, z. B. „Trauung“ beendet, „Sektempfang“ gestartet. title liefert den
 * Titel, den das lesende Konto sehen darf (SECRET-Regel) - hier werden nie Inhalte aus dem JSON direkt gezeigt.
 */
export function describeAction(type: string, after: ActionState | null, title: (id: string | null) => string): string {
  const meta = after?.meta
  const [first = null, second = null] = meta?.ids ?? []
  const q = (id: string | null) => `„${title(id)}“`
  const ago = meta?.minutesAgo ? ` (vor ${meta.minutesAgo} Min)` : ''
  switch (type) {
    case 'advance': return first ? `${q(first)} beendet, ${q(second)} gestartet` : `${q(second)} gestartet`
    case 'start': return `${q(first)} gestartet${ago}`
    case 'end': return `${q(first)} beendet${ago}`
    case 'delay': return `Verspätung ${q(first)}: +${meta?.delayMin ?? 0} Min`
    case 'ontime': return `${q(first)} wieder im Plan`
    case 'swap': return `${q(first)} und ${q(second)} getauscht`
    case 'defer': return `${q(first)} zurückgestellt`
    case 'cancel': return `${q(first)} fällt aus`
    case 'restore': return `${q(first)} wiederhergestellt`
    case 'requeue': return `${q(first)} als Nächstes eingereiht`
    case 'insert': return `Einschub: ${q(first)}`
    case 'remove': return `${q(first)} entfernt`
    case 'golive': return 'Live geschaltet'
    case 'endevent': return meta?.auto ? 'Event automatisch beendet' : 'Event beendet'
    default: return type
  }
}
