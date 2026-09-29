import { formString } from '../form'
import { validateSlug } from '../slugs'
import { cleanText } from '../planning/rules'
import { TITLE_MAX_LENGTH } from './settings'

export type ParsedSeriesForm = { ok: true; fields: { title: string; slug: string } } | { ok: false; errors: string[] }

/** Formular einer Reihe (Titel, Adresse) - rein. Ob die Adresse frei ist (Events UND Reihen), prüft die Action. */
export function parseSeriesForm(formData: FormData): ParsedSeriesForm {
  const title = cleanText(formString(formData, 'title', TITLE_MAX_LENGTH + 1))
  const slug = formString(formData, 'slug', 100)
  const errors: string[] = []
  if (!title) errors.push('Titel: Bitte gib einen Titel ein.')
  if (title.length > TITLE_MAX_LENGTH) errors.push(`Titel: höchstens ${TITLE_MAX_LENGTH} Zeichen.`)
  const slugError = validateSlug(slug)
  if (slugError) errors.push(`Adresse: ${slugError}`)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, fields: { title, slug } }
}

/** Reihe ändern/löschen und Events zuordnen: das besitzende Konto oder Admins. */
export function canManageSeries(user: { id: string; role: string }, series: { ownerId: string | null }): boolean {
  return user.role === 'ADMIN' || (series.ownerId !== null && series.ownerId === user.id)
}
