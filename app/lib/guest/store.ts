import { createHash } from 'node:crypto'
import { cache } from 'react'
import { prisma } from '../prisma'
import { getCurrentUser } from '../auth'
import { loadEventForUser } from '../events/store'
import { validateSlug } from '../slugs'
import { project, toGuestView, type GuestSourceItem } from '../schedule'
import { guestVisibility, needsAccountCheck, type GuestVisibility } from './access'
import { buildGuestPayload, type GuestPayload } from './payload'

const guestEventSelect = {
  id: true, slug: true, title: true, description: true, date: true, timezone: true, status: true, access: true,
  autoCreep: true, creepNudgeMin: true, creepCapMin: true,
  guestRoundingMin: true, hysteresisMin: true, showDelayToGuests: true, guestHorizonMin: true,
  series: { select: { slug: true, title: true } }
} as const

async function findGuestEvent(slug: string) {
  return prisma.event.findUnique({ where: { slug }, select: guestEventSelect })
}

export type GuestEvent = NonNullable<Awaited<ReturnType<typeof findGuestEvent>>>

export type ResolvedGuestEvent = { event: GuestEvent; visibility: Exclude<GuestVisibility, 'hidden'> }

/**
 * Event zu /<slug> samt Sichtbarkeit (app/lib/guest/access.ts) - für Gästeansicht, Tafel und Polling-Endpunkt
 * gleich. null: gibt es nicht oder nicht sichtbar (nach außen gleich). Die Anmeldung wird nur gelesen, wenn das
 * Event nicht ohnehin öffentlich ist. Pro Anfrage zwischengespeichert (Metadaten und Seite teilen sich den Aufruf).
 */
export const resolveGuestEvent = cache(async (slug: string): Promise<ResolvedGuestEvent | null> => {
  if (validateSlug(slug) !== null) return null
  const event = await findGuestEvent(slug)
  if (!event) return null
  let hasAccess = false
  if (needsAccountCheck(event)) {
    const user = await getCurrentUser()
    hasAccess = user !== null && (await loadEventForUser(event.id, user)) !== null
  }
  const visibility = guestVisibility(event, hasAccess)
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
  const [tracks, rows] = await Promise.all([
    prisma.track.findMany({ where: { eventId: event.id }, select: { id: true, name: true, visibility: true, sortOrder: true } }),
    prisma.item.findMany({
      where: { eventId: event.id },
      select: {
        id: true, trackId: true, sortOrder: true, title: true, location: true, description: true, visibility: true,
        isAnchor: true, mayStartEarly: true, plannedStart: true, plannedDurationMin: true, status: true,
        actualStart: true, actualEnd: true, reportedDelayMin: true, cancelReason: true, guestShownStart: true,
        waitsFor: { select: { waitsForItemId: true } }
      }
    })
  ])

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
    status: row.status,
    actualStart: row.actualStart,
    actualEnd: row.actualEnd,
    reportedDelayMin: row.reportedDelayMin,
    cancelReason: row.cancelReason,
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

  return buildGuestPayload(event, view, tracks.filter(track => track.visibility === 'PUBLIC').length)
}

/**
 * ETag aus dem Inhalt selbst: Er ändert sich genau dann, wenn Gäste etwas anderes sehen würden - nach Planung
 * oder Live-Aktion ebenso wie durch Fortschreiben, Horizont oder geänderte Einstellungen (Abweichung vom
 * Konzept "Version + Minute", siehe docs/KONZEPT.md "Entschieden").
 */
export function payloadEtag(payload: GuestPayload): string {
  return `"${createHash('sha256').update(JSON.stringify(payload)).digest('base64url').slice(0, 27)}"`
}
