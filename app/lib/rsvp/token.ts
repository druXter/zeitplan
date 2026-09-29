// app/lib/rsvp/token.ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { baseUrl } from '../base-url'

/**
 * Vertrag zwischen Zeitplan und rsvp-app (docs/KONZEPT.md Abschnitt 8, Phase 7b). Format wie die Verträge von
 * rsvp-app mit Seating und dem Abstimmungstool (rsvp-app: app/lib/linked-tools.ts, Seating: app/lib/rsvp/token.ts)
 * - bewusst ohne JWT-Bibliothek, aber mit EIGENEM Secret (hier RSVP_TIMELINE_SECRET, in rsvp-app TIMELINE_SECRET):
 *
 *   base64url(JSON-Payload) "." base64url(HMAC-SHA256(payloadPart, RSVP_TIMELINE_SECRET))
 *
 * Jede Nachricht trägt typ, aud (Origin des Empfängers, hier BASE_URL), iat/exp (Unix-Sekunden, höchstens eine
 * Stunde gültig), timelineEventId und rsvpEventId - die Verknüpfung, die BEIDE Seiten eingetragen haben müssen.
 * Keine Namen, keine E-Mail-Adressen: Das Tool braucht nur "diese Zusage gilt" (rsvpId).
 *
 * Arten (beide nur rsvp-app -> Zeitplan):
 * - timeline-link: über den Browser, frisch erzeugt beim Klick auf "Zeitplan" in rsvp-app -> Gast-Sitzung.
 * - rsvp-change:   Webhook bei jeder Änderung einer Zusage; attending false beendet ihre Gast-Sitzungen.
 *
 * Alle Prüfungen geben bei jedem Problem null zurück: "nicht gültig" ist ein normaler Zustand.
 */

export const MAX_TOKEN_AGE_SECONDS = 60 * 60
const CLOCK_SKEW_SECONDS = 60
const MIN_SECRET_LENGTH = 32
/** Format der ids auf beiden Seiten (cuid) - wie in rsvp-app (REMOTE_ID) und Seating. */
export const REMOTE_ID = /^[a-z0-9]{10,40}$/

/** Eigenes Secret der Anbindung - ohne (oder kürzer als 32 Zeichen) ist der Zugang RSVP aus. */
export function rsvpSecret(): string | null {
  const value = process.env.RSVP_TIMELINE_SECRET
  return value && value.length >= MIN_SECRET_LENGTH ? value : null
}

export function rsvpConfigured(): boolean {
  return rsvpSecret() !== null
}

/** Origin einer Basis-URL, null wenn ungültig. */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Origin von Zeitplan - Empfänger (aud) aller Nachrichten von rsvp-app. */
export function timelineOrigin(): string {
  return originOf(baseUrl()) ?? baseUrl()
}

/** Der Link, den die Besitzer*in des Termins in rsvp-app als "Zeitplan-Link" einträgt. */
export function timelineLinkFor(eventId: string): string {
  return `${timelineOrigin()}/rsvp/${eventId}`
}

/** Event.rsvpLink (JSON): die id des verknüpften Termins in rsvp-app - oder null. */
export function linkedRsvpEventId(rsvpLink: unknown): string | null {
  if (typeof rsvpLink !== 'object' || rsvpLink === null || Array.isArray(rsvpLink)) return null
  const id = (rsvpLink as Record<string, unknown>).rsvpEventId
  return typeof id === 'string' && REMOTE_ID.test(id) ? id : null
}

// --- Format ---------------------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(input: string): Buffer {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function signature(payloadPart: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payloadPart).digest())
}

export function signMessage(payload: object, secret: string): string {
  const payloadPart = base64url(JSON.stringify(payload))
  return `${payloadPart}.${signature(payloadPart, secret)}`
}

/** Signatur prüfen (konstante Laufzeit) und die Nutzlast lesen - ohne inhaltliche Prüfung. */
export function openMessage(token: string, secret: string): unknown {
  if (typeof token !== 'string' || token.length > 10_000) return null
  const parts = token.trim().split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const expected = Buffer.from(signature(parts[0], secret))
  const actual = Buffer.from(parts[1])
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    return JSON.parse(fromBase64url(parts[0]).toString('utf8'))
  } catch {
    return null
  }
}

// --- Inhalte --------------------------------------------------------------------------------------

const envelope = {
  aud: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  timelineEventId: z.string().regex(REMOTE_ID),
  rsvpEventId: z.string().regex(REMOTE_ID),
  rsvpId: z.string().regex(REMOTE_ID)
}

const SCHEMAS = {
  'timeline-link': z.object({ typ: z.literal('timeline-link'), ...envelope }),
  'rsvp-change': z.object({ typ: z.literal('rsvp-change'), ...envelope, attending: z.boolean() })
}

export type MessageType = keyof typeof SCHEMAS
export type Message<T extends MessageType> = z.infer<(typeof SCHEMAS)[T]>

/** Prüft Signatur, Art, Empfänger und Gültigkeit einer Nachricht und gibt ihren Inhalt zurück - oder null. */
export function verifyMessage<T extends MessageType>(
  token: string, type: T, options: { secret: string; audience: string; now?: Date }
): Message<T> | null {
  const parsed = SCHEMAS[type].safeParse(openMessage(token, options.secret))
  if (!parsed.success) return null
  const message = parsed.data as Message<T>
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000)
  if (message.aud !== options.audience) return null
  if (message.exp <= now || message.exp - now > MAX_TOKEN_AGE_SECONDS) return null
  if (message.iat > now + CLOCK_SKEW_SECONDS || message.iat > message.exp) return null
  return message
}

/**
 * Signiert eine Nachricht wie rsvp-app (createSignedMessage: `{ typ, ...fields, iat, exp }`, Standard 10 Minuten).
 * Zeitplan selbst verschickt nichts - das brauchen Unit-Tests und das Test-Doppel von rsvp-app.
 */
export function createMessage<T extends MessageType>(
  type: T, content: Omit<Message<T>, 'typ' | 'iat' | 'exp'>, secret: string, options: { now?: Date; ttlSeconds?: number } = {}
): string {
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000)
  return signMessage({ typ: type, ...content, iat, exp: iat + (options.ttlSeconds ?? 600) }, secret)
}

/** Stimmt die Nachricht mit der Verknüpfung dieses Events überein (beide Seiten haben die andere id eingetragen)? */
export function linkedTo(event: { id: string; rsvpLink: unknown }, message: { timelineEventId: string; rsvpEventId: string }): boolean {
  const rsvpEventId = linkedRsvpEventId(event.rsvpLink)
  return rsvpEventId !== null && message.timelineEventId === event.id && message.rsvpEventId === rsvpEventId
}
