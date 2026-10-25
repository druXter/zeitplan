import { NextResponse } from 'next/server'
import { LINKED_CREATE, verifyLinkedCreate } from 'suite-kit'
import { readLimitedText } from 'suite-kit/web'
import { checkLinkedCreate, performLinkedCreate } from '../../lib/rsvp/create'
import { rsvpSecret, timelineOrigin } from '../../lib/rsvp/token'

/**
 * rsvp-app legt hier ein verknüpftes Event an bzw. fragt, ob das geht (Idee Q1, app/lib/rsvp/create.ts). Body ist
 * die signierte Nachricht (text/plain, suite-kit linked-create). Ungültig: 401, nicht eingerichtet: 404, sonst 200
 * mit dem Ergebnis.
 */

const MAX_BODY = 5_000

export async function POST(request: Request) {
  const secret = rsvpSecret()
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 404 })
  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return NextResponse.json({ error: 'too large' }, { status: 413 })

  const message = verifyLinkedCreate(body, { audience: timelineOrigin(), secret })
  if (!message) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  const result = message.kind === LINKED_CREATE
    ? await performLinkedCreate(message.request, message.title, message.startsAt)
    : await checkLinkedCreate(message.request)
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } })
}
