import type { EventStatus, GuestAccess } from '@prisma/client'

/**
 * Wer sieht die Gästeansicht /<slug>, die Tafel /<slug>/tafel und den Polling-Endpunkt /api/view/<slug>?
 *
 * - public:    jede*r mit Link - veröffentlicht, live oder beendet (Rückblick) und Zugang PUBLIC.
 * - guest:     wie public, aber für ein geschütztes Event mit gültigem Zugang (guestAccess): Gast-Sitzung nach
 *              Zugangscode bzw. Link aus rsvp-app, bei Zugang ACCOUNT jedes angemeldete Konto, auf Tafel und
 *              Endpunkt auch ein gültiger Tafel-Link.
 * - preview:   nur für Konten mit Zugriff aufs Event, mit Hinweis - Entwürfe, Archiv und geschützte Events.
 * - protected: veröffentlicht, aber mit Zugang CODE/ACCOUNT/RSVP und ohne gültigen Zugang: KEIN Inhalt (auch
 *              nicht über den Polling-Endpunkt), nur der Weg hinein.
 * - hidden:    wie "gibt es nicht" (404) - Entwürfe und Archiv ohne Zugriff.
 *
 * Rein, damit die Regel ohne Datenbank testbar bleibt. Konto, Gast-Sitzung und Tafel-Link prüft der Aufrufer
 * (app/lib/guest/store.ts) nur, wenn needsAccountCheck es verlangt - öffentliche Aufrufe lesen so gar keine
 * Cookies.
 */
export type GuestVisibility = 'public' | 'guest' | 'preview' | 'protected' | 'hidden'

export const GUEST_VISIBLE_STATUSES: readonly EventStatus[] = ['PUBLISHED', 'LIVE', 'ENDED']

export function isGuestVisibleStatus(status: EventStatus): boolean {
  return GUEST_VISIBLE_STATUSES.includes(status)
}

export function needsAccountCheck(event: { status: EventStatus; access: GuestAccess }): boolean {
  return !isGuestVisibleStatus(event.status) || event.access !== 'PUBLIC'
}

/** accountAccess: Konto mit Zugriff aufs Event (Vorschau). guestAccess: gültiger Zugang als Gast (siehe oben). */
export type GuestCredentials = { accountAccess: boolean; guestAccess: boolean }

export function guestVisibility(event: { status: EventStatus; access: GuestAccess }, credentials: GuestCredentials): GuestVisibility {
  if (!needsAccountCheck(event)) return 'public'
  if (credentials.accountAccess) return 'preview'
  if (!isGuestVisibleStatus(event.status)) return 'hidden'
  return credentials.guestAccess ? 'guest' : 'protected'
}

/**
 * Gilt eine Gast-Sitzung für den aktuellen Zugang des Events? Sitzungen nach Zugangscode (ohne rsvpId) nur bei
 * CODE, Sitzungen aus rsvp-app (mit rsvpId, app/rsvp/[eventId]/route.ts) nur bei RSVP - wechselt der Zugang, gilt
 * keine alte Sitzung mehr, auch wenn sie noch in der Datenbank steht.
 */
export function sessionMatchesAccess(access: GuestAccess, session: { rsvpId: string | null }): boolean {
  if (access === 'CODE') return session.rsvpId === null
  if (access === 'RSVP') return session.rsvpId !== null
  return false
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Gast-Sitzungen gelten bis Eventende + 1 Tag (docs/KONZEPT.md Abschnitt 6). eventEnd: autoEndAt aus dem
 * Prognose-Kern (letzter Punkt plus Spielraum, ohne Punkte zwei Tage nach dem Eventtag). Wer den Rückblick nach
 * dem Ende öffnet, bekommt noch einen Tag ab jetzt.
 */
export function guestSessionExpiresAt(eventEnd: Date, now: Date): Date {
  return new Date(Math.max(eventEnd.getTime(), now.getTime()) + DAY_MS)
}
