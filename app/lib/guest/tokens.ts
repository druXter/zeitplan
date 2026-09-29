// app/lib/guest/tokens.ts
import { createHmac, randomInt } from 'node:crypto'
import { safeEqual } from '../permissions'

/**
 * Zugangscode und Tafel-Link für geschützte Events (docs/KONZEPT.md Abschnitt 6), Aufbau wie
 * app/lib/booking-tokens.ts in Seating:
 *
 * | Token       | Erzeugung                                            | Speicherung                    |
 * | Zugangscode | frei gewählt (oder Vorschlag), mindestens 8 Zeichen  | HMAC(ACCESS_CODE_SECRET, ...)  |
 * | Tafel-Link  | HMAC(DISPLAY_LINK_SECRET, eventId:Version)           | gar nicht (abgeleitet)         |
 *
 * Der Code wird per HMAC gespeichert, nie als reiner Hash: Frei gewählte Codes sind aus einem Datenbank-Abzug
 * sonst per Wörterbuch schnell zurückgerechnet. Er hängt an der Event-id, damit derselbe Code in zwei Events
 * verschiedene Werte ergibt. Der Tafel-Link wird abgeleitet statt gespeichert; displayTokenVersion + 1 macht
 * alle alten Links ungültig.
 *
 * Fehlt ein Secret oder ist es zu kurz, ist die jeweilige Funktion abgeschaltet (accessCodeConfigured,
 * displayLinkConfigured) - es gibt keinen unsicheren Rückfall auf einen Standardwert.
 */

const MIN_SECRET_LENGTH = 32

type SecretName = 'ACCESS_CODE_SECRET' | 'DISPLAY_LINK_SECRET' | 'DISPLAY_LINK_SECRET_PREVIOUS'

function secret(name: SecretName): string | null {
  const value = process.env[name]
  return value && value.length >= MIN_SECRET_LENGTH ? value : null
}

function requireSecret(name: SecretName): string {
  const value = secret(name)
  if (!value) throw new Error(`${name} fehlt oder ist kürzer als ${MIN_SECRET_LENGTH} Zeichen`)
  return value
}

function hmac(key: string, message: string): string {
  return createHmac('sha256', key).update(message).digest('base64url')
}

// --- Zugangscode ----------------------------------------------------------------------------------

export const ACCESS_CODE_MIN_LENGTH = 8
export const ACCESS_CODE_MAX_LENGTH = 40

export function accessCodeConfigured(): boolean {
  return secret('ACCESS_CODE_SECRET') !== null
}

/**
 * Gäste tippen den Code von der Einladung ab: Groß-/Kleinschreibung, Leerzeichen und Bindestriche spielen
 * keine Rolle ("k7qm 4xpa" = "K7QM-4XPA"). NFKC vereinheitlicht Zeichen, die gleich aussehen, aber
 * verschieden kodiert sind (z. B. "ä" als ein oder zwei Zeichen).
 */
export function normalizeAccessCode(input: string): string {
  return input.normalize('NFKC').toUpperCase().replace(/[\s\-‐‑‒–—]+/g, '')
}

/** Fehlermeldung oder null. Erlaubt sind Buchstaben und Ziffern (nach der Normalisierung). */
export function validateAccessCode(input: string): string | null {
  const code = normalizeAccessCode(input)
  if (code.length < ACCESS_CODE_MIN_LENGTH) return `mindestens ${ACCESS_CODE_MIN_LENGTH} Zeichen (ohne Leerzeichen und Bindestriche).`
  if (code.length > ACCESS_CODE_MAX_LENGTH) return `höchstens ${ACCESS_CODE_MAX_LENGTH} Zeichen.`
  if (!/^[\p{L}\p{N}]+$/u.test(code)) return 'nur Buchstaben, Ziffern, Leerzeichen und Bindestriche.'
  return null
}

export function accessCodeHmac(eventId: string, input: string): string {
  return hmac(requireSecret('ACCESS_CODE_SECRET'), `access-code:${eventId}:${normalizeAccessCode(input)}`)
}

/** Vergleicht eine Eingabe mit dem gespeicherten HMAC (konstante Laufzeit). */
export function accessCodeMatches(eventId: string, input: string, stored: string | null): boolean {
  if (!stored || !accessCodeConfigured() || input.length > 200) return false
  return safeEqual(accessCodeHmac(eventId, input), stored)
}

// Ohne leicht verwechselbare Zeichen (0/O, 1/I/L), damit Gäste den Code von einer Karte abtippen können.
const SUGGESTION_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Vorschlag "K7QM-4XPA": 8 Zeichen aus 31, also knapp 40 Bit - zusammen mit der Drosselung nicht zu erraten. */
export function suggestAccessCode(): string {
  const chars = Array.from({ length: 8 }, () => SUGGESTION_ALPHABET[randomInt(SUGGESTION_ALPHABET.length)])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

// --- Tafel-Link -----------------------------------------------------------------------------------

export function displayLinkConfigured(): boolean {
  return secret('DISPLAY_LINK_SECRET') !== null
}

export function displayToken(eventId: string, version: number): string {
  return hmac(requireSecret('DISPLAY_LINK_SECRET'), `display:${eventId}:${version}`)
}

/** Prüft einen Tafel-Link - mit dem aktuellen und (Schlüsselrotation) dem vorherigen Secret. */
export function displayTokenValid(eventId: string, version: number, token: string): boolean {
  if (!token || token.length > 100 || !displayLinkConfigured()) return false
  const keys = [secret('DISPLAY_LINK_SECRET'), secret('DISPLAY_LINK_SECRET_PREVIOUS')].filter((k): k is string => k !== null)
  // Alle Schlüssel prüfen (kein frühes Ende), damit die Laufzeit nicht verrät, welcher passt.
  let valid = false
  for (const key of keys) if (safeEqual(hmac(key, `display:${eventId}:${version}`), token)) valid = true
  return valid
}
