// app/lib/shifts/token.ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import { baseUrl } from '../base-url'

/**
 * Vertrag zwischen Zeitplan und Schichten (Schichten docs/KONZEPT.md Abschnitt 9, Gegenstück dort
 * app/lib/timeline/token.ts). Format wie die übrigen Verträge der Suite, mit EIGENEM Secret (hier SHIFTS_SECRET, in
 * Schichten TIMELINE_SHIFTS_SECRET):
 *
 *   base64url(JSON-Payload) "." base64url(HMAC-SHA256(payloadPart, SHIFTS_SECRET))
 *
 * Schichten ruft ab (POST /api/schichten/forecast, Body = Anfrage), Zeitplan antwortet (Body = Antwort):
 * - forecast-request:  { typ, aud (Origin von Zeitplan), shiftsEventId, timelineEventId, iat, exp }
 * - timeline-forecast: { typ, aud (Origin von Schichten), shiftsEventId, timelineEventId, items, iat, exp } mit
 *   items: [{ itemId, title, track, plannedStart, plannedDurationMin, forecastStart, forecastEnd, status }] - alle
 *   Programmpunkte außer SECRET (auch TEAM: Schichten ist intern), Zeiten als ISO-8601 (UTC).
 *
 * Keine personenbezogenen Daten. Ohne Secret (oder kürzer als 32 Zeichen) oder ohne SHIFTS_BASE_URL ist die
 * Anbindung aus. Prüfungen geben bei jedem Problem null zurück.
 */

export const MAX_TOKEN_AGE_SECONDS = 60 * 60
const CLOCK_SKEW_SECONDS = 60
const MIN_SECRET_LENGTH = 32
export const REMOTE_ID = /^[a-z0-9]{10,40}$/

export function shiftsSecret(): string | null {
  const value = process.env.SHIFTS_SECRET
  return value && value.length >= MIN_SECRET_LENGTH ? value : null
}

export function originOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null
  } catch {
    return null
  }
}

/** Origin von Schichten - Empfänger (aud) der Antworten, einziger erlaubter Origin des Schichten-Links. */
export function shiftsOrigin(): string | null {
  return originOf(process.env.SHIFTS_BASE_URL)
}

export function shiftsConfigured(): boolean {
  return shiftsSecret() !== null && shiftsOrigin() !== null
}

/** Origin von Zeitplan - Empfänger (aud) der Anfragen. */
export function timelineOrigin(): string {
  return originOf(baseUrl()) ?? baseUrl()
}

/** Event.shiftsLink (JSON): id des verknüpften Events in Schichten - oder null. */
export function linkedShiftsEventId(shiftsLink: unknown): string | null {
  if (typeof shiftsLink !== 'object' || shiftsLink === null || Array.isArray(shiftsLink)) return null
  const id = (shiftsLink as Record<string, unknown>).shiftsEventId
  return typeof id === 'string' && REMOTE_ID.test(id) ? id : null
}

/** Schichten-Link (`<SHIFTS_BASE_URL>/zeitplan/<id>`) -> id des Events in Schichten, null bei falschem Origin/Format. */
export function parseShiftsLink(value: string): string | null {
  const origin = shiftsOrigin()
  if (!origin || !value) return null
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }
  if (parsed.origin !== origin || parsed.username || parsed.password) return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  return segments.length === 2 && segments[0] === 'zeitplan' && REMOTE_ID.test(segments[1]) ? segments[1] : null
}

export function shiftsLinkUrl(shiftsEventId: string): string | null {
  const origin = shiftsOrigin()
  return origin ? `${origin}/zeitplan/${shiftsEventId}` : null
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

function sign(payload: object, secret: string): string {
  const payloadPart = base64url(JSON.stringify(payload))
  return `${payloadPart}.${signature(payloadPart, secret)}`
}

export function openShiftsMessage(token: string, secret: string): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length > 100_000) return null
  const parts = token.trim().split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const expected = Buffer.from(signature(parts[0], secret))
  const actual = Buffer.from(parts[1])
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const value: unknown = JSON.parse(fromBase64url(parts[0]).toString('utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

export type ForecastRequest = { shiftsEventId: string; timelineEventId: string }

/** Prüft eine Anfrage von Schichten (Signatur, Art, Empfänger, Gültigkeit, ids) - oder null. */
export function verifyForecastRequest(token: string, options: { secret: string; audience: string; now?: Date }): ForecastRequest | null {
  const raw = openShiftsMessage(token, options.secret)
  if (!raw || raw.typ !== 'forecast-request' || raw.aud !== options.audience) return null
  const { iat, exp, shiftsEventId, timelineEventId } = raw
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000)
  if ((exp as number) <= now || (exp as number) - now > MAX_TOKEN_AGE_SECONDS || (iat as number) > now + CLOCK_SKEW_SECONDS || (iat as number) > (exp as number)) return null
  if (typeof shiftsEventId !== 'string' || !REMOTE_ID.test(shiftsEventId) || typeof timelineEventId !== 'string' || !REMOTE_ID.test(timelineEventId)) return null
  return { shiftsEventId, timelineEventId }
}

export type ForecastItem = {
  itemId: string; title: string; track: string; plannedStart: string; plannedDurationMin: number
  forecastStart: string; forecastEnd: string; status: string
}

/** Signierte Antwort (Schlüsselreihenfolge { typ, ...Felder, iat, exp }, 10 Minuten gültig). */
export function createForecastResponse(
  input: { aud: string; shiftsEventId: string; timelineEventId: string; items: ForecastItem[] }, secret: string, now = new Date()
): string {
  const iat = Math.floor(now.getTime() / 1000)
  return sign({ typ: 'timeline-forecast', ...input, iat, exp: iat + 600 }, secret)
}

/** Anfrage wie Schichten sie stellt - für Tests. */
export function createForecastRequest(input: { aud: string; shiftsEventId: string; timelineEventId: string }, secret: string, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000)
  return sign({ typ: 'forecast-request', ...input, iat, exp: iat + 600 }, secret)
}
