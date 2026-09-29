import { describe, expect, it } from 'vitest'
import { allRows, nextSortOrder, placeInTrack, trackRows } from '../../../app/lib/planning/order'
import { at } from '../schedule/fixtures'

const row = (id: string, sortOrder: number, start: string, min = 30, trackId = 'a', status: 'PLANNED' | 'CANCELLED' = 'PLANNED') =>
  ({ id, sortOrder, plannedStart: at(start), plannedDurationMin: min, trackId, status })

describe('placeInTrack', () => {
  const track = [row('x', 1, '14:00'), row('y', 2, '15:00'), row('z', 3, '16:00')]

  it('sortiert einen neuen Punkt nach seinem Beginn ein und nummeriert lückenlos', () => {
    expect(placeInTrack(track, row('neu', 0, '15:30'))).toEqual([
      { id: 'x', sortOrder: 1 }, { id: 'y', sortOrder: 2 }, { id: 'neu', sortOrder: 3 }, { id: 'z', sortOrder: 4 }
    ])
    expect(placeInTrack(track, row('neu', 0, '13:00'))[0].id).toBe('neu')
    expect(placeInTrack(track, row('neu', 0, '17:00'))[3].id).toBe('neu')
  })

  it('bei gleichem Beginn hinter die vorhandenen', () => {
    expect(placeInTrack(track, row('neu', 0, '15:00')).map(r => r.id)).toEqual(['x', 'y', 'neu', 'z'])
  })

  it('ein geänderter Punkt wandert an seine neue Stelle, die anderen bleiben in ihrer Reihenfolge', () => {
    expect(placeInTrack(track, row('x', 1, '15:45')).map(r => r.id)).toEqual(['y', 'x', 'z'])
    // Nicht nach Uhrzeit sortierte Spur (Einschub im Live-Betrieb): übrige Reihenfolge bleibt.
    const live = [row('p', 1, '14:00'), row('einschub', 2, '15:20'), row('q', 3, '15:00')]
    expect(placeInTrack(live, row('neu', 0, '16:00')).map(r => r.id)).toEqual(['p', 'einschub', 'q', 'neu'])
  })

  it('nächste freie Position', () => {
    expect(nextSortOrder([])).toBe(1)
    expect(nextSortOrder(track)).toBe(4)
  })
})

describe('trackRows und allRows', () => {
  const items = [
    row('trauung', 1, '14:00', 45),
    row('sekt', 2, '14:45', 45),
    row('ausfall', 3, '15:00', 10, 'a', 'CANCELLED'),
    row('foto', 4, '15:30', 30),
    row('kaffee', 5, '16:30', 90),
    row('essen', 6, '17:50', 120),
    row('shooting', 1, '15:40', 30, 'b')
  ]

  it('Puffer, nahtlos und Überschneidung zum vorherigen aktiven Punkt der Spur', () => {
    const rows = new Map(trackRows(items).map(r => [r.item.id, r]))
    expect(rows.get('trauung')).toMatchObject({ gapMin: null, previousId: null, nextId: 'sekt' })
    expect(rows.get('sekt')?.gapMin).toBe(0)
    expect(rows.get('foto')).toMatchObject({ gapMin: 0, previousId: 'sekt', nextId: 'kaffee' })
    expect(rows.get('kaffee')?.gapMin).toBe(30)
    expect(rows.get('essen')?.gapMin).toBe(-10)
    expect(rows.get('ausfall')).toMatchObject({ gapMin: null, previousId: null, nextId: null })
    expect(rows.get('shooting')).toMatchObject({ gapMin: null, previousId: null, nextId: null })
    expect(rows.get('essen')?.end).toEqual(at('19:50'))
  })

  it('Alle: chronologisch über die Spuren', () => {
    expect(allRows(items, ['a', 'b']).map(r => r.item.id)).toEqual(['trauung', 'sekt', 'ausfall', 'foto', 'shooting', 'kaffee', 'essen'])
  })
})
