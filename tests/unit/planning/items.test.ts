import { describe, expect, it } from 'vitest'
import { parseItemForm, redactItem, type StoredItem } from '../../../app/lib/planning/items'
import { zonedDateToUtc, zonedInputToUtc } from '../../../app/lib/timezone'

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value]) data.append(key, entry)
  }
  return data
}

const ctx = {
  eventDate: zonedDateToUtc('2026-06-20')!,
  timezone: 'Europe/Berlin',
  trackIds: ['t1', 't2'],
  itemIds: ['a', 'b'],
  viewerIds: ['u1', 'u2']
}

const valid = { title: ' Trauung ', start: '2026-06-20T14:00', durationMin: '45', trackId: 't1', visibility: 'PUBLIC' }

describe('parseItemForm', () => {
  it('liefert die Felder mit absolutem Beginn', () => {
    const parsed = parseItemForm(form({ ...valid, location: 'Kirche', isAnchor: 'on', waitsFor: ['a', 'a', 'b'] }), ctx)
    expect(parsed).toEqual({
      ok: true,
      fields: {
        title: 'Trauung', location: 'Kirche', description: null, internalNote: null, trackId: 't1',
        plannedStart: zonedInputToUtc('2026-06-20T14:00')!, plannedDurationMin: 45, visibility: 'PUBLIC',
        isAnchor: true, mayStartEarly: false, waitsFor: ['a', 'b'], secretViewerIds: []
      }
    })
  })

  it('nach Mitternacht und in der doppelten Stunde der Zeitumstellung', () => {
    const october = { ...ctx, eventDate: zonedDateToUtc('2026-10-24')! }
    const parsed = parseItemForm(form({ ...valid, start: '2026-10-25T02:30' }), october)
    expect(parsed.ok && parsed.fields.plannedStart.toISOString()).toBe('2026-10-25T01:30:00.000Z')
  })

  it('lehnt fehlende und ungültige Werte ab', () => {
    const parsed = parseItemForm(form({ title: '', start: '2026-06-20T25:00', durationMin: '-5', trackId: 'x', visibility: 'ALL' }), ctx)
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.errors.map(e => e.split(':')[0])).toEqual(['Titel', 'Spur', 'Sichtbarkeit', 'Beginn', 'Dauer'])
  })

  it('Beginn nur vom Vortag bis 3 Tage nach dem Eventtag', () => {
    expect(parseItemForm(form({ ...valid, start: '2026-06-19T08:00' }), ctx).ok).toBe(true)
    expect(parseItemForm(form({ ...valid, start: '2026-06-18T23:59' }), ctx).ok).toBe(false)
    expect(parseItemForm(form({ ...valid, start: '2026-06-23T23:59' }), ctx).ok).toBe(true)
    expect(parseItemForm(form({ ...valid, start: '2026-06-24T00:00' }), ctx).ok).toBe(false)
  })

  it('wartet auf nur bekannte Punkte', () => {
    const parsed = parseItemForm(form({ ...valid, waitsFor: ['fremd'] }), ctx)
    expect(!parsed.ok && parsed.errors[0]).toMatch(/^Wartet auf/)
  })

  it('SECRET braucht mindestens ein Konto mit Zugriff aufs Event', () => {
    expect(parseItemForm(form({ ...valid, visibility: 'SECRET' }), ctx).ok).toBe(false)
    const outsider = parseItemForm(form({ ...valid, visibility: 'SECRET', secretViewers: ['u1', 'fremd'] }), ctx)
    expect(!outsider.ok && outsider.errors[0]).toMatch(/keinen Zugriff/)
    const parsed = parseItemForm(form({ ...valid, visibility: 'SECRET', secretViewers: ['u2'] }), ctx)
    expect(parsed.ok && parsed.fields.secretViewerIds).toEqual(['u2'])
  })

  it('Kontenliste zählt nur bei SECRET', () => {
    const parsed = parseItemForm(form({ ...valid, visibility: 'TEAM', secretViewers: ['u1'] }), ctx)
    expect(parsed.ok && parsed.fields.secretViewerIds).toEqual([])
  })

  it('entfernt Steuerzeichen, behält Zeilenumbrüche nur in mehrzeiligen Feldern', () => {
    const parsed = parseItemForm(form({ ...valid, title: 'A\u0007B\nC', internalNote: 'Zeile 1\r\nZeile 2\u0000' }), ctx)
    expect(parsed.ok && parsed.fields.title).toBe('ABC')
    expect(parsed.ok && parsed.fields.internalNote).toBe('Zeile 1\nZeile 2')
  })
})

describe('redactItem', () => {
  const secret: StoredItem = {
    id: 'x', trackId: 't1', sortOrder: 1, title: 'Überraschung', location: 'Garten', description: 'Feuerwerk',
    internalNote: 'Zünder bei Tom', visibility: 'SECRET', isAnchor: false, mayStartEarly: false,
    plannedStart: new Date('2026-06-20T20:00:00Z'), plannedDurationMin: 10, status: 'CANCELLED', insertedLive: false,
    actualStart: null, actualEnd: null, reportedDelayMin: null, cancelReason: 'Regen', version: 3, waitsFor: ['a'],
    secretViewerIds: ['u1']
  }

  it('eingetragene Konten sehen alles', () => {
    expect(redactItem(secret, 'u1')).toEqual({ ...secret, canSee: true })
  })

  it('alle anderen - auch Besitzer*in und Admin - sehen nur Zeit, Dauer und Kette', () => {
    const redacted = redactItem(secret, 'owner')
    expect(redacted).toMatchObject({
      title: 'Geheimer Punkt', location: null, description: null, internalNote: null, cancelReason: null,
      secretViewerIds: [], canSee: false, plannedStart: secret.plannedStart, plannedDurationMin: 10, waitsFor: ['a']
    })
    const serialized = JSON.stringify(redacted)
    for (const word of ['Überraschung', 'Garten', 'Feuerwerk', 'Tom', 'Regen', 'u1']) expect(serialized).not.toContain(word)
  })

  it('TEAM- und öffentliche Punkte sieht jedes Konto mit Zugriff', () => {
    expect(redactItem({ ...secret, visibility: 'TEAM' }, 'owner').canSee).toBe(true)
  })
})
