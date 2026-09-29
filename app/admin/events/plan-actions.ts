'use server'

import { redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { formString } from '../../lib/form'
import { canAddRemoveItems, canEditItem, canEditPlan, canManageEvent } from '../../lib/permissions'
import { loadEventForUser, type LoadedEvent } from '../../lib/events/store'
import { checkDependencies, swapAdjacent, type DependencyProblem, type ScheduleItem } from '../../lib/schedule'
import { parseItemForm } from '../../lib/planning/items'
import { nextSortOrder, placeInTrack } from '../../lib/planning/order'
import { cleanText, isValidTrackVisibility, PLAN_LIMITS } from '../../lib/planning/rules'
import { bumpLiveVersion, eventAccounts, loadPlan } from '../../lib/planning/store'

// Planung (docs/KONZEPT.md Abschnitt 4). JEDE Aktion prüft selbst: Zugriff aufs Event (loadEventForUser), das
// Recht (canEditPlan/canAddRemoveItems/canManageEvent) und bei SECRET-Punkten den Eintrag in der Kontenliste
// (canEditItem über loadPlan). Gelesen und geschrieben wird in EINER Transaktion, jede Änderung zählt
// liveVersion hoch. Regeln (Reihenfolge, Tauschen, Kreise) kommen aus app/lib/planning und app/lib/schedule.

export type ItemFormState = { errors: string[] } | null

const STALE = 'Der Punkt wurde inzwischen geändert. Lade die Seite neu und versuche es noch einmal.'
const NEW_ID = '__new__'

function planUrl(eventId: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString()
  return `/admin/events/${eventId}/plan${query ? `?${query}` : ''}`
}

async function loadEvent(formData: FormData): Promise<{ user: Awaited<ReturnType<typeof requireUser>>; event: LoadedEvent }> {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')
  return { user, event }
}

/** Fehlermeldung für einen Kreis - mit den Titeln, die das Konto sehen darf (Platzhalter bei SECRET). */
function dependencyMessage(problem: DependencyProblem, items: { id: string; title: string }[]): string {
  const title = (id: string) => items.find(item => item.id === id)?.title ?? '?'
  if (problem.kind === 'unknown') return 'Wartet auf: Ein gewählter Punkt existiert nicht (mehr).'
  return `Wartet auf: Das ergibt eine Schleife (${problem.itemIds.map(title).join(' → ')}).`
}

class StaleError extends Error {}

/**
 * Punkt anlegen (ohne itemId) oder ändern. Neue Punkte und Punkte mit neuem Beginn oder neuer Spur werden nach
 * ihrem Beginn einsortiert (placeInTrack). Ändern prüft die Version: Hat jemand anderes den Punkt inzwischen
 * gespeichert, wird abgelehnt statt überschrieben.
 */
export async function saveItem(_previous: ItemFormState, formData: FormData): Promise<ItemFormState> {
  const { user, event } = await loadEvent(formData)
  if (!canEditPlan(event.level, event)) redirect(`/admin/events/${event.id}`)
  const itemId = formString(formData, 'itemId', 50) || null
  if (!itemId && !canAddRemoveItems(event.level, event)) redirect(planUrl(event.id))

  let outcome: { errors: string[] } | { forbidden: true } | { savedId: string; trackId: string }
  try {
    outcome = await prisma.$transaction(async tx => {
      const { tracks, items } = await loadPlan(event.id, user.id, tx)
      const existing = itemId ? items.find(item => item.id === itemId) : undefined
      if (itemId && (!existing || !canEditItem(event.level, event, existing, existing.canSee))) return { forbidden: true as const }
      if (existing && formString(formData, 'version', 10) !== String(existing.version)) return { errors: [STALE] }

      const accounts = await eventAccounts(event, user, tx)
      const parsed = parseItemForm(formData, {
        eventDate: event.date,
        timezone: event.timezone,
        trackIds: tracks.map(track => track.id),
        itemIds: items.filter(item => item.id !== itemId).map(item => item.id),
        viewerIds: accounts.map(account => account.id)
      })
      if (!parsed.ok) return { errors: parsed.errors }
      const fields = parsed.fields

      // Einsortieren: nur neu, mit anderem Beginn oder in anderer Spur - sonst bleibt die Position.
      const id = existing?.id ?? NEW_ID
      const reposition = !existing || existing.trackId !== fields.trackId || existing.plannedStart.getTime() !== fields.plannedStart.getTime()
      const order = reposition ? placeInTrack(items.filter(item => item.trackId === fields.trackId), { id, sortOrder: 0, plannedStart: fields.plannedStart }) : []
      const newOrder = new Map(order.map(entry => [entry.id, entry.sortOrder]))
      const sortOrder = newOrder.get(id) ?? existing!.sortOrder

      const candidate: ScheduleItem & { title: string } = {
        id,
        title: fields.title,
        trackId: fields.trackId,
        sortOrder,
        plannedStart: fields.plannedStart,
        plannedDurationMin: fields.plannedDurationMin,
        isAnchor: fields.isAnchor,
        mayStartEarly: fields.mayStartEarly,
        status: existing?.status ?? 'PLANNED',
        actualStart: existing?.actualStart ?? null,
        actualEnd: existing?.actualEnd ?? null,
        reportedDelayMin: existing?.reportedDelayMin ?? null,
        waitsFor: fields.waitsFor
      }
      const others = items.filter(item => item.id !== id).map(item => ({ ...item, sortOrder: newOrder.get(item.id) ?? item.sortOrder }))
      const problem = checkDependencies([...others, candidate])
      if (problem) return { errors: [dependencyMessage(problem, [...others, candidate])] }

      const data = {
        title: fields.title,
        location: fields.location,
        description: fields.description,
        internalNote: fields.internalNote,
        visibility: fields.visibility,
        isAnchor: fields.isAnchor,
        mayStartEarly: fields.mayStartEarly,
        plannedStart: fields.plannedStart,
        plannedDurationMin: fields.plannedDurationMin,
        trackId: fields.trackId,
        sortOrder
      }
      let savedId: string
      if (existing) {
        const updated = await tx.item.updateMany({ where: { id: existing.id, eventId: event.id, version: existing.version }, data: { ...data, version: { increment: 1 } } })
        if (updated.count === 0) throw new StaleError()
        savedId = existing.id
      } else {
        const created = await tx.item.create({ data: { ...data, eventId: event.id, insertedLive: event.status === 'LIVE' } })
        savedId = created.id
      }

      for (const item of others) {
        const before = items.find(i => i.id === item.id)!
        if (before.sortOrder !== item.sortOrder) await tx.item.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })
      }
      await tx.itemDependency.deleteMany({ where: { itemId: savedId } })
      if (fields.waitsFor.length > 0) await tx.itemDependency.createMany({ data: fields.waitsFor.map(other => ({ itemId: savedId, waitsForItemId: other })) })
      await tx.itemSecretViewer.deleteMany({ where: { itemId: savedId } })
      if (fields.secretViewerIds.length > 0) await tx.itemSecretViewer.createMany({ data: fields.secretViewerIds.map(userId => ({ itemId: savedId, userId })) })
      await bumpLiveVersion(event.id, tx)
      return { savedId, trackId: fields.trackId }
    })
  } catch (error) {
    if (error instanceof StaleError) return { errors: [STALE] }
    throw error
  }

  if ('forbidden' in outcome) redirect(planUrl(event.id))
  if ('errors' in outcome) return outcome
  redirect(`${planUrl(event.id, { saved: '1' })}#item-${outcome.savedId}`)
}

