import { z } from 'zod'
import type { ItemVisibility, TrackVisibility } from '@prisma/client'
import { checkDependencies } from '../schedule'
import { DEFAULT_EVENT_OPTIONS, OPTION_BOUNDS, type EventOptions } from '../events/settings'
import { DEFAULT_TIMEZONE, daysBetween, shiftDays, toZonedIso, utcToZonedDate, zonedDateToUtc } from '../timezone'
import { cleanText, PLAN_LIMITS, startRange } from './rules'
import type { PlanItem } from './items'

/**
 * Export/Import eines Ablaufs als JSON (docs/KONZEPT.md Abschnitt 4) - auch Grundlage für Duplizieren und die
 * Vorlage "Hochzeit". Ein Import legt immer ein NEUES Event an, er überschreibt nie ein bestehendes.
 *
 * Aufbau: Spuren und Punkte tragen frei gewählte Schlüssel (`key`) statt Datenbank-ids; die Reihenfolge der
 * Punkte einer Spur in `items` ist die Kette. `start` ist ISO 8601 mit Versatz ("2026-06-20T14:00:00+02:00"),
 * `date` der Eventtag. Beim Import auf einen anderen Tag rutschen alle Punkte um ganze Tage und behalten ihre
 * Uhrzeit.
 *
 * Nicht enthalten: Live-Stand, Ursprungsplan, Freigaben, Schalter der Moderator*innen, Zugang und die
 * SECRET-Kontenliste (Konten gibt es in einer anderen Instanz nicht). Geheime Punkte, die das exportierende
 * Konto nicht sehen darf, stehen nur als Platzhalter mit Zeit und Dauer darin (redactItem).
 *
 * Ändert sich das Format inkompatibel, steigt EXPORT_SCHEMA_VERSION und parseExport bekommt eine Migration.
 */
export const EXPORT_FORMAT = 'zeitplan-event'
export const EXPORT_SCHEMA_VERSION = 1

/** Import-Dateien: knapp unter dem Server-Action-Limit von 1 MB (inkl. multipart-Overhead), wie in Seating. */
export const IMPORT_MAX_BYTES = 900 * 1024

export type ExportTrack = { key: string; name: string; visibility: TrackVisibility }

export type ExportItem = {
  key: string
  track: string
  title: string
  location?: string
  description?: string
  internalNote?: string
  visibility: ItemVisibility
  isAnchor: boolean
  mayStartEarly: boolean
  start: string
  durationMin: number
  waitsFor: string[]
}

export type PlanExport = {
  format: typeof EXPORT_FORMAT
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  title: string
  description: string
  date: string
  timezone: string
  settings: EventOptions
  tracks: ExportTrack[]
  items: ExportItem[]
}

type ExportSource = { title: string; description: string; date: Date; timezone: string } & EventOptions

/** Baut die Export-Datei aus dem, was das Konto sehen darf (Punkte kommen schon gefiltert aus loadPlan). */
export function buildExport(
  event: ExportSource,
  tracks: { id: string; name: string; visibility: TrackVisibility; sortOrder: number }[],
  items: PlanItem[]
): PlanExport {
  const orderedTracks = [...tracks].sort((a, b) => a.sortOrder - b.sortOrder)
  const trackKey = new Map(orderedTracks.map((track, index) => [track.id, `spur-${index + 1}`]))
  const trackRank = new Map(orderedTracks.map((track, index) => [track.id, index]))
  const orderedItems = items
    .filter(item => trackKey.has(item.trackId))
    .sort((a, b) => trackRank.get(a.trackId)! - trackRank.get(b.trackId)! || a.sortOrder - b.sortOrder)
  const itemKey = new Map(orderedItems.map((item, index) => [item.id, `punkt-${index + 1}`]))

  const settings: EventOptions = {
    autoCreep: event.autoCreep,
    creepNudgeMin: event.creepNudgeMin,
    creepCapMin: event.creepCapMin,
    guestRoundingMin: event.guestRoundingMin,
    hysteresisMin: event.hysteresisMin,
    showDelayToGuests: event.showDelayToGuests,
    guestHorizonMin: event.guestHorizonMin
  }

  return {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    title: event.title,
    description: event.description,
    date: utcToZonedDate(event.date, event.timezone),
    timezone: event.timezone,
    settings,
    tracks: orderedTracks.map(track => ({ key: trackKey.get(track.id)!, name: track.name, visibility: track.visibility })),
    items: orderedItems.map(item => ({
      key: itemKey.get(item.id)!,
      track: trackKey.get(item.trackId)!,
      title: item.title,
      ...(item.location ? { location: item.location } : {}),
      ...(item.description ? { description: item.description } : {}),
      ...(item.internalNote ? { internalNote: item.internalNote } : {}),
      visibility: item.visibility,
      isAnchor: item.isAnchor,
      mayStartEarly: item.mayStartEarly,
      start: toZonedIso(item.plannedStart, event.timezone),
      durationMin: item.plannedDurationMin,
      // Nur Punkte, die mit exportiert werden (alle Punkte des Events, siehe filter oben).
      waitsFor: item.waitsFor.filter(id => itemKey.has(id)).map(id => itemKey.get(id)!)
    }))
  }
}

