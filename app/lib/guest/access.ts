import type { EventStatus, GuestAccess } from '@prisma/client'

/**
 * Wer sieht die Gästeansicht /<slug>, die Tafel /<slug>/tafel und den Polling-Endpunkt /api/view/<slug>?
 *
 * - public:    jede*r mit Link - veröffentlicht, live oder beendet (Rückblick) und Zugang PUBLIC.
 * - preview:   nur für Konten mit Zugriff aufs Event, mit Hinweis - Entwürfe, Archiv und geschützte Events.
 * - protected: veröffentlicht, aber mit Zugang CODE/ACCOUNT/RSVP und ohne Konto: KEIN Inhalt (auch nicht über
 *              den Polling-Endpunkt). Den Weg hinein (Code, Gast-Sitzung, rsvp-Link) bringen Phase 5 und 7b.
 * - hidden:    wie "gibt es nicht" (404) - Entwürfe und Archiv ohne Zugriff.
 *
 * Rein, damit die Regel ohne Datenbank testbar bleibt. Ob ein Konto Zugriff hat, fragt der Aufrufer nur, wenn
 * needsAccountCheck es verlangt - öffentliche Aufrufe lesen so gar keine Cookies.
 */
export type GuestVisibility = 'public' | 'preview' | 'protected' | 'hidden'

export const GUEST_VISIBLE_STATUSES: readonly EventStatus[] = ['PUBLISHED', 'LIVE', 'ENDED']

export function isGuestVisibleStatus(status: EventStatus): boolean {
  return GUEST_VISIBLE_STATUSES.includes(status)
}

export function needsAccountCheck(event: { status: EventStatus; access: GuestAccess }): boolean {
  return !isGuestVisibleStatus(event.status) || event.access !== 'PUBLIC'
}

export function guestVisibility(event: { status: EventStatus; access: GuestAccess }, hasAccountAccess: boolean): GuestVisibility {
  if (!needsAccountCheck(event)) return 'public'
  if (hasAccountAccess) return 'preview'
  return isGuestVisibleStatus(event.status) ? 'protected' : 'hidden'
}
