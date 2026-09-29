import type { ItemStatus, ItemVisibility } from '@prisma/client'
import { seesItemContent } from '../permissions'
import { cleanText, isValidVisibility, PLAN_LIMITS, SECRET_PLACEHOLDER, startRange } from './rules'
import { zonedInputToUtc } from '../timezone'

/**
 * Ein Programmpunkt, wie ihn ein Konto in Planung und Team-Ansicht bekommt - schon nach der SECRET-Regel
 * gefiltert (redactItem). Seiten und Export arbeiten nur mit diesem Typ, nie mit der Datenbankzeile.
 */
export type PlanItem = {
  id: string
  trackId: string
  sortOrder: number
  title: string
  location: string | null
  description: string | null
  internalNote: string | null
  visibility: ItemVisibility
  isAnchor: boolean
  mayStartEarly: boolean
  plannedStart: Date
  plannedDurationMin: number
  status: ItemStatus
  insertedLive: boolean
  actualStart: Date | null
  actualEnd: Date | null
  reportedDelayMin: number | null
  cancelReason: string | null
  version: number
  waitsFor: string[]
  /** Inhalt sichtbar (nicht SECRET oder eingetragen). false: Titel ist der Platzhalter, Texte fehlen. */
  canSee: boolean
  /** Eingetragene Konten eines SECRET-Punkts - nur, wenn canSee, sonst leer. */
  secretViewerIds: string[]
}

export type StoredItem = Omit<PlanItem, 'canSee' | 'secretViewerIds'> & { secretViewerIds: string[] }

/**
 * DIE Stelle, an der die SECRET-Regel für Konten greift (docs/KONZEPT.md Abschnitt 4): Wer nicht eingetragen
 * ist - auch Besitzer*in oder ADMIN -, bekommt nur Zeit, Dauer, Spur und Kette, statt des Titels den
 * Platzhalter und keine Texte, keinen Ausfallgrund und keine Kontenliste. Alles, was Konten angezeigt oder
 * exportiert wird, läuft hier durch (app/lib/planning/store.ts).
 */
export function redactItem(item: StoredItem, userId: string): PlanItem {
  const canSee = seesItemContent(item, item.secretViewerIds.includes(userId))
  if (canSee) return { ...item, canSee }
  return {
    ...item,
    title: SECRET_PLACEHOLDER,
    location: null,
    description: null,
    internalNote: null,
    cancelReason: null,
    secretViewerIds: [],
    canSee
  }
}

export type ItemFields = {
  title: string
  location: string | null
  description: string | null
  internalNote: string | null
  trackId: string
  plannedStart: Date
  plannedDurationMin: number
  visibility: ItemVisibility
  isAnchor: boolean
  mayStartEarly: boolean
  waitsFor: string[]
  secretViewerIds: string[]
}

export type ItemFormContext = {
  eventDate: Date
  timezone: string
  trackIds: string[]
  /** Punkte, auf die gewartet werden darf (alle des Events außer dem Punkt selbst). */
  itemIds: string[]
  /** Konten, die für die SECRET-Liste infrage kommen (mit Zugriff aufs Event). */
  viewerIds: string[]
}

export type ParsedItemForm = { ok: true; fields: ItemFields } | { ok: false; errors: string[] }

function optional(value: string): string | null {
  return value === '' ? null : value
}

function strings(formData: FormData, name: string, max: number): string[] {
  const values = formData.getAll(name).filter((v): v is string => typeof v === 'string').map(v => v.slice(0, 50))
  return [...new Set(values.filter(Boolean))].slice(0, max + 1)
}

/**
 * Prüft das Formular eines Programmpunkts - rein, ohne Datenbank. Die Kontexte (Spuren, Punkte, Konten) lädt
 * die Server Action; ob "wartet auf" einen Kreis ergibt, prüft sie danach mit checkDependencies aus dem Kern.
 * Fehlermeldungen beginnen mit dem Feldnamen.
 */
