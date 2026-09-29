import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accessCodeConfigured, accessCodeHmac, accessCodeMatches, displayLinkConfigured, displayToken, displayTokenValid,
  normalizeAccessCode, suggestAccessCode, validateAccessCode
} from '../../../app/lib/guest/tokens'

// Zugangscode und Tafel-Link (docs/KONZEPT.md Abschnitt 6, Aufbau wie booking-tokens in Seating).

const SECRET_A = 'a'.repeat(32)
const SECRET_B = 'b'.repeat(40)

beforeEach(() => {
  vi.stubEnv('ACCESS_CODE_SECRET', SECRET_A)
  vi.stubEnv('DISPLAY_LINK_SECRET', SECRET_A)
  vi.stubEnv('DISPLAY_LINK_SECRET_PREVIOUS', '')
})

afterEach(() => vi.unstubAllEnvs())

describe('Zugangscode', () => {
  it('Groß-/Kleinschreibung, Leerzeichen und Bindestriche sind egal', () => {
    expect(normalizeAccessCode(' k7qm - 4xpa ')).toBe('K7QM4XPA')
    expect(normalizeAccessCode('Rosen–Garten 26')).toBe('ROSENGARTEN26')
    const stored = accessCodeHmac('e1', 'K7QM-4XPA')
    for (const input of ['k7qm4xpa', 'K7QM 4XPA', ' k7qm-4xpa ']) expect(accessCodeMatches('e1', input, stored), input).toBe(true)
    expect(accessCodeMatches('e1', 'K7QM-4XPB', stored)).toBe(false)
  })

  it('gespeichert als HMAC, gebunden an Event und Secret - nie der Code selbst', () => {
    const stored = accessCodeHmac('e1', 'Sommerfest-2026')
    expect(stored).not.toContain('SOMMERFEST')
    expect(stored).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // Derselbe Code in einem anderen Event ergibt einen anderen Wert.
    expect(accessCodeHmac('e2', 'Sommerfest-2026')).not.toBe(stored)
    expect(accessCodeMatches('e2', 'Sommerfest-2026', stored)).toBe(false)
    vi.stubEnv('ACCESS_CODE_SECRET', SECRET_B)
    expect(accessCodeMatches('e1', 'Sommerfest-2026', stored)).toBe(false)
  })

  it('ohne (ausreichend langes) Secret: abgeschaltet, kein unsicherer Rückfall', () => {
    const stored = accessCodeHmac('e1', 'Sommerfest-2026')
    for (const value of ['', 'zu-kurz']) {
      vi.stubEnv('ACCESS_CODE_SECRET', value)
      expect(accessCodeConfigured()).toBe(false)
      expect(accessCodeMatches('e1', 'Sommerfest-2026', stored)).toBe(false)
      expect(() => accessCodeHmac('e1', 'Sommerfest-2026')).toThrow()
    }
  })

  it('kein gespeicherter Code oder überlange Eingabe: kein Treffer', () => {
    expect(accessCodeMatches('e1', 'Sommerfest-2026', null)).toBe(false)
    expect(accessCodeMatches('e1', 'x'.repeat(201), accessCodeHmac('e1', 'x'.repeat(201)))).toBe(false)
  })

  it('Prüfung: mindestens 8 Zeichen ohne Trenner, höchstens 40, nur Buchstaben und Ziffern', () => {
    expect(validateAccessCode('K7QM-4XPA')).toBeNull()
    expect(validateAccessCode('Rosengärten2026')).toBeNull()
    expect(validateAccessCode('ab-cd-ef')).toMatch(/mindestens 8/)
    expect(validateAccessCode('x'.repeat(41))).toMatch(/höchstens 40/)
    expect(validateAccessCode('rosen!garten')).toMatch(/nur Buchstaben/)
  })

  it('Vorschlag: 8 Zeichen ohne verwechselbare Zeichen, gültig und jedes Mal anders', () => {
    const suggestions = new Set(Array.from({ length: 50 }, () => suggestAccessCode()))
    expect(suggestions.size).toBe(50)
    for (const code of suggestions) {
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)
      expect(validateAccessCode(code)).toBeNull()
    }
  })
})

describe('Tafel-Link', () => {
  it('gilt nur für Event und Version, aus denen er abgeleitet ist', () => {
    const token = displayToken('e1', 1)
    expect(displayTokenValid('e1', 1, token)).toBe(true)
    // Neu erzeugt (Version + 1): der alte Link gilt nicht mehr.
    expect(displayTokenValid('e1', 2, token)).toBe(false)
    expect(displayTokenValid('e2', 1, token)).toBe(false)
    expect(displayTokenValid('e1', 1, token.slice(0, -1))).toBe(false)
    expect(displayTokenValid('e1', 1, '')).toBe(false)
    expect(displayTokenValid('e1', 1, 'x'.repeat(101))).toBe(false)
  })

  it('Schlüsselwechsel: mit dem vorherigen Secret erzeugte Links gelten weiter, solange es eingetragen ist', () => {
    const old = displayToken('e1', 1)
    vi.stubEnv('DISPLAY_LINK_SECRET', SECRET_B)
    expect(displayTokenValid('e1', 1, old)).toBe(false)
    vi.stubEnv('DISPLAY_LINK_SECRET_PREVIOUS', SECRET_A)
    expect(displayTokenValid('e1', 1, old)).toBe(true)
    expect(displayTokenValid('e1', 1, displayToken('e1', 1))).toBe(true)
  })

  it('ohne Secret: abgeschaltet', () => {
    const token = displayToken('e1', 1)
    vi.stubEnv('DISPLAY_LINK_SECRET', '')
    expect(displayLinkConfigured()).toBe(false)
    expect(displayTokenValid('e1', 1, token)).toBe(false)
    // Auch nicht allein mit dem vorherigen Secret.
    vi.stubEnv('DISPLAY_LINK_SECRET_PREVIOUS', SECRET_A)
    expect(displayTokenValid('e1', 1, token)).toBe(false)
  })
})
