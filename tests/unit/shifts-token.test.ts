import { describe, expect, it } from 'vitest'
import { createForecastResponse, linkedShiftsEventId, openShiftsMessage, verifyForecastRequest } from '../../app/lib/shifts/token'

// Vertrag mit Schichten (app/lib/shifts/token.ts, Gegenstück dort app/lib/timeline/token.ts). REQUEST hat Schichten
// mit genau diesen Werten erzeugt; die Antwort unten prüft Schichten als feste Nachricht in tests/unit/timeline-token.test.ts.
const secret = 'test-timeline-shifts-secret-0123456789ab'
const now = new Date('2026-12-05T18:00:00Z')
const REQUEST =
  'eyJ0eXAiOiJmb3JlY2FzdC1yZXF1ZXN0IiwiYXVkIjoiaHR0cHM6Ly96ZWl0cGxhbi5leGFtcGxlLnRlc3QiLCJzaGlmdHNFdmVudElkIjoiY21zaGlmdHNldmVudDAwMDAxIiwidGltZWxpbmVFdmVudElkIjoiY210aW1lbGluZWV2ZW50MDAwMSIsImlhdCI6MTc5NjQ5MzYwMCwiZXhwIjoxNzk2NDk0MjAwfQ.hdr3YXobFVBMyAinbiwOukOqlsvJL3chUOrw90blW00'

describe('Vertrag mit Schichten', () => {
  it('liest die Anfrage, wie Schichten sie stellt', () => {
    expect(verifyForecastRequest(REQUEST, { secret, audience: 'https://zeitplan.example.test', now })).toEqual({ shiftsEventId: 'cmshiftsevent00001', timelineEventId: 'cmtimelineevent0001' })
    expect(verifyForecastRequest(REQUEST, { secret, audience: 'https://anderes.example.test', now })).toBeNull()
    expect(verifyForecastRequest(REQUEST, { secret: 'x'.repeat(40), audience: 'https://zeitplan.example.test', now })).toBeNull()
    expect(verifyForecastRequest(REQUEST, { secret, audience: 'https://zeitplan.example.test', now: new Date('2026-12-05T19:00:00Z') })).toBeNull()
  })

  it('Antwort: Format und Schlüsselreihenfolge', () => {
    const token = createForecastResponse({ aud: 'https://schichten.example.test', shiftsEventId: 'cmshiftsevent00001', timelineEventId: 'cmtimelineevent0001', items: [] }, secret, now)
    expect(Object.keys(openShiftsMessage(token, secret)!)).toEqual(['typ', 'aud', 'shiftsEventId', 'timelineEventId', 'items', 'iat', 'exp'])
  })

  it('shiftsLink nur mit gültiger id', () => {
    expect(linkedShiftsEventId({ shiftsEventId: 'cmshiftsevent00001' })).toBe('cmshiftsevent00001')
    expect(linkedShiftsEventId({ shiftsEventId: '../x' })).toBeNull()
  })
})
