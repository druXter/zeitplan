import { createHash } from 'node:crypto'
import { cache } from 'react'
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { getCurrentUser } from '../auth'
import { loadEventForUser } from '../events/store'
import { validateSlug } from '../slugs'
import { project, toGuestView, type GuestSourceItem } from '../schedule'
import { guestVisibility, isGuestVisibleStatus, needsAccountCheck, type GuestVisibility } from './access'
import { hasGuestSession } from './session'
import { displayTokenValid } from './tokens'
import { buildGuestPayload, type GuestPayload } from './payload'
import { currentAnnouncement } from './announcement'
import { placeIndex, routeUrl, type PlaceFields } from '../planning/places'
import { isPushConfigured } from '../push'
import type { GuestView } from '../schedule'

function guestPlace(place: PlaceFields | null): { address: string; routeUrl: string } | null {
  return place ? { address: place.address, routeUrl: routeUrl(place) } : null
}

const guestEventSelect = {
  id: true, slug: true, title: true, description: true, date: true, timezone: true, status: true, access: true,
  displayTokenVersion: true,
  autoCreep: true, creepNudgeMin: true, creepCapMin: true,
  guestRoundingMin: true, hysteresisMin: true, showDelayToGuests: true, guestHorizonMin: true,
  announcementText: true, announcementAt: true, announcementUntil: true,
  guestAlerts: true, guestAlertLeadMin: true, guestShiftAlertMin: true,
  series: { select: { slug: true, title: true } },
  accessCodeHmac: true
} as const

type GuestEventRow = Prisma.EventGetPayload<{ select: typeof guestEventSelect }>

/**
 * accessCodeHmac selbst verlässt diese Datei nie - Seiten erfahren nur, ob ein Code festgelegt ist. Ohne
 * VAPID-Schlüssel gibt es keine Erinnerungen für Gäste (Idee L12) - dann gilt guestAlerts überall als OFF.
 */
function toGuestEvent(row: GuestEventRow) {
  const { accessCodeHmac, guestAlerts, ...event } = row
  return { ...event, guestAlerts: isPushConfigured() ? guestAlerts : 'OFF' as const, hasAccessCode: accessCodeHmac !== null }
}

async function findGuestEvent(slug: string) {
  const row = await prisma.event.findUnique({ where: { slug }, select: guestEventSelect })
  return row ? toGuestEvent(row) : null
}

export type GuestEvent = ReturnType<typeof toGuestEvent>

/** Events mit Erinnerungen für Gäste (Idee L12, app/lib/guest-alerts/send.ts) - wie die Gästeansicht sie lädt. */
export async function findGuestEvents(where: Prisma.EventWhereInput): Promise<GuestEvent[]> {
  return (await prisma.event.findMany({ where, select: guestEventSelect })).map(toGuestEvent)
}

export type ResolvedGuestEvent = { event: GuestEvent; visibility: Exclude<GuestVisibility, 'hidden'> }

/**
 * Event zu /<slug> samt Sichtbarkeit (app/lib/guest/access.ts) - für Gästeansicht, Tafel und Polling-Endpunkt
 * gleich. null: gibt es nicht oder nicht sichtbar (nach außen gleich). Anmeldung, Gast-Sitzung und Tafel-Link
 * werden nur geprüft, wenn das Event nicht ohnehin öffentlich ist. displayKey: Tafel-Link (nur Tafel und
 * Endpunkt reichen ihn herein, nie die Gästeansicht). Pro Anfrage zwischengespeichert (Metadaten und Seite
 * teilen sich den Aufruf).
 */
export const resolveGuestEvent = cache(async (slug: string, displayKey?: string): Promise<ResolvedGuestEvent | null> => {
  if (validateSlug(slug) !== null) return null
  const event = await findGuestEvent(slug)
  if (!event) return null
  let accountAccess = false
  let guestAccess = false
  if (needsAccountCheck(event)) {
    const user = await getCurrentUser()
    accountAccess = user !== null && (await loadEventForUser(event.id, user)) !== null
    if (!accountAccess && isGuestVisibleStatus(event.status)) {
      guestAccess = (event.access === 'ACCOUNT' && user !== null)
        || (displayKey !== undefined && displayTokenValid(event.id, event.displayTokenVersion, displayKey))
        || (await hasGuestSession(event, new Date()))
    }
  }
  const visibility = guestVisibility(event, { accountAccess, guestAccess })
  return visibility === 'hidden' ? null : { event, visibility }
})

