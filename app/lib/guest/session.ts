// app/lib/guest/session.ts
import { cookies } from 'next/headers'
import type { GuestAccess } from '@prisma/client'
import { prisma } from '../prisma'
import { cookieOptions, generateToken, hashToken } from '../auth'
import { autoEndAt } from '../schedule'
import { guestSessionExpiresAt, sessionMatchesAccess } from './access'

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Gast-Sitzung nach Zugangscode (docs/KONZEPT.md Abschnitt 6): Das Cookie trägt nur einen zufälligen Token, in
 * der Datenbank liegt ausschließlich sein SHA-256-Hash (wie bei Konto-Sitzungen, app/lib/auth.ts).
 *
 * Ein Cookie PRO EVENT (`__Host-guest-<eventId>`) statt eines gemeinsamen `__Host-guest`: So bleibt der Zugang
 * zum Polterabend bestehen, wenn dieselbe Person danach den Code der Hochzeit eingibt (Reihe). Das Präfix
 * `__Host-` erzwingt Secure, Path=/ und kein Domain-Attribut - keine andere Subdomain der Suite kann das Cookie
 * setzen (siehe SESSION_COOKIE). In der Entwicklung über http://localhost ohne Präfix.
 */
export function guestCookieName(eventId: string): string {
  return `${isProduction ? '__Host-' : ''}guest-${eventId}`
}

/** Gültige Gast-Sitzung dieses Browsers für das Event - passend zum aktuellen Zugang (sessionMatchesAccess). */
export async function hasGuestSession(event: { id: string; access: GuestAccess }, now: Date): Promise<boolean> {
  if (event.access !== 'CODE' && event.access !== 'RSVP') return false
  const token = (await cookies()).get(guestCookieName(event.id))?.value
  if (!token || token.length > 100) return false
  const session = await prisma.guestSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { eventId: true, rsvpId: true, expiresAt: true }
  })
  return session !== null && session.eventId === event.id && session.expiresAt > now && sessionMatchesAccess(event.access, session)
}

/**
 * Legt nach richtigem Zugangscode (rsvpId null) bzw. gültigem Link aus rsvp-app (rsvpId = die Zusage) eine
 * Gast-Sitzung an. Eine vorhandene Sitzung dieses Browsers fürs Event wird verworfen (keine Session-Fixation),
 * abgelaufene gleich mit aufgeräumt. Gültig bis Eventende + 1 Tag. Gibt Cookie-Name, Token und Laufzeit zurück -
 * setzen muss es der Aufrufer (Server Action: startGuestSession, Route Handler: an seiner Antwort).
 */
export async function issueGuestSession(event: { id: string; date: Date }, now: Date, rsvpId: string | null = null) {
  const name = guestCookieName(event.id)
  const previous = (await cookies()).get(name)?.value
  if (previous) await prisma.guestSession.deleteMany({ where: { tokenHash: hashToken(previous) } })
  await prisma.guestSession.deleteMany({ where: { expiresAt: { lt: now } } })

  const items = await prisma.item.findMany({
    where: { eventId: event.id },
    select: { id: true, trackId: true, sortOrder: true, plannedStart: true, plannedDurationMin: true, isAnchor: true, mayStartEarly: true, status: true, actualStart: true, actualEnd: true, reportedDelayMin: true }
  })
  const expiresAt = guestSessionExpiresAt(autoEndAt(items.map(item => ({ ...item, waitsFor: [] })), event.date), now)

  const token = generateToken()
  await prisma.guestSession.create({ data: { eventId: event.id, tokenHash: hashToken(token), rsvpId, expiresAt } })
  return { name, token, options: cookieOptions(Math.floor((expiresAt.getTime() - now.getTime()) / 1000)) }
}

/** Für Server Actions (Zugangscode): Sitzung anlegen UND das Cookie setzen. */
export async function startGuestSession(event: { id: string; date: Date }, now: Date): Promise<void> {
  const { name, token, options } = await issueGuestSession(event, now)
  ;(await cookies()).set(name, token, options)
}

/**
 * Absage in rsvp-app (Webhook rsvp-change mit attending false): beendet die Gast-Sitzungen dieser Zusage - nur
 * die, die vor der Meldung entstanden sind. Eine verspätet zugestellte alte Absage beendet so keinen Zugang, den
 * die Person nach einer erneuten Zusage über einen frischen Link bekommen hat. iat hat nur Sekunden - im Zweifel
 * (dieselbe Sekunde) wird beendet.
 */
export async function endRsvpSessions(eventId: string, rsvpId: string, iat: number): Promise<number> {
  const deleted = await prisma.guestSession.deleteMany({ where: { eventId, rsvpId, createdAt: { lt: new Date((iat + 1) * 1000) } } })
  return deleted.count
}
