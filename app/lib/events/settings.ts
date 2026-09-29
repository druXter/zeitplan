// app/lib/events/settings.ts
import type { EventStatus } from '@prisma/client'
import { formString } from '../form'
import { validateSlug } from '../slugs'
import { DEFAULT_TIMEZONE, zonedDateToUtc } from '../timezone'

export const STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: 'Entwurf',
  PUBLISHED: 'Veröffentlicht',
  LIVE: 'Live',
  ENDED: 'Beendet',
  ARCHIVED: 'Archiviert'
}

export const TITLE_MAX_LENGTH = 120
export const DESCRIPTION_MAX_LENGTH = 2000

export type EventFields = { title: string; slug: string; description: string; date: Date; timezone: string }

export type ParsedEventForm = { ok: true; fields: EventFields } | { ok: false; errors: string[] }

/**
 * Prüft das Formular "Event anlegen/bearbeiten" (Titel, Adresse, Tag, Beschreibung) - rein, ohne
 * Datenbank; ob die Adresse schon vergeben ist, entscheidet der Unique-Index beim Speichern. Die
 * Zeitzone ist vorerst immer Europe/Berlin (docs/KONZEPT.md Abschnitt 4). Fehlermeldungen beginnen mit
 * dem Feldnamen, damit sie ohne Zuordnung zum Feld verständlich sind.
 */
export function parseEventForm(formData: FormData): ParsedEventForm {
  const errors: string[] = []
  const title = formString(formData, 'title', TITLE_MAX_LENGTH + 1)
  const slug = formString(formData, 'slug', 100)
  const description = formString(formData, 'description', DESCRIPTION_MAX_LENGTH + 1)
  const timezone = DEFAULT_TIMEZONE
  const date = zonedDateToUtc(formString(formData, 'date', 20), timezone)

  if (!title) errors.push('Titel: Bitte gib einen Titel ein.')
  if (title.length > TITLE_MAX_LENGTH) errors.push(`Titel: höchstens ${TITLE_MAX_LENGTH} Zeichen.`)
  const slugError = validateSlug(slug)
  if (slugError) errors.push(`Adresse: ${slugError}`)
  if (description.length > DESCRIPTION_MAX_LENGTH) errors.push(`Beschreibung: höchstens ${DESCRIPTION_MAX_LENGTH} Zeichen.`)
  if (!date) errors.push('Datum: Bitte gib ein gültiges Datum ein.')

  if (errors.length > 0 || !date) return { ok: false, errors }
  return { ok: true, fields: { title, slug, description, date, timezone } }
}

/** Einstellungen der Prognose und der Gästeanzeige (docs/KONZEPT.md Abschnitt 2), Werte in Minuten. */
export type EventOptions = {
  autoCreep: boolean
  creepNudgeMin: number
  creepCapMin: number
  guestRoundingMin: number
  hysteresisMin: number
  showDelayToGuests: boolean
  guestHorizonMin: number
}

export const DEFAULT_EVENT_OPTIONS: EventOptions = {
  autoCreep: true,
  creepNudgeMin: 5,
  creepCapMin: 30,
  guestRoundingMin: 5,
  hysteresisMin: 3,
  showDelayToGuests: false,
  guestHorizonMin: 120
}

/** Erlaubte Bereiche der Minutenwerte - für das Formular und den Import. */
export const OPTION_BOUNDS = {
  creepNudgeMin: { min: 1, max: 60, label: 'Nachfrage nach' },
  creepCapMin: { min: 0, max: 240, label: 'Deckel' },
  guestRoundingMin: { min: 1, max: 30, label: 'Rundung' },
  hysteresisMin: { min: 0, max: 15, label: 'Hysterese' },
  guestHorizonMin: { min: 0, max: 1440, label: 'Horizont' }
} as const satisfies Partial<Record<keyof EventOptions, { min: number; max: number; label: string }>>

export type ParsedEventOptions =
  | { ok: true; options: EventOptions; modsMayEditPlan: boolean; modsMayInsert: boolean }
  | { ok: false; errors: string[] }

/** Formular "Ablauf und Gäste": Prognose, Anzeige für Gäste und die beiden Schalter für Moderator*innen. */
export function parseEventOptions(formData: FormData): ParsedEventOptions {
  const errors: string[] = []
  const minutes = {} as Record<keyof typeof OPTION_BOUNDS, number>
  for (const [key, bound] of Object.entries(OPTION_BOUNDS) as [keyof typeof OPTION_BOUNDS, (typeof OPTION_BOUNDS)[keyof typeof OPTION_BOUNDS]][]) {
    const raw = formString(formData, key, 10)
    const value = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN
    if (!Number.isInteger(value) || value < bound.min || value > bound.max) {
      errors.push(`${bound.label}: ganze Minuten von ${bound.min} bis ${bound.max}.`)
    }
    minutes[key] = value
  }
  if (errors.length > 0) return { ok: false, errors }
  const flag = (name: string) => formData.get(name) === 'on'
  return {
    ok: true,
    options: { ...minutes, autoCreep: flag('autoCreep'), showDelayToGuests: flag('showDelayToGuests') },
    modsMayEditPlan: flag('modsMayEditPlan'),
    modsMayInsert: flag('modsMayInsert')
  }
}

/**
 * Statuswechsel, die die Planung erlaubt. LIVE und ENDED setzt erst die Live-Steuerung (Phase 4): Live-Schalten
 * friert dort den Ursprungsplan ein, ENDED folgt automatisch nach dem Eventende.
 */
export function allowedStatusChanges(status: EventStatus): EventStatus[] {
  switch (status) {
    case 'DRAFT': return ['PUBLISHED', 'ARCHIVED']
    case 'PUBLISHED': return ['DRAFT', 'ARCHIVED']
    case 'ENDED': return ['ARCHIVED']
    case 'ARCHIVED': return ['DRAFT']
    case 'LIVE': return []
  }
}
