import { describe, expect, it } from 'vitest'
import { whatIf } from '../../../app/lib/schedule/what-if'
import { DEFAULT_PROJECT_SETTINGS, type ScheduleItem } from '../../../app/lib/schedule/types'
import { at, hhmm, patch, weddingPlan } from './fixtures'

// "Was wäre wenn" (Idee L19) auf dem Beispiel aus docs/KONZEPT.md Abschnitt 2: Trauung 14:00–14:45, Sekt bis 15:30,
// Foto bis 16:00, 30 Min Puffer, Kaffee 16:30–18:00, Abendessen 18:30 (Anker).

function run(items: ScheduleItem[], itemId: string, delayMin: number, now = at('12:00')) {
  const result = whatIf(items, { itemId, delayMin }, now, DEFAULT_PROJECT_SETTINGS)
  if (!result.ok) throw new Error(result.reason)
  const row = (id: string) => result.rows.find(r => r.before.id === id)!
  return { ...result, row }
}

describe('whatIf', () => {
  it('Trauung +20: rutscht bis zum Puffer, der Puffer schluckt den Rest', () => {
    const result = run(weddingPlan(), 'trauung', 20)
    expect(result.simulatedDelayMin).toBe(20)
    expect(['trauung', 'sekt', 'foto'].map(id => result.row(id).startShiftMin)).toEqual([20, 20, 20])
    expect(result.row('foto').endShiftMin).toBe(20)
    expect(result.row('kaffee')).toMatchObject({ startShiftMin: 0, absorbedByGapMin: 20 })
    expect(result.row('essen')).toMatchObject({ startShiftMin: 0, anchorHolds: false })
    expect(result.conflicts).toEqual([])
    expect(result.trackEnds).toEqual([{ trackId: 'main', endShiftMin: 0 }])
  })

  it('Trauung +45: der Puffer reicht nicht, Kaffee rutscht und überschneidet den Anker', () => {
    const result = run(weddingPlan(), 'trauung', 45)
    expect(result.row('kaffee')).toMatchObject({ startShiftMin: 15, absorbedByGapMin: 30 })
    expect(hhmm(result.row('kaffee').after.expectedStart)).toBe('16:45')
    expect(result.row('essen')).toMatchObject({ startShiftMin: 0, anchorHolds: false })
    expect(result.conflicts).toEqual([])

    const later = run(weddingPlan(), 'trauung', 75)
    expect(later.row('essen').anchorHolds).toBe(true)
    expect(later.conflicts).toEqual([{ anchorId: 'essen', itemId: 'kaffee', overlapMin: 15, previousOverlapMin: 0 }])
  })

  it('kürzbare Punkte (Idee L11) schlucken mit', () => {
    const items = patch(weddingPlan(), { kaffee: { minDurationMin: 60 } })
    const result = run(items, 'trauung', 75)
    expect(result.row('kaffee')).toMatchObject({ startShiftMin: 45, extraShortenedMin: 15 })
    expect(result.conflicts).toEqual([])
  })

  it('setzt auf die schon erwartete Verspätung auf - wie der Live-Knopf', () => {
    const items = patch(weddingPlan(), { trauung: { reportedDelayMin: 10 } })
    const result = run(items, 'sekt', 5, at('13:55'))
    expect(result.simulatedDelayMin).toBe(15)
    expect(result.row('sekt').startShiftMin).toBe(5)
    expect(result.row('trauung').startShiftMin).toBe(0)
  })

  it('laufender Punkt: „+20“ verlängert ihn', () => {
    const items = patch(weddingPlan(), { trauung: { status: 'RUNNING', actualStart: at('14:00') } })
    const result = run(items, 'trauung', 20, at('14:10'))
    expect(result.row('trauung')).toMatchObject({ startShiftMin: 0, endShiftMin: 20 })
    expect(result.row('sekt').startShiftMin).toBe(20)
  })

  it('verändert die Eingabe nicht', () => {
    const items = weddingPlan()
    const copy = JSON.stringify(items)
    run(items, 'trauung', 30)
    expect(JSON.stringify(items)).toBe(copy)
  })

  it('lehnt unbekannte, beendete, ausgefallene Punkte und ungültige Minuten ab', () => {
    const settings = DEFAULT_PROJECT_SETTINGS
    const items = patch(weddingPlan(), {
      trauung: { status: 'DONE', actualStart: at('14:00'), actualEnd: at('14:45') },
      foto: { status: 'CANCELLED' }
    })
    expect(whatIf(items, { itemId: 'gibt-es-nicht', delayMin: 10 }, at('15:00'), settings)).toEqual({ ok: false, reason: 'not-found' })
    expect(whatIf(items, { itemId: 'trauung', delayMin: 10 }, at('15:00'), settings)).toEqual({ ok: false, reason: 'done' })
    expect(whatIf(items, { itemId: 'foto', delayMin: 10 }, at('15:00'), settings)).toEqual({ ok: false, reason: 'inactive' })
    for (const delayMin of [0, -5, 1.5, 601]) expect(whatIf(items, { itemId: 'sekt', delayMin }, at('15:00'), settings)).toEqual({ ok: false, reason: 'range' })
    const loop = patch(weddingPlan(), { trauung: { waitsFor: ['essen'] } })
    expect(whatIf(loop, { itemId: 'sekt', delayMin: 10 }, at('12:00'), settings)).toEqual({ ok: false, reason: 'cycle' })
  })

  it('Zusammenführung: eine Verspätung in einer Spur kommt über waitsFor in der anderen an', () => {
    const items: ScheduleItem[] = [
      ...weddingPlan(),
      { ...weddingPlan()[0], id: 'shooting', trackId: 'paar', sortOrder: 1, plannedStart: at('15:30'), plannedDurationMin: 30 },
      { ...weddingPlan()[0], id: 'torte', trackId: 'paar', sortOrder: 2, plannedStart: at('16:15'), plannedDurationMin: 15, waitsFor: ['foto'] }
    ]
    const result = run(items, 'trauung', 30)
    // Foto endet 16:30 statt 16:00; die Torte (Puffer 15 hinter dem Shooting) wartet aufs Foto.
    expect(result.row('torte')).toMatchObject({ startShiftMin: 15, absorbedByGapMin: 15 })
    expect(result.trackEnds.find(t => t.trackId === 'paar')!.endShiftMin).toBe(15)
  })
})