/**
 * Lädt den Ablauf eines Events, rechnet Prognose (project) und Gästeanzeige (toGuestView) und speichert den
 * gezeigten Beginn je Punkt (guestShownStart) für die Hysterese der nächsten Anfrage - nur, wo er sich ändert.
 * Das ist die einzige Schreibaktion einer Gästeanfrage; sie ändert weder Item.version noch liveVersion.
 *
 * Interne Notizen werden gar nicht erst gelesen. Titel und Texte von TEAM- und SECRET-Punkten schon (der Kern
 * braucht die Punkte für die Kette) - heraus kommt aber nur, was toGuestView freigibt.
 */
export async function loadGuestPayload(event: GuestEvent, now: Date): Promise<GuestPayload> {
  const { view, publicTrackCount } = await loadGuestView(event, now)
  return buildGuestPayload(event, view, publicTrackCount, currentAnnouncement(event, now))
}

/**
 * Die Gästeansicht selbst (toGuestView) samt Speichern von guestShownStart - für loadGuestPayload und die Erinnerungen
 * an Gäste (Idee L12), damit eine Erinnerung genau die Zeit nennt, die Gäste in der Ansicht sehen.
 */
export async function loadGuestView(event: GuestEvent, now: Date): Promise<{ view: GuestView; publicTrackCount: number }> {
  const [tracks, rows, places] = await Promise.all([
    prisma.track.findMany({ where: { eventId: event.id }, select: { id: true, name: true, visibility: true, sortOrder: true } }),
    prisma.item.findMany({
      where: { eventId: event.id },
      select: {
        id: true, trackId: true, sortOrder: true, title: true, location: true, description: true, visibility: true,
        isAnchor: true, mayStartEarly: true, plannedStart: true, plannedDurationMin: true, minDurationMin: true, status: true,
        actualStart: true, actualEnd: true, reportedDelayMin: true, cancelReason: true, guestShownStart: true, guestAlert: true,
        waitsFor: { select: { waitsForItemId: true } }
      }
    }),
    prisma.place.findMany({ where: { eventId: event.id }, select: { name: true, address: true, mapUrl: true } })
  ])

  const placeOf = placeIndex(places)
  const items: GuestSourceItem[] = rows.map(row => ({
    id: row.id,
    trackId: row.trackId,
    sortOrder: row.sortOrder,
    title: row.title,
    location: row.location,
    description: row.description,
    visibility: row.visibility,
    isAnchor: row.isAnchor,
    mayStartEarly: row.mayStartEarly,
    plannedStart: row.plannedStart,
    plannedDurationMin: row.plannedDurationMin,
    minDurationMin: row.minDurationMin,
    status: row.status,
    actualStart: row.actualStart,
    actualEnd: row.actualEnd,
    reportedDelayMin: row.reportedDelayMin,
    cancelReason: row.cancelReason,
    place: guestPlace(placeOf(row.location)),
    guestAlert: row.guestAlert,
    waitsFor: row.waitsFor.map(d => d.waitsForItemId)
  }))

  // Die Planung lässt keine Schleifen zu. Sollte trotzdem eine in der Datenbank stehen, sehen Gäste den Ablauf
  // ohne Zusammenführungen statt einer Fehlerseite - ohne "wartet auf" gibt es keine Schleife.
  let projection = project(items, now, event)
  if (!projection.ok) projection = project(items.map(item => ({ ...item, waitsFor: [] })), now, event)
  if (!projection.ok) throw new Error('Prognose ohne Abhängigkeiten gescheitert')

  const previous = Object.fromEntries(rows.map(row => [row.id, row.guestShownStart]))
  const view = toGuestView({ items: projection.items, tracks }, previous, now, event)

  const changed = Object.entries(view.shown).filter(([id, shown]) => previous[id]?.getTime() !== shown.getTime())
  if (changed.length > 0) {
    // updateMany statt update: Ein inzwischen gelöschter Punkt ist kein Fehler.
    await prisma.$transaction(changed.map(([id, shown]) => prisma.item.updateMany({ where: { id }, data: { guestShownStart: shown } })))
  }

  return { view, publicTrackCount: tracks.filter(track => track.visibility === 'PUBLIC').length }
}

/**
 * ETag aus dem Inhalt selbst: Er ändert sich genau dann, wenn Gäste etwas anderes sehen würden - nach Planung
 * oder Live-Aktion ebenso wie durch Fortschreiben, Horizont oder geänderte Einstellungen (Abweichung vom
 * Konzept "Version + Minute", siehe docs/KONZEPT.md "Entschieden").
 */
export function payloadEtag(payload: GuestPayload): string {
  return `"${createHash('sha256').update(JSON.stringify(payload)).digest('base64url').slice(0, 27)}"`
}
