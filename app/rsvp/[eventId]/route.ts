// app/rsvp/[eventId]/route.ts
import type { NextRequest } from 'next/server'
import { prisma } from '../../lib/prisma'
import { isGuestVisibleStatus } from '../../lib/guest/access'
import { issueGuestSession } from '../../lib/guest/session'
import { linkedTo, REMOTE_ID, rsvpSecret, timelineOrigin, verifyMessage } from '../../lib/rsvp/token'
import { redirectResponse } from '../../lib/suite-flow'

export const dynamic = 'force-dynamic'

/**
 * Einstieg aus rsvp-app (docs/KONZEPT.md Abschnitt 8): /rsvp/<eventId>?t=<signierter Link>. rsvp-app erzeugt den
 * Link bei jedem Klick auf "Zeitplan" frisch (typ timeline-link, kurz gültig) und leitet hierher weiter.
 *
 * Geprüft wird alles, bevor etwas entsteht: Signatur mit dem eigenen Secret, Art, Empfänger (aud = dieses Tool),
 * Gültigkeit, dieselbe Event-id wie in der Adresse und die Verknüpfung, die BEIDE Seiten eingetragen haben
 * (Event.rsvpLink). Erst dann entsteht eine Gast-Sitzung mit rsvpId - sonst ändert ein Aufruf nichts. Ist der
 * Link echt, das Event aber gerade nicht auf Zugang RSVP gestellt, geht es ohne Sitzung zur Gästeansicht.
 *
 * Ungültige Links sehen alle gleich aus (/rsvp?ungueltig=1) - ob es das Event gibt, verrät die Antwort nicht.
 * Antworten mit no-store und no-referrer (redirectResponse), die Seite selbst per next.config.ts ebenso.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const tokens = request.nextUrl.searchParams.getAll('t')
  const invalid = () => redirectResponse('/rsvp?ungueltig=1', request.nextUrl.origin)

  const secret = rsvpSecret()
  if (!secret || !REMOTE_ID.test(eventId) || tokens.length !== 1) return invalid()
  const message = verifyMessage(tokens[0], 'timeline-link', { secret, audience: timelineOrigin() })
  if (!message || message.timelineEventId !== eventId) return invalid()

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, slug: true, date: true, status: true, access: true, rsvpLink: true } })
  if (!event || !linkedTo(event, message) || !isGuestVisibleStatus(event.status)) return invalid()
  if (event.access !== 'RSVP') return redirectResponse(`/${event.slug}`, request.nextUrl.origin)

  const session = await issueGuestSession(event, new Date(), message.rsvpId)
  const response = redirectResponse(`/${event.slug}`, request.nextUrl.origin)
  response.cookies.set(session.name, session.token, session.options)
  return response
}
