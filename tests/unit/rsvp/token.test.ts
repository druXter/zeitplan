import { describe, expect, it } from 'vitest'
import { createMessage, linkedRsvpEventId, linkedTo, signMessage, verifyMessage } from '../../../app/lib/rsvp/token'

// Vertrag mit rsvp-app (docs/KONZEPT.md Abschnitt 8): Signatur, Art, Empfänger, Gültigkeit, Verknüpfung.

const SECRET = 'r'.repeat(32)
const OTHER = 's'.repeat(32)
const AUD = 'https://zeitplan.example.de'
const NOW = new Date('2026-06-20T12:00:00Z')
const ids = { timelineEventId: 'zeitplanevent0001', rsvpEventId: 'rsvpevent00000001', rsvpId: 'zusage00000000001' }
const link = (overrides: object = {}, options: { secret?: string; now?: Date; ttlSeconds?: number } = {}) =>
  createMessage('timeline-link', { aud: AUD, ...ids, ...overrides }, options.secret ?? SECRET, { now: options.now ?? NOW, ttlSeconds: options.ttlSeconds })
const check = (token: string, now = NOW) => verifyMessage(token, 'timeline-link', { secret: SECRET, audience: AUD, now })

describe('verifyMessage', () => {
  it('gültiger Link aus rsvp-app', () => {
    expect(check(link())).toMatchObject({ typ: 'timeline-link', ...ids })
  })

  it('anderes Secret, andere Art, anderer Empfänger: abgelehnt', () => {
    expect(check(link({}, { secret: OTHER }))).toBeNull()
    const change = createMessage('rsvp-change', { aud: AUD, ...ids, attending: true }, SECRET, { now: NOW })
    expect(check(change)).toBeNull()
    expect(verifyMessage(change, 'rsvp-change', { secret: SECRET, audience: AUD, now: NOW })).toMatchObject({ attending: true })
    expect(check(link({ aud: 'https://anderes-tool.example' }))).toBeNull()
  })

  it('Gültigkeit: abgelaufen, zu lang gültig oder aus der Zukunft abgelehnt', () => {
    expect(check(link(), new Date(NOW.getTime() + 11 * 60_000))).toBeNull()
    expect(check(link({}, { ttlSeconds: 2 * 60 * 60 }))).toBeNull()
    expect(check(link({}, { now: new Date(NOW.getTime() + 5 * 60_000) }))).toBeNull()
    // Positivkontrolle: eine Stunde ist erlaubt, kleine Uhrabweichung auch.
    expect(check(link({}, { ttlSeconds: 60 * 60 }))).not.toBeNull()
    expect(check(link({}, { now: new Date(NOW.getTime() + 30_000) }))).not.toBeNull()
  })

  it('manipulierte Nutzlast, fremde Felder im Format und kaputte Tokens', () => {
    const token = link()
    const [payload, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), rsvpId: 'fremdezusage00001' })).toString('base64url')
    expect(check(`${forged}.${signature}`)).toBeNull()
    expect(check(signMessage({ typ: 'timeline-link', aud: AUD, ...ids, rsvpId: '../x', iat: 1, exp: 2 }, SECRET))).toBeNull()
    for (const broken of ['', 'x', 'a.b.c', `${payload}.`, 'x'.repeat(20_000)]) expect(check(broken), broken.slice(0, 10)).toBeNull()
  })
})

describe('Verknüpfung', () => {
  it('liest die id des Termins aus Event.rsvpLink', () => {
    expect(linkedRsvpEventId({ rsvpEventId: 'rsvpevent00000001' })).toBe('rsvpevent00000001')
    for (const value of [null, undefined, 'rsvpevent00000001', [], {}, { rsvpEventId: 'ZU KURZ' }, { rsvpEventId: 5 }]) {
      expect(linkedRsvpEventId(value), JSON.stringify(value)).toBeNull()
    }
  })

  it('gilt nur, wenn beide ids passen', () => {
    const event = { id: ids.timelineEventId, rsvpLink: { rsvpEventId: ids.rsvpEventId } }
    expect(linkedTo(event, ids)).toBe(true)
    expect(linkedTo({ ...event, id: 'anderesevent00001' }, ids)).toBe(false)
    expect(linkedTo({ ...event, rsvpLink: { rsvpEventId: 'anderertermin0001' } }, ids)).toBe(false)
    expect(linkedTo({ ...event, rsvpLink: null }, ids)).toBe(false)
  })
})
