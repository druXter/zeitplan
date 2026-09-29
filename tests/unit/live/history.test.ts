import { describe, expect, it } from 'vitest'
import {
  describeAction, isUndoable, parseState, recordTitle, sameSnapshot, snapshotOf, unchangedSince, type ItemRecord
} from '../../../app/lib/live/history'

// Verlauf und Rückgängig (docs/KONZEPT.md Abschnitt 3): Rückgängig nur, solange die Punkte genau so sind wie
// nach der Aktion; Beschreibungen verraten geheime Titel nur Eingetragenen.

const row = {
  trackId: 't', sortOrder: 1, plannedStart: new Date('2026-06-20T12:00:00Z'), status: 'RUNNING' as const,
  actualStart: new Date('2026-06-20T12:05:00Z'), actualEnd: null, reportedDelayMin: null, reportedAt: null, cancelReason: null
}

describe('Momentaufnahmen', () => {
  it('als JSON-taugliche Werte, Vergleich aller Live-Felder', () => {
    const a: ItemRecord = snapshotOf(row)
    expect(a).toEqual({
      trackId: 't', sortOrder: 1, plannedStart: '2026-06-20T12:00:00.000Z', status: 'RUNNING', actualStart: '2026-06-20T12:05:00.000Z',
      actualEnd: null, reportedDelayMin: null, reportedAt: null, cancelReason: null
    })
    expect(sameSnapshot(a, JSON.parse(JSON.stringify(a)))).toBe(true)
    for (const change of [{ sortOrder: 2 }, { status: 'DONE' as const }, { actualEnd: 'x' }, { reportedDelayMin: 5 }, { plannedStart: 'y' }, { cancelReason: 'z' }]) {
      expect(sameSnapshot(a, { ...a, ...change }), JSON.stringify(change)).toBe(false)
    }
    // Inhalt zählt nicht, nur der Live-Stand.
    expect(sameSnapshot(a, { ...a, content: undefined })).toBe(true)
    expect(sameSnapshot(null, undefined)).toBe(true)
    expect(sameSnapshot(a, null)).toBe(false)
  })

  it('unchangedSince: alle Punkte wie nach der Aktion, gelöschte bleiben gelöscht', () => {
    const a = snapshotOf(row)
    expect(unchangedSince({ items: { x: a, y: null } }, { x: { ...a }, y: null })).toBe(true)
    expect(unchangedSince({ items: { x: a, y: null } }, { x: { ...a }, y: a })).toBe(false)
    expect(unchangedSince({ items: { x: a } }, { x: { ...a, status: 'DONE' } })).toBe(false)
  })

  it('parseState lehnt Kaputtes ab', () => {
    expect(parseState(null)).toBeNull()
    expect(parseState({})).toBeNull()
    expect(parseState({ items: [] })).toBeNull()
    expect(parseState({ items: {} })).toEqual({ items: {} })
  })
})

describe('Beschreibung und Rückgängig', () => {
  const title = (id: string | null) => ({ a: 'Trauung', b: 'Sektempfang' } as Record<string, string>)[id ?? ''] ?? '?'
  it('beschreibt Aktionen mit den Titeln, die das Konto sehen darf', () => {
    expect(describeAction('advance', { items: {}, meta: { ids: ['a', 'b'] } }, title)).toBe('„Trauung“ beendet, „Sektempfang“ gestartet')
    expect(describeAction('advance', { items: {}, meta: { ids: [null, 'a'] } }, title)).toBe('„Trauung“ gestartet')
    expect(describeAction('end', { items: {}, meta: { ids: ['a'], minutesAgo: 10 } }, title)).toBe('„Trauung“ beendet (vor 10 Min)')
    expect(describeAction('delay', { items: {}, meta: { ids: ['b'], delayMin: 15 } }, title)).toBe('Verspätung „Sektempfang“: +15 Min')
    expect(describeAction('swap', { items: {}, meta: { ids: ['a', 'b'] } }, title)).toBe('„Trauung“ und „Sektempfang“ getauscht')
    expect(describeAction('endevent', { items: {}, meta: { ids: [], auto: true } }, title)).toBe('Event automatisch beendet')
  })

  it('Live schalten und Beenden sind nicht rückgängig zu machen', () => {
    expect(['advance', 'swap', 'insert', 'remove'].every(isUndoable)).toBe(true)
    expect(['golive', 'endevent', 'unbekannt'].some(isUndoable)).toBe(false)
  })

  it('Titel entfernter geheimer Punkte nur für Eingetragene', () => {
    const record: ItemRecord = {
      ...snapshotOf(row),
      content: {
        title: 'Flashmob', location: null, description: null, internalNote: null, visibility: 'SECRET', isAnchor: false, mayStartEarly: false,
        plannedDurationMin: 10, insertedLive: true, originalStart: null, originalDurationMin: null, originalSortOrder: null,
        waitsFor: [], waitedOnBy: [], secretViewerIds: ['u1'], createdAt: '2026-06-01T00:00:00.000Z'
      }
    }
    expect(recordTitle(record, 'u1')).toBe('Flashmob')
    expect(recordTitle(record, 'u2')).toBe('Geheimer Punkt')
    expect(recordTitle({ ...record, content: { ...record.content!, visibility: 'TEAM' } }, 'u2')).toBe('Flashmob')
    expect(recordTitle(snapshotOf(row), 'u1')).toBeNull()
  })
})