export function parseItemForm(formData: FormData, ctx: ItemFormContext): ParsedItemForm {
  const errors: string[] = []
  const raw = (name: string, max: number) => {
    const value = formData.get(name)
    return typeof value === 'string' ? value.slice(0, max + 1) : ''
  }

  const title = cleanText(raw('title', PLAN_LIMITS.titleMax))
  const location = cleanText(raw('location', PLAN_LIMITS.locationMax))
  const description = cleanText(raw('description', PLAN_LIMITS.descriptionMax), true)
  const internalNote = cleanText(raw('internalNote', PLAN_LIMITS.noteMax), true)
  const trackId = raw('trackId', 50).trim()
  const visibility = raw('visibility', 10)
  const startInput = raw('start', 20).trim()
  const durationInput = raw('durationMin', 10).trim()
  const waitsFor = strings(formData, 'waitsFor', PLAN_LIMITS.maxWaitsFor)
  const viewers = strings(formData, 'secretViewers', PLAN_LIMITS.maxSecretViewers)

  if (!title) errors.push('Titel: Bitte gib einen Titel ein.')
  if (title.length > PLAN_LIMITS.titleMax) errors.push(`Titel: höchstens ${PLAN_LIMITS.titleMax} Zeichen.`)
  if (location.length > PLAN_LIMITS.locationMax) errors.push(`Ort: höchstens ${PLAN_LIMITS.locationMax} Zeichen.`)
  if (description.length > PLAN_LIMITS.descriptionMax) errors.push(`Beschreibung: höchstens ${PLAN_LIMITS.descriptionMax} Zeichen.`)
  if (internalNote.length > PLAN_LIMITS.noteMax) errors.push(`Interne Notiz: höchstens ${PLAN_LIMITS.noteMax} Zeichen.`)
  if (!ctx.trackIds.includes(trackId)) errors.push('Spur: Bitte wähle eine Spur.')
  if (!isValidVisibility(visibility)) errors.push('Sichtbarkeit: Bitte wähle eine Sichtbarkeit.')

  const plannedStart = zonedInputToUtc(startInput, ctx.timezone)
  const range = startRange(ctx.eventDate)
  if (!plannedStart) errors.push('Beginn: Bitte gib Datum und Uhrzeit ein.')
  else if (plannedStart < range.from || plannedStart >= range.until) {
    errors.push(`Beginn: Der Punkt muss zwischen dem Vortag und ${PLAN_LIMITS.daysAfter} Tage nach dem Eventtag liegen.`)
  }

  const duration = /^\d{1,4}$/.test(durationInput) ? Number(durationInput) : NaN
  if (!Number.isInteger(duration) || duration < 0 || duration > PLAN_LIMITS.durationMaxMin) {
    errors.push(`Dauer: ganze Minuten von 0 bis ${PLAN_LIMITS.durationMaxMin}.`)
  }

  if (waitsFor.length > PLAN_LIMITS.maxWaitsFor) errors.push(`Wartet auf: höchstens ${PLAN_LIMITS.maxWaitsFor} Punkte.`)
  else if (waitsFor.some(id => !ctx.itemIds.includes(id))) errors.push('Wartet auf: Ein gewählter Punkt existiert nicht (mehr).')

  let secretViewerIds: string[] = []
  if (visibility === 'SECRET') {
    if (viewers.some(id => !ctx.viewerIds.includes(id))) errors.push('Geheim für: Ein gewähltes Konto hat keinen Zugriff auf das Event.')
    else if (viewers.length === 0) errors.push('Geheim für: Wähle mindestens ein Konto, das den Punkt sehen darf.')
    secretViewerIds = viewers
  }

  if (errors.length > 0 || !plannedStart || !isValidVisibility(visibility)) return { ok: false, errors }
  return {
    ok: true,
    fields: {
      title,
      location: optional(location),
      description: optional(description),
      internalNote: optional(internalNote),
      trackId,
      plannedStart,
      plannedDurationMin: duration,
      visibility,
      isAnchor: formData.get('isAnchor') === 'on',
      mayStartEarly: formData.get('mayStartEarly') === 'on',
      waitsFor,
      secretViewerIds
    }
  }
}
