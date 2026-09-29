import { describe, expect, it } from 'vitest'
import { timelineSections, type TimelineState } from '../../app/lib/timeline'

// Einteilung in Jetzt / Als Nächstes / Danach / Vorbei für Gästeansicht, Tafel und Team-Ansicht.

type Row = { id: string; state: TimelineState; start: number }
const row = (id: string, state: TimelineState, start: number): Row => ({ id, state, start })
const sections = (rows: Row[]) => {
  const result = timelineSections(rows, r => r.state, r => r.start)
  return { now: result.now.map(r => r.id), next: result.next.map(r => r.id), later: result.later.map(r => r.id), past: result.past.map(r => r.id) }
}

describe('timelineSections', () => {
  it('vor dem Event: der erste Punkt ist "Als Nächstes"', () => {
    expect(sections([row('a', 'upcoming', 1), row('b', 'upcoming', 2), row('c', 'upcoming', 3)]))
      .toEqual({ now: [], next: ['a'], later: ['b', 'c'], past: [] })
  })

  it('während des Events: laufend, vorbei, nächster', () => {
    expect(sections([row('a', 'past', 1), row('b', 'now', 2), row('c', 'upcoming', 3), row('d', 'upcoming', 4)]))
      .toEqual({ now: ['b'], next: ['c'], later: ['d'], past: ['a'] })
  })

  it('mehrere Punkte mit gleichem Beginn (parallele Spuren) sind gemeinsam "Als Nächstes"', () => {
    expect(sections([row('a', 'now', 1), row('b', 'upcoming', 3), row('c', 'upcoming', 3), row('d', 'upcoming', 4)]))
      .toEqual({ now: ['a'], next: ['b', 'c'], later: ['d'], past: [] })
  })

  it('Ausfälle: vor dem letzten erreichten Punkt vorbei, sonst kommend; nie allein "Als Nächstes"', () => {
    expect(sections([row('x', 'cancelled', 0), row('a', 'past', 1), row('y', 'cancelled', 2), row('b', 'now', 3), row('z', 'cancelled', 4), row('c', 'upcoming', 5)]))
      .toEqual({ now: ['b'], next: ['z', 'c'], later: [], past: ['x', 'a', 'y'] })
    expect(sections([row('a', 'past', 1), row('z', 'cancelled', 4)])).toEqual({ now: [], next: [], later: ['z'], past: ['a'] })
  })

  it('nach dem Event: alles vorbei', () => {
    expect(sections([row('a', 'past', 1), row('b', 'past', 2)])).toEqual({ now: [], next: [], later: [], past: ['a', 'b'] })
    expect(sections([])).toEqual({ now: [], next: [], later: [], past: [] })
  })
})