/** Punkt löschen - Plan bearbeiten (live: Schalter "Einschübe und Löschen") und bei SECRET eingetragen. */
export async function deleteItem(formData: FormData) {
  const { user, event } = await loadEvent(formData)
  if (!canAddRemoveItems(event.level, event)) redirect(planUrl(event.id))
  const itemId = formString(formData, 'itemId', 50)

  const deleted = await prisma.$transaction(async tx => {
    const { items } = await loadPlan(event.id, user.id, tx)
    const item = items.find(i => i.id === itemId)
    if (!item || !canEditItem(event.level, event, item, item.canSee)) return false
    await tx.item.delete({ where: { id: item.id } })
    await bumpLiveVersion(event.id, tx)
    return true
  })
  redirect(planUrl(event.id, deleted ? { deleted: '1' } : {}))
}

/**
 * Nach oben/unten: tauscht den Punkt mit dem genannten Nachbarn (swapAdjacent aus dem Kern - B übernimmt den
 * Beginn von A, A folgt mit demselben Abstand). Absichtsbasiert: Sind die beiden inzwischen keine Nachbarn
 * mehr, wird abgelehnt. Beide Punkte müssen für das Konto bearbeitbar sein (SECRET).
 */
export async function moveItem(formData: FormData) {
  const { user, event } = await loadEvent(formData)
  if (!canEditPlan(event.level, event)) redirect(`/admin/events/${event.id}`)
  const itemId = formString(formData, 'itemId', 50)
  const otherId = formString(formData, 'otherId', 50)
  const back = { track: formString(formData, 'track', 50) || 'all' }

  const result = await prisma.$transaction(async tx => {
    const { items } = await loadPlan(event.id, user.id, tx)
    const pair = [items.find(i => i.id === itemId), items.find(i => i.id === otherId)]
    if (pair.some(item => !item || !canEditItem(event.level, event, item, item.canSee))) return 'forbidden'
    const swap = swapAdjacent(items, itemId, otherId)
    if (!swap.ok) return swap.reason
    for (const change of swap.changes) {
      await tx.item.update({ where: { id: change.id }, data: { plannedStart: change.plannedStart, sortOrder: change.sortOrder, version: { increment: 1 } } })
    }
    await bumpLiveVersion(event.id, tx)
    return 'ok'
  })
  redirect(`${planUrl(event.id, result === 'ok' ? { ...back, moved: '1' } : { ...back, moveError: result })}#item-${itemId}`)
}

