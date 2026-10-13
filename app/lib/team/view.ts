import type { Event } from '@prisma/client'
import { prisma } from '../prisma'
import { project, toGuestView, type Conflict, type GuestItem, type Projected } from '../schedule'
import { loadPlan, type PlanTrack } from '../planning/store'
import type { PlanItem } from '../planning/items'
import { placeIndex, type Place } from '../planning/places'
import { crewTokenValid } from '../guest/tokens'
import { validateSlug } from '../slugs'

export type TeamItem = Projected<PlanItem>

/**
 * Wer die Team-Ansicht liest: ein Konto mit Zugriff (SECRET je nach Eintrag, Namen und E-Mail-Adressen der
 * Zuständigen) oder der Team-Link für Dienstleister (Idee L18): wie ein Konto ohne Eintrag in SECRET-Listen, und
 * Zuständige nur mit Namen, nie mit E-Mail-Adresse.
 */
export type TeamReader = { kind: 'account'; userId: string } | { kind: 'crew' }

/** Kein Konto hat diese id - loadPlan zeigt geheime Punkte damit nur als Platzhalter. */
const CREW_READER_ID = 'team-link'

export type TeamView = {
  tracks: PlanTrack[]
  /** Alle Punkte mit Prognose (bei einer Schleife ohne "wartet auf"). */
  items: TeamItem[]
  conflicts: Conflict[]
  loop: boolean
  /** Was Gäste gerade sehen, je öffentlichem Punkt - ohne zu speichern. */
  guestItems: Map<string, GuestItem>
  /** Ursprungsplan (beim Live-Schalten eingefroren) je Punkt. */
  originals: Map<string, Date | null>
  lastActionAt: Date | null
  placeOf: (location: string | null | undefined) => Place | null
  /** Anzeigename je zuständigem Konto mit Zugriff aufs Event - Zuständige ohne Zugriff fehlen. */
  accountNames: Map<string, string>
}

/**
 * Lädt alles für Team-Ansicht und Team-Link: Punkte über loadPlan (SECRET-Regel), Prognose aus dem Kern, die
 * Zeit, die Gäste sehen (toGuestView rechnet mit, speichert aber nicht - das tun nur Gästeansicht, Tafel und
 * Polling-Endpunkt), Orte und Zuständige.
 */
export async function loadTeamView(event: Event, reader: TeamReader, now: Date): Promise<TeamView> {
  const [{ tracks, items }, shownRows, lastAction, places] = await Promise.all([
    loadPlan(event.id, reader.kind === 'account' ? reader.userId : CREW_READER_ID),
    prisma.item.findMany({ where: { eventId: event.id }, select: { id: true, guestShownStart: true, originalStart: true } }),
    prisma.liveAction.findFirst({ where: { eventId: event.id, actorId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.place.findMany({ where: { eventId: event.id }, select: { id: true, name: true, address: true, mapUrl: true } })
  ])
  // Zuständige mit Zugriff aufs Event: Besitzer*in, Freigabe oder Admin (wie eventAccounts).
  const assigneeIds = [...new Set(items.flatMap(item => item.assigneeIds))]
  const assignees = assigneeIds.length === 0 ? [] : await prisma.user.findMany({
    where: {
      id: { in: assigneeIds },
      OR: [{ role: 'ADMIN' }, ...(event.ownerId ? [{ id: event.ownerId }] : []), { eventAccess: { some: { eventId: event.id } } }]
    },
    select: { id: true, name: true, email: true }
  })

  let projection = project(items, now, event)
  const loop = !projection.ok
  if (!projection.ok) projection = project(items.map(item => ({ ...item, waitsFor: [] })), now, event)
  const projected = projection.ok ? projection.items : []

  const previous = Object.fromEntries(shownRows.map(row => [row.id, row.guestShownStart]))
  const guestItems = new Map(toGuestView({ items: projected, tracks }, previous, now, event).items.map(item => [item.id, item]))

  const accountNames = new Map<string, string>()
  for (const account of assignees) {
    const name = reader.kind === 'account' ? account.name || account.email : account.name
    if (name) accountNames.set(account.id, name)
  }

  return {
    tracks,
    items: projected,
    conflicts: projection.ok ? projection.conflicts : [],
    loop,
    guestItems,
    originals: new Map(shownRows.map(row => [row.id, row.originalStart])),
    lastActionAt: lastAction?.createdAt ?? null,
    placeOf: placeIndex(places),
    accountNames
  }
}

export type MyItem = { item: TeamItem; minutesUntil: number }

/**
 * "Meine Punkte" (Idee L16): Punkte, für die das Konto zuständig ist und die noch kommen oder laufen, nach
 * erwartetem Beginn. minutesUntil: bis zum erwarteten Beginn (aufgerundet; 0 oder weniger = läuft bzw. fällig).
 */
export function myItems(items: TeamItem[], userId: string, now: Date): MyItem[] {
  return items
    .filter(item => item.assigneeIds.includes(userId) && (item.phase === 'upcoming' || item.phase === 'now'))
    .sort((a, b) => a.expectedStart.getTime() - b.expectedStart.getTime())
    .map(item => ({ item, minutesUntil: Math.ceil((item.expectedStart.getTime() - now.getTime()) / 60_000) }))
}

/**
 * Event zum Team-Link /<slug>/team?k=... (Idee L18) oder null - nach außen immer 404, egal ob es das Event nicht
 * gibt, der Link aus ist, der Schlüssel nicht passt oder das Event archiviert ist. Anders als die Tafel auch für
 * Entwürfe: Dienstleister bereiten sich vor dem Veröffentlichen vor.
 */
export async function resolveCrewEvent(slug: string, key: string | undefined): Promise<Event | null> {
  if (!key || validateSlug(slug) !== null) return null
  const event = await prisma.event.findUnique({ where: { slug } })
  if (!event || !event.crewLinkEnabled || event.status === 'ARCHIVED') return null
  return crewTokenValid(event.id, event.crewLinkVersion, key) ? event : null
}
