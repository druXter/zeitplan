import { describe, expect, it } from 'vitest'
import { applyChanges, shiftBlock } from '../../../app/lib/schedule/plan-changes'
import type { ScheduleItem } from '../../../app/lib/schedule/types'
import { at, hhmm, item, patch, weddingPlan } from './fixtures'

function planned(items: ScheduleItem[]): Record<string, string> {
  return Object.fromEntries([...items].sort((a, b) => a.sortOrder - b.sortOrder).map(i => [i.id, hhmm(i.plannedStart)]))
}

function shifted(items: ScheduleItem[], ...args: Parameters<typeof shiftBlock> extends [unknown, ...infer R] ? R : never) {
  const result = shiftBlock(items, ...args)
  if (!result.ok) throw new Error(result.reason)
  return planned(applyChanges(items, result.changes))
}

describe('shiftBlock (Idee L20, Block verschieben)', () => {
  it('verschiebt den Punkt und alle folgenden bis vor den nächsten Anker - der Anker bleibt', () => {
    expect(shifted(weddingPlan(), 'sekt', 30, 'until-anchor')).toEqual({
      trauung: '14:00', sekt: '15:15', foto: '16:00', kaffee: '17:00', essen: '18:30'
    })
  })

  it('bis zum Ende der Spur nimmt auch Anker mit', () => {
    expect(shifted(weddingPlan(), 'sekt', 30, 'track-end')).toEqual({
      trauung: '14:00', sekt: '15:15', foto: '16:00', kaffee: '17:00', essen: '19:00'
    })
  })

  it('ist der Startpunkt ein Anker, wandert er mit (bis vor den nächsten Anker)', () => {
    const items = [...weddingPlan(), item({ id: 'party', start: '20:30', min: 240, sortOrder: 6 }), item({ id: 'feuerwerk', start: '23:00', min: 15, sortOrder: 7, isAnchor: true })]
    expect(shifted(items, 'essen', 15, 'until-anchor')).toMatchObject({ kaffee: '16:30', essen: '18:45', party: '20:45', feuerwerk: '23:00' })
  })

  it('früher verschieben geht, solange der Block nicht vor dem vorherigen Punkt beginnt', () => {
    expect(shifted(weddingPlan(), 'kaffee', -30, 'until-anchor')).toMatchObject({ foto: '15:30', kaffee: '16:00' })
    expect(shiftBlock(weddingPlan(), 'kaffee', -61, 'until-anchor')).toEqual({ ok: false, reason: 'order' })
  })

  it('zurückgestellte und ausgefallene Punkte rutschen mit, ausgefallene Anker halten den Block nicht auf', () => {
    const items = patch(weddingPlan(), { foto: { status: 'DEFERRED' }, essen: { status: 'CANCELLED' } })
    expect(shifted(items, 'sekt', 10, 'until-anchor')).toEqual({ trauung: '14:00', sekt: '14:55', foto: '15:40', kaffee: '16:40', essen: '18:40' })
  })

  it('lehnt begonnene Punkte im Block ab', () => {
    const items = patch(weddingPlan(), { trauung: { actualStart: at('14:00'), status: 'RUNNING' } })
    expect(shiftBlock(items, 'trauung', 10, 'until-anchor')).toEqual({ ok: false, reason: 'started' })
    expect(shiftBlock(items, 'sekt', 10, 'until-anchor').ok).toBe(true)
  })

  it('lehnt 0, Bruchteile, mehr als einen Tag und Zeiten außerhalb der Grenzen ab', () => {
    for (const minutes of [0, 1.5, 24 * 60 + 1, -(24 * 60 + 1)]) {
      expect(shiftBlock(weddingPlan(), 'sekt', minutes, 'until-anchor')).toEqual({ ok: false, reason: 'range' })
    }
    const bounds = { from: at('00:00'), until: at('17:00') }
    expect(shiftBlock(weddingPlan(), 'sekt', 30, 'until-anchor', bounds)).toEqual({ ok: false, reason: 'range' })
    expect(shiftBlock(weddingPlan(), 'sekt', 10, 'until-anchor', bounds).ok).toBe(true)
    expect(shiftBlock(weddingPlan(), 'trauung', -15, 'until-anchor', { from: at('14:00'), until: at('23:00') })).toEqual({ ok: false, reason: 'range' })
  })

  it('lässt andere Spuren unberührt und kennt unbekannte Punkte nicht', () => {
    const items = [...weddingPlan(), item({ id: 'paar', trackId: 'paar', start: '15:00', min: 60, sortOrder: 1 })]
    const result = shiftBlock(items, 'trauung', 20, 'track-end')
    expect(result.ok && result.changes.map(c => c.id)).toEqual(['trauung', 'sekt', 'foto', 'kaffee', 'essen'])
    expect(shiftBlock(items, 'gibtsnicht', 5, 'track-end')).toEqual({ ok: false, reason: 'not-found' })
  })
})
