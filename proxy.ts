import { NextResponse } from 'next/server'

/**
 * Live-Steuerung in der Sitzungsleitung des Abstimmungstools (Idee L7, abstimmungstool docs/KONZEPT-SITZUNG.md): Die
 * Seite /admin/events/<id>/live darf in einem iFrame der Seiten aus LIVE_EMBED_ORIGINS erscheinen - sonst nirgends.
 * Hier statt in next.config.ts, weil die .env erst zur Laufzeit vorliegt (die Header dort stehen nach dem Build fest);
 * next.config.ts lässt den Pfad deshalb aus.
 *
 * LIVE_EMBED_ORIGINS: durch Leerzeichen oder Komma getrennt, z.B. "https://vote.ramonroeser.de". Nur Einträge der Form
 * http(s)://host[:port] ohne Platzhalter - alles andere fällt weg, damit ein Tippfehler die CSP nicht aushebelt. Ohne
 * Einträge gilt wie überall "frame-ancestors 'none'" und X-Frame-Options DENY.
 *
 * Eingebettet funktioniert die Seite nur mit Anmeldung, weil alle Tools unter derselben Website laufen (Subdomains,
 * Cookie SameSite=Lax). Kopfzeile und Fußzeile blendet app/layout.tsx im iFrame aus.
 */
const SOURCE = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/

function liveEmbedOrigins(raw = process.env.LIVE_EMBED_ORIGINS ?? ''): string[] {
  return [...new Set(raw.split(/[\s,]+/).map(s => s.toLowerCase().replace(/\/$/, '')).filter(s => SOURCE.test(s)))]
}

export function proxy() {
  const response = NextResponse.next()
  const allowed = liveEmbedOrigins()
  if (allowed.length === 0) {
    response.headers.set('Content-Security-Policy', "frame-ancestors 'none'")
    response.headers.set('X-Frame-Options', 'DENY')
  } else {
    response.headers.set('Content-Security-Policy', `frame-ancestors 'self' ${allowed.join(' ')}`)
  }
  return response
}

export const config = {
  matcher: ['/admin/events/:id/live']
}
