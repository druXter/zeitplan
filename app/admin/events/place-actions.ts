'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { formString } from '../../lib/form'
import { canEditItem, canEditPlan } from '../../lib/permissions'
import { loadEventForUser } from '../../lib/events/store'
import { parsePlace, placeKey, PLACE_LIMITS } from '../../lib/planning/places'
import { bumpLiveVersion, loadPlan } from '../../lib/planning/store'

// Orte mit Adresse (Idee L22). Recht wie für den Plan: "Plan bearbeiten" (canEditPlan). Jede Änderung zählt
// liveVersion hoch - Adressen erscheinen in der Gästeansicht.

export type PlaceFormState = { errors: string[]; message?: string } | null

/**
 * Ort anlegen (ohne placeId) oder ändern. Umbenennen zieht die Punkte mit dem alten Namen mit (Feld "Ort") - nur
 * die, die das Konto bearbeiten darf; ein geheimer Punkt ohne Eintrag behält den alten Namen und verliert damit
 * nur die Adresse, statt unbemerkt geändert zu werden.
 */
export async function savePlace(_previous: PlaceFormState, formData: FormData): Promise<PlaceFormState> {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')
  if (!canEditPlan(event.level, event)) redirect(`/admin/events/${event.id}`)
  const placeId = formString(formData, 'placeId', 50) || null

  const result = await prisma.$transaction(async tx => {
    const places = await tx.place.findMany({ where: { eventId: event.id } })
    const existing = placeId ? places.find(place => place.id === placeId) : undefined
    if (placeId && !existing) return { errors: ['Diesen Ort gibt es nicht mehr.'] }
    if (!existing && places.length >= PLACE_LIMITS.maxPlaces) return { errors: [`Es sind höchstens ${PLACE_LIMITS.maxPlaces} Orte möglich.`] }
    const parsed = parsePlace(
      { name: formString(formData, 'name', 1000), address: formString(formData, 'address', 1000), mapUrl: formString(formData, 'mapUrl', 1000) },
      places.filter(place => place.id !== placeId)
    )
    if (!parsed.ok) return { errors: parsed.errors }

    if (!existing) {
      await tx.place.create({ data: { ...parsed.fields, eventId: event.id } })
    } else {
      await tx.place.update({ where: { id: existing.id }, data: parsed.fields })
      if (existing.name !== parsed.fields.name) {
        const { items } = await loadPlan(event.id, user.id, tx)
        const renamed = items.filter(item => item.location && placeKey(item.location) === placeKey(existing.name) && canEditItem(event.level, event, item, item.canSee))
        for (const item of renamed) await tx.item.update({ where: { id: item.id }, data: { location: parsed.fields.name, version: { increment: 1 } } })
      }
    }
    await bumpLiveVersion(event.id, tx)
    return { errors: [], message: existing ? 'Ort gespeichert.' : 'Ort angelegt.' }
  })
  revalidatePath(`/admin/events/${event.id}/plan`)
  return result
}

/** Ort löschen: Die Punkte behalten ihren Ort als Text, nur Adresse und Route entfallen. */
export async function deletePlace(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')
  if (!canEditPlan(event.level, event)) redirect(`/admin/events/${event.id}`)
  await prisma.$transaction(async tx => {
    const deleted = await tx.place.deleteMany({ where: { id: formString(formData, 'placeId', 50), eventId: event.id } })
    if (deleted.count > 0) await bumpLiveVersion(event.id, tx)
  })
  redirect(`/admin/events/${event.id}/plan?placeDeleted=1#orte`)
}
