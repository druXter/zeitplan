// app/admin/events/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { formString, normalizeEmail } from '../../lib/form'
import { canCreateEvents } from '../../lib/permissions'
import { loadEventForUser } from '../../lib/events/store'
import { parseEventForm } from '../../lib/events/settings'

// Die Berechtigung prüft JEDE Aktion selbst (über loadEventForUser -> eventLevel), nie nur die Seite.
// owner: Besitzer*in oder Admin. moderator: per Freigabe - in Phase 0 nur ansehen (Live-Steuerung und
// die Schalter "Plan bearbeiten"/"Einschübe" kommen mit Phase 2 und 4).

export type FormState = { errors: string[]; message?: string } | null

const SLUG_TAKEN = 'Adresse: Diese Adresse ist schon vergeben.'

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** Neues Event (Titel, Adresse, Tag, Beschreibung). Neue Events sind immer Entwurf. */
export async function createEvent(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events/new')
  if (!canCreateEvents(user)) redirect('/admin/events')

  const parsed = parseEventForm(formData)
  if (!parsed.ok) return { errors: parsed.errors }

  let eventId: string
  try {
    const event = await prisma.event.create({ data: { ...parsed.fields, status: 'DRAFT', ownerId: user.id } })
    eventId = event.id
  } catch (error) {
    if (isUniqueViolation(error)) return { errors: [SLUG_TAKEN] }
    throw error
  }
  redirect(`/admin/events/${eventId}?created=1`)
}

/** Titel, Adresse, Tag, Beschreibung. Nur owner (Konzept Abschnitt 7: Moderator*innen planen nicht). */
export async function updateEventSettings(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || event.level !== 'owner') redirect('/admin/events')

  const parsed = parseEventForm(formData)
  if (!parsed.ok) return { errors: parsed.errors }

  try {
    await prisma.event.update({ where: { id: event.id }, data: parsed.fields })
  } catch (error) {
    if (isUniqueViolation(error)) return { errors: [SLUG_TAKEN] }
    throw error
  }
  return { errors: [], message: 'Einstellungen gespeichert.' }
}

/**
 * Gibt das Event einem weiteren BESTEHENDEN Konto frei (wie in Seating). Nur owner. Legt nie ein
 * Konto an - wer noch keins hat, wird erst unter /admin/users eingeladen. "Nicht gefunden" verrät
 * eingeloggten Besitzer*innen, ob eine Adresse ein Konto hat - das ist beabsichtigt, sonst wäre
 * Freigeben kaum bedienbar.
 */
export async function shareEvent(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || event.level !== 'owner') redirect('/admin/events')

  const email = normalizeEmail(formString(formData, 'email', 254))
  const target = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null
  if (!target) redirect(`/admin/events/${event.id}?shareError=notfound`)
  if (target.id === event.ownerId) redirect(`/admin/events/${event.id}?shareError=owner`)

  await prisma.eventAccess.upsert({
    where: { eventId_userId: { eventId: event.id, userId: target.id } },
    update: {},
    create: { eventId: event.id, userId: target.id }
  })
  redirect(`/admin/events/${event.id}?shared=1`)
}

/** Nimmt eine Freigabe zurück. Nur owner des betroffenen Events. */
export async function unshareEvent(formData: FormData) {
  const user = await requireUser('/admin/events')
  const access = await prisma.eventAccess.findUnique({ where: { id: formString(formData, 'accessId', 50) }, select: { id: true, eventId: true } })
  if (!access) redirect('/admin/events')
  const event = await loadEventForUser(access.eventId, user)
  if (!event || event.level !== 'owner') redirect('/admin/events')

  await prisma.eventAccess.delete({ where: { id: access.id } })
  redirect(`/admin/events/${event.id}?unshared=1`)
}

/** Löscht das Event samt Freigaben (Cascade, ab Phase 2 auch Spuren, Punkte und Verlauf). Nur owner. */
export async function deleteEvent(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || event.level !== 'owner') redirect('/admin/events')

  await prisma.event.delete({ where: { id: event.id } })
  redirect('/admin/events?deleted=1')
}