const text = (max: number, multiline = false) => z.string().max(max * 2).transform(value => cleanText(value, multiline)).pipe(z.string().max(max))
const key = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)
const minutes = (bound: { min: number; max: number }) => z.int().min(bound.min).max(bound.max)

const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  title: text(PLAN_LIMITS.titleMax).optional(),
  description: text(PLAN_LIMITS.descriptionMax, true).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.literal(DEFAULT_TIMEZONE).optional(),
  settings: z.strictObject({
    autoCreep: z.boolean(),
    creepNudgeMin: minutes(OPTION_BOUNDS.creepNudgeMin),
    creepCapMin: minutes(OPTION_BOUNDS.creepCapMin),
    guestRoundingMin: minutes(OPTION_BOUNDS.guestRoundingMin),
    hysteresisMin: minutes(OPTION_BOUNDS.hysteresisMin),
    showDelayToGuests: z.boolean(),
    guestHorizonMin: minutes(OPTION_BOUNDS.guestHorizonMin)
  }).partial().optional(),
  tracks: z.array(z.strictObject({
    key,
    name: text(PLAN_LIMITS.trackNameMax).pipe(z.string().min(1)),
    visibility: z.enum(['PUBLIC', 'TEAM'])
  })).min(1).max(PLAN_LIMITS.maxTracks),
  items: z.array(z.strictObject({
    key,
    track: key,
    title: text(PLAN_LIMITS.titleMax).pipe(z.string().min(1)),
    location: text(PLAN_LIMITS.locationMax).optional(),
    description: text(PLAN_LIMITS.descriptionMax, true).optional(),
    internalNote: text(PLAN_LIMITS.noteMax, true).optional(),
    visibility: z.enum(['PUBLIC', 'TEAM', 'SECRET']),
    isAnchor: z.boolean().default(false),
    mayStartEarly: z.boolean().default(false),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/),
    durationMin: z.int().min(0).max(PLAN_LIMITS.durationMaxMin),
    waitsFor: z.array(key).max(PLAN_LIMITS.maxWaitsFor).default([])
  })).max(PLAN_LIMITS.maxItems)
})

export type ParsedPlan = {
  title: string | null
  description: string
  /** Eventtag der Datei (Beginn des Tages als UTC-Zeitpunkt). */
  date: Date
  settings: EventOptions
  tracks: ExportTrack[]
  items: (Omit<ExportItem, 'start' | 'location' | 'description' | 'internalNote'> & {
    start: Date
    location: string | null
    description: string | null
    internalNote: string | null
  })[]
}

export type ParsedExport = { ok: true; plan: ParsedPlan } | { ok: false; errors: string[] }

const MAX_REPORTED = 8

/**
 * Prüft eine Import-Datei vollständig, bevor irgendetwas gespeichert wird: Format und Version, Grenzen und
 * Texte wie im Formular, eindeutige Schlüssel, Verweise auf Spuren und Punkte, Beginn im erlaubten Bereich
 * um den Eventtag und - mit checkDependencies aus dem Prognose-Kern - keine Kreise in "wartet auf" (auch
 * solche, die erst über die Reihenfolge der Spuren entstehen).
 */
