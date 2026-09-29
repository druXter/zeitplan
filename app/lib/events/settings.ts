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
