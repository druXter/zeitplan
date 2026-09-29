import { NextResponse } from 'next/server'
import { loadGuestPayload, payloadEtag, resolveGuestEvent } from '../../../lib/guest/store'

/**
 * Polling-Endpunkt der Gästeansicht und der Tafel (docs/KONZEPT.md Abschnitt 5): derselbe Inhalt wie im ersten
 * HTML, nur als JSON. Mit If-None-Match antwortet er 304, solange sich für Gäste nichts geändert hat.
 *
 * Dieselbe Sichtbarkeit wie die Seiten (resolveGuestEvent): Entwürfe, Archiv und Unbekanntes 404, geschützte
 * Events ohne Konto 403 - jeweils ohne Inhalt. `no-store`: Nichts landet in Browser- oder Proxy-Caches (auch
 * keine Vorschau eines Entwurfs); die Seite merkt sich den ETag selbst und schickt ihn mit.
 */
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow'
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const resolved = await resolveGuestEvent((await params).slug)
  if (!resolved) return NextResponse.json({ error: 'not-found' }, { status: 404, headers: HEADERS })
  if (resolved.visibility === 'protected') return NextResponse.json({ error: 'protected' }, { status: 403, headers: HEADERS })

  const payload = await loadGuestPayload(resolved.event, new Date())
  const etag = payloadEtag(payload)
  const headers = { ...HEADERS, ETag: etag }
  const match = request.headers.get('if-none-match')
  if (match && match.split(',').some(value => value.trim() === etag)) return new NextResponse(null, { status: 304, headers })
  return NextResponse.json(payload, { headers })
}
