import { NextResponse } from 'next/server'
import { readLimitedText } from 'suite-kit/web'
import { prisma } from '../../lib/prisma'
import { endRsvpSessions } from '../../lib/guest/session'
import { linkedTo, rsvpSecret, timelineOrigin, verifyMessage } from '../../lib/rsvp/token'

/**
 * Webhook von rsvp-app (docs/KONZEPT.md Abschnitt 8): "diese Zusage hat sich geändert" - Body ist die signierte
 * Nachricht selbst (text/plain, typ rsvp-change), wie bei Seating. Ungültige Signatur, falscher Empfänger,
 * abgelaufen: 401. Gültig, aber für kein so verknüpftes Event: 200 ohne Wirkung - ob es das Event gibt, erfährt
 * der Absender nicht.
 *
 * Wirkung: attending false (Absage, Warteliste, gelöscht) beendet die Gast-Sitzungen dieser Zusage
 * (endRsvpSessions). Eine Zusage legt hier nichts an - Zugang gibt es nur über einen frischen Link.
 */

const MAX_BODY = 5_000

export async function POST(request: Request) {
  const secret = rsvpSecret()
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 404 })
  // Begrenzt schon beim Lesen - `(await request.text()).slice(...)` hätte den ganzen Body erst in den Speicher geholt.
  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ error: 'too large' }, { status: 413 })

  const message = verifyMessage(body, 'rsvp-change', { secret, audience: timelineOrigin() })
  if (!message) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  if (!message.attending) {
    const event = await prisma.event.findUnique({ where: { id: message.timelineEventId }, select: { id: true, rsvpLink: true } })
    if (event && linkedTo(event, message)) await endRsvpSessions(event.id, message.rsvpId, message.iat)
  }
  return NextResponse.json({ ok: true })
}
