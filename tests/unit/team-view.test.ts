import { describe, expect, it } from 'vitest'
import { myItems, type TeamItem } from '../../app/lib/team/view'
import { at } from './schedule/fixtures'

// "Meine Punkte" (Idee L16): eigene Punkte, die noch kommen oder laufen, nach erwartetem Beginn.

function teamItem(id: string, start: string, phase: TeamItem['phase'], assigneeIds: string[]): TeamItem {
  return { id, expectedStart: at(start), phase, assigneeIds } as TeamItem
}

describe('myItems', () => {
  it('nur eigene, kommende oder laufende Punkte, mit Minuten bis zum erwarteten Beginn', () => {
    const items = [
      teamItem('rede', '21:40', 'upcoming', ['u1', 'u2']),
      teamItem('tanz', '20:30', 'now', ['u1']),
      teamItem('vorbei', '18:00', 'past', ['u1']),
      teamItem('aus', '22:00', 'cancelled', ['u1']),
      teamItem('fremd', '21:00', 'upcoming', ['u2'])
    ]
    expect(myItems(items, 'u1', at('21:15')).map(({ item, minutesUntil }) => [item.id, minutesUntil])).toEqual([['tanz', -45], ['rede', 25]])
    expect(myItems(items, 'u3', at('21:15'))).toEqual([])
  })
})