// Spuren: nur owner (Abschnitt 7 - der Schalter "Plan bearbeiten" betrifft Punkte, nicht die Spuren).

function trackFields(formData: FormData): { name: string; visibility: 'PUBLIC' | 'TEAM' } | null {
  const name = cleanText(formString(formData, 'name', PLAN_LIMITS.trackNameMax * 2))
  const visibility = formString(formData, 'visibility', 10)
  if (!name || name.length > PLAN_LIMITS.trackNameMax || !isValidTrackVisibility(visibility)) return null
  return { name, visibility }
}

export async function createTrack(formData: FormData) {
  const { event } = await loadEvent(formData)
  if (!canManageEvent(event.level)) redirect(planUrl(event.id))
  const fields = trackFields(formData)
  if (!fields) redirect(planUrl(event.id, { trackError: 'invalid' }))

  const trackId = await prisma.$transaction(async tx => {
    const tracks = await tx.track.findMany({ where: { eventId: event.id }, select: { sortOrder: true } })
    if (tracks.length >= PLAN_LIMITS.maxTracks) return null
    const track = await tx.track.create({ data: { ...fields, eventId: event.id, sortOrder: nextSortOrder(tracks) } })
    await bumpLiveVersion(event.id, tx)
    return track.id
  })
  redirect(trackId ? planUrl(event.id, { track: trackId, trackSaved: '1' }) : planUrl(event.id, { trackError: 'limit' }))
}

export async function updateTrack(formData: FormData) {
  const { event } = await loadEvent(formData)
  if (!canManageEvent(event.level)) redirect(planUrl(event.id))
  const trackId = formString(formData, 'trackId', 50)
  const fields = trackFields(formData)
  if (!fields) redirect(planUrl(event.id, { track: trackId, trackError: 'invalid' }))

  await prisma.$transaction(async tx => {
    const updated = await tx.track.updateMany({ where: { id: trackId, eventId: event.id }, data: fields })
    if (updated.count > 0) await bumpLiveVersion(event.id, tx)
  })
  redirect(planUrl(event.id, { track: trackId, trackSaved: '1' }))
}

/** Tab nach links/rechts: tauscht die Reihenfolge mit der benachbarten Spur. */
export async function moveTrack(formData: FormData) {
  const { event } = await loadEvent(formData)
  if (!canManageEvent(event.level)) redirect(planUrl(event.id))
  const trackId = formString(formData, 'trackId', 50)
  const direction = formString(formData, 'direction', 10) === 'left' ? -1 : 1

  await prisma.$transaction(async tx => {
    const tracks = await tx.track.findMany({ where: { eventId: event.id }, orderBy: { sortOrder: 'asc' }, select: { id: true } })
    const index = tracks.findIndex(track => track.id === trackId)
    const other = tracks[index + direction]
    if (index < 0 || !other) return
    const reordered = [...tracks]
    reordered[index] = other
    reordered[index + direction] = tracks[index]
    for (const [position, track] of reordered.entries()) await tx.track.update({ where: { id: track.id }, data: { sortOrder: position + 1 } })
    await bumpLiveVersion(event.id, tx)
  })
  redirect(planUrl(event.id, { track: trackId }))
}

/** Nur leere Spuren, und nie die letzte - Punkte werden nie nebenbei mitgelöscht. */
export async function deleteTrack(formData: FormData) {
  const { event } = await loadEvent(formData)
  if (!canManageEvent(event.level)) redirect(planUrl(event.id))
  const trackId = formString(formData, 'trackId', 50)

  const result = await prisma.$transaction(async tx => {
    const track = await tx.track.findFirst({ where: { id: trackId, eventId: event.id }, select: { id: true, _count: { select: { items: true } } } })
    if (!track) return 'missing'
    if (track._count.items > 0) return 'notEmpty'
    if ((await tx.track.count({ where: { eventId: event.id } })) <= 1) return 'last'
    await tx.track.delete({ where: { id: track.id } })
    await bumpLiveVersion(event.id, tx)
    return 'ok'
  })
  redirect(result === 'ok' ? planUrl(event.id, { trackDeleted: '1' }) : planUrl(event.id, { track: trackId, trackError: result }))
}