export function parseExport(input: unknown): ParsedExport {
  const wrapper = z.object({ format: z.literal(EXPORT_FORMAT) }).safeParse(input)
  if (!wrapper.success) return { ok: false, errors: ['Das ist keine Ablauf-Datei dieses Tools.'] }
  const parsed = exportSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, MAX_REPORTED).map(issue => `Ungültiger Wert bei „${issue.path.join('.') || 'Datei'}“.`)
    }
  }
  const data = parsed.data
  const errors: string[] = []

  const date = zonedDateToUtc(data.date, DEFAULT_TIMEZONE)
  if (!date) return { ok: false, errors: ['Ungültiger Wert bei „date“.'] }

  const trackKeys = new Set<string>()
  for (const track of data.tracks) {
    if (trackKeys.has(track.key)) errors.push(`Spur „${track.key}“ kommt doppelt vor.`)
    trackKeys.add(track.key)
  }

  const itemKeys = new Set<string>()
  for (const item of data.items) {
    if (itemKeys.has(item.key)) errors.push(`Punkt „${item.key}“ kommt doppelt vor.`)
    itemKeys.add(item.key)
  }

  const range = startRange(date)
  const items: ParsedPlan['items'] = []
  for (const item of data.items) {
    const label = `Punkt „${item.title}“`
    if (!trackKeys.has(item.track)) errors.push(`${label}: Die Spur „${item.track}“ gibt es nicht.`)
    const missing = item.waitsFor.find(other => !itemKeys.has(other))
    if (missing) errors.push(`${label}: wartet auf „${missing}“, den es nicht gibt.`)
    if (item.waitsFor.includes(item.key)) errors.push(`${label}: wartet auf sich selbst.`)
    const start = new Date(item.start)
    if (Number.isNaN(start.getTime())) errors.push(`${label}: ungültiger Beginn.`)
    else if (start < range.from || start >= range.until) {
      errors.push(`${label}: Der Beginn liegt nicht zwischen dem Vortag und ${PLAN_LIMITS.daysAfter} Tage nach dem Eventtag.`)
    }
    items.push({
      ...item,
      start,
      location: item.location || null,
      description: item.description || null,
      internalNote: item.internalNote || null,
      waitsFor: [...new Set(item.waitsFor)]
    })
  }

  if (errors.length === 0) {
    const problem = checkDependencies(items.map((item, index) => ({ id: item.key, trackId: item.track, sortOrder: index, waitsFor: item.waitsFor })))
    if (problem?.kind === 'cycle') {
      const titles = problem.itemIds.map(id => items.find(item => item.key === id)?.title ?? id)
      errors.push(`„Wartet auf“ ergibt eine Schleife: ${titles.join(' → ')}.`)
    }
  }

  if (errors.length > 0) return { ok: false, errors: errors.slice(0, MAX_REPORTED) }
  return {
    ok: true,
    plan: {
      title: data.title || null,
      description: data.description ?? '',
      date,
      settings: { ...DEFAULT_EVENT_OPTIONS, ...data.settings },
      tracks: data.tracks,
      items
    }
  }
}

export type MaterializedPlan = {
  tracks: (ExportTrack & { sortOrder: number })[]
  items: (Omit<ParsedPlan['items'][number], 'start' | 'durationMin'> & { sortOrder: number; plannedStart: Date; plannedDurationMin: number })[]
}

/**
 * Legt den Ablauf auf einen (anderen) Eventtag: Alle Punkte rutschen um die Zahl der Kalendertage und
 * behalten ihre Uhrzeit (shiftDays). Die Reihenfolge der Punkte einer Spur in der Datei wird zu sortOrder.
 */
export function materializePlan(plan: ParsedPlan, targetDate: Date, timeZone: string = DEFAULT_TIMEZONE): MaterializedPlan {
  const days = daysBetween(plan.date, targetDate, timeZone)
  const position = new Map<string, number>()
  return {
    tracks: plan.tracks.map((track, index) => ({ ...track, sortOrder: index + 1 })),
    items: plan.items.map(({ start, durationMin, ...item }) => {
      const sortOrder = (position.get(item.track) ?? 0) + 1
      position.set(item.track, sortOrder)
      return { ...item, sortOrder, plannedStart: shiftDays(start, days, timeZone), plannedDurationMin: durationMin }
    })
  }
}
