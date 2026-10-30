import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { decisionNames, describeProtocolEntry, readProtocol } from '../../../app/lib/rsvp/protocol'
import { signMessage } from '../../../app/lib/rsvp/token'

// Protokoll aus rsvp-app (Idee L7): signierte Antwort, nur für genau diese Verknüpfung, geheime Abstimmungen ohne Namen.

const SECRET = 'r'.repeat(32)
const AUD = 'https://zeitplan.example.de'
const NOW = new Date('2026-06-20T18:00:00Z')
const ids = { timelineEventId: 'zeitplanevent0001', rsvpEventId: 'rsvpevent00000001' }
const iat = Math.floor(NOW.getTime() / 1000)
const decision = {
  title: 'Antrag 1', secret: false, openedAt: '2026-06-20T17:40:00Z', closedAt: '2026-06-20T17:45:00Z', voters: 3, present: 4, quorumMet: true,
  options: [{ label: 'Ja', votes: 2, names: ['Anna', 'Ben'] }, { label: 'Nein', votes: 1, names: ['Cem'] }]
}
const message = (overrides: object = {}, secret = SECRET) => signMessage({
  typ: 'protocol', aud: AUD, ...ids, presence: [{ at: '2026-06-20T17:50:00Z', name: 'Dora', change: 'OUT' }, { at: '2026-06-20T17:30:00Z', name: 'Dora', change: 'IN' }],
  decisions: [decision], decisionsState: 'ok', iat, exp: iat + 300, ...overrides
}, secret)
const read = (token: string) => readProtocol(token, ids, SECRET, NOW)

beforeAll(() => { vi.stubEnv('BASE_URL', AUD) })
afterAll(() => { vi.unstubAllEnvs() })

describe('readProtocol', () => {
  it('gültige Antwort: Einträge zeitlich sortiert, Beschluss zum Zeitpunkt des Schließens', () => {
    const protocol = read(message())
    expect(protocol).toMatchObject({ state: 'ok', presence: true, decisions: 'ok' })
    if (protocol?.state !== 'ok') throw new Error('erwartet ok')
    expect(protocol.entries.map(e => [e.kind, e.at.toISOString()])).toEqual([
      ['presence', '2026-06-20T17:30:00.000Z'], ['decision', '2026-06-20T17:45:00.000Z'], ['presence', '2026-06-20T17:50:00.000Z']
    ])
    expect(describeProtocolEntry(protocol.entries[1])).toBe('Beschluss „Antrag 1“: Ja 2 · Nein 1 (3 abgestimmt · 4 anwesend · beschlussfähig · namentlich)')
    expect(decisionNames(protocol.entries[1])).toBe('Ja: Anna, Ben; Nein: Cem')
    expect(describeProtocolEntry(protocol.entries[2])).toBe('Dora geht')
  })

  it('Ergebnis nach der Mehrheitsregel (L33) kommt ans Ende der Zeile; zu lang: ungültig', () => {
    const protocol = read(message({ decisions: [{ ...decision, verdict: 'angenommen (einfache Mehrheit: 2 Ja, 1 Nein)' }] }))
    if (protocol?.state !== 'ok') throw new Error('erwartet ok')
    expect(describeProtocolEntry(protocol.entries[1])).toBe('Beschluss „Antrag 1“: Ja 2 · Nein 1 (3 abgestimmt · 4 anwesend · beschlussfähig · namentlich) – angenommen (einfache Mehrheit: 2 Ja, 1 Nein)')
    expect(read(message({ decisions: [{ ...decision, verdict: 'x'.repeat(301) }] }))).toBeNull()
  })

  it('geheime Abstimmung: Namen werden verworfen, auch wenn sie mitkämen', () => {
    const protocol = read(message({ decisions: [{ ...decision, secret: true }] }))
    if (protocol?.state !== 'ok') throw new Error('erwartet ok')
    const entry = protocol.entries.find(e => e.kind === 'decision')!
    expect(JSON.stringify(entry)).not.toContain('Anna')
    expect(decisionNames(entry)).toBe('')
  })

  it('nichts freigegeben: off', () => {
    expect(read(message({ presence: null, decisions: null, decisionsState: 'off' }))).toEqual({ state: 'off' })
  })

  it('falsches Secret, Empfänger, Verknüpfung, Alter oder Inhalt: null', () => {
    expect(read(message({}, 's'.repeat(32)))).toBeNull()
    expect(read(message({ aud: 'https://anderes.example' }))).toBeNull()
    expect(read(message({ timelineEventId: 'anderesevent00001' }))).toBeNull()
    expect(read(message({ rsvpEventId: 'anderesevent00001' }))).toBeNull()
    expect(read(message({ exp: iat - 1 }))).toBeNull()
    expect(read(message({ exp: iat + 2 * 60 * 60 }))).toBeNull()
    expect(read(message({ typ: 'rsvp-change' }))).toBeNull()
    expect(read(message({ presence: [{ at: 'gestern', name: 'Dora', change: 'IN' }] }))).toBeNull()
    expect(read(message({ decisions: [{ ...decision, voters: -1 }] }))).toBeNull()
  })
})
