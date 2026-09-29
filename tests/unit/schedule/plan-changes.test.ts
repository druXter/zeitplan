import { describe, expect, it } from 'vitest'
import { applyChanges, insertAfter, swapAdjacent } from '../../../app/lib/schedule/plan-changes'
import { project } from '../../../app/lib/schedule/project'
import { DEFAULT_PROJECT_SETTINGS, type ScheduleItem } from '../../../app/lib/schedule/types'
import { at, hhmm, item, patch, weddingPlan } from './fixtures'

function times(items: ScheduleItem[], now: Date): Record<string, string> {
  const result = project(items, now, DEFAULT_PROJECT_SETTINGS)
  if (!result.ok) throw new Error(JSON.stringify(result.problem))
  return Object.fromEntries(result.items.map(i => [i.id, `${hhmm(i.expectedStart)}–${hhmm(i.expectedEnd)}`]))
}

function planned(items: ScheduleItem[]): Record<string, string> {
  return Object.fromEntries([...items].sort((a, b) => a.sortOrder - b.sortOrder).map(i => [i.id, hhmm(i.plannedStart)]))
}

describe('swapAdjacent (docs/KONZEPT.md Abschnitt 3, Tauschen)', () => {
  it('B übernimmt den Beginn von A, A folgt mit demselben Abstand - das Ende des Blocks bleibt gleich', () => {
    const items = [
      item({ id: 'a', start: '14:00', min: 30, sortOrder: 1 }),
      item({ id: 'b', start: '14:45', min: 20, sortOrder: 2 }), // 15 Min Abstand nach A
      item({ id: 'c', start: '15:05', min: 30, sortOrder: 3 })
    ]
    const result = swapAdjacent(items, 'a', 'b')
    expect(result).toEqual({
      ok: true,
      changes: [
        { id: 'b', plannedStart: at('14:00'), sortOrder: 1 },
        { id: 'a', plannedStart: at('14:35'), sortOrder: 2 }
      ]
    })
    const swapped = applyChanges(items, result.ok ? result.changes : [])
    // A endet 15:05 wie vorher B, C bleibt unberührt.
    expect(planned(swapped)).toEqual({ b: '14:00', a: '14:35', c: '15:05' })
    expect(times(swapped, at('12:00'))).toEqual({ a: '14:35–15:05', b: '14:00–14:20', c: '15:05–15:35' })
  })

  it('im Beispiel aus dem Konzept: Gruppenfoto vor dem Sektempfang, Kaffee unberührt', () => {
    const result = swapAdjacent(weddingPlan(), 'sekt', 'foto')
    expect(result.ok).toBe(true)
    const swapped = applyChanges(weddingPlan(), result.ok ? result.changes : [])
    expect(planned(swapped)).toEqual({ trauung: '14:00', foto: '14:45', sekt: '15:15', kaffee: '16:30', essen: '18:30' })
  })

  it('die Reihenfolge der Argumente spielt keine Rolle ("nach oben" = mit dem vorherigen tauschen)', () => {
    expect(swapAdjacent(weddingPlan(), 'foto', 'sekt')).toEqual(swapAdjacent(weddingPlan(), 'sekt', 'foto'))
  })

  it('ist kein Verschieben: Tausch ist ein neuer Plan, keine Verspätung', () => {
    const result = swapAdjacent(weddingPlan(), 'sekt', 'foto')
    const swapped = applyChanges(weddingPlan(), result.ok ? result.changes : [])
    const projection = project(swapped, at('12:00'), DEFAULT_PROJECT_SETTINGS)
    expect(projection.ok && projection.items.every(i => i.delayMin === 0)).toBe(true)
  })

  it('tauscht über ausgefallene und zurückgestellte Punkte hinweg - sie liegen nicht dazwischen', () => {
    const items = patch(weddingPlan(), { foto: { status: 'CANCELLED' } })
    expect(swapAdjacent(items, 'sekt', 'kaffee').ok).toBe(true)
    const deferred = patch(weddingPlan(), { foto: { status: 'DEFERRED' } })
    expect(swapAdjacent(deferred, 'sekt', 'kaffee').ok).toBe(true)
  })

  it('lehnt nicht benachbarte Punkte, andere Spuren und unbekannte ids ab', () => {
    expect(swapAdjacent(weddingPlan(), 'trauung', 'foto')).toEqual({ ok: false, reason: 'not-adjacent' })
    const other = [...weddingPlan(), item({ id: 'x', trackId: 'technik', start: '14:45', min: 10 })]
    expect(swapAdjacent(other, 'sekt', 'x')).toEqual({ ok: false, reason: 'not-adjacent' })
    expect(swapAdjacent(weddingPlan(), 'sekt', 'gibt-es-nicht')).toEqual({ ok: false, reason: 'not-found' })
    expect(swapAdjacent(weddingPlan(), 'sekt', 'sekt')).toEqual({ ok: false, reason: 'not-adjacent' })
  })

  it('lehnt begonnene, beendete, zurückgestellte und ausgefallene Punkte ab', () => {
    const running = patch(weddingPlan(), { sekt: { status: 'RUNNING', actualStart: at('14:45') } })
    expect(swapAdjacent(running, 'sekt', 'foto')).toEqual({ ok: false, reason: 'started' })
    const done = patch(weddingPlan(), { trauung: { status: 'DONE', actualStart: at('14:00'), actualEnd: at('14:45') } })
    expect(swapAdjacent(done, 'trauung', 'sekt')).toEqual({ ok: false, reason: 'started' })
    const cancelled = patch(weddingPlan(), { foto: { status: 'CANCELLED' } })
    expect(swapAdjacent(cancelled, 'sekt', 'foto')).toEqual({ ok: false, reason: 'inactive' })
  })

  it('lehnt Anker ab - ihre Zeit steht fest', () => {
    expect(swapAdjacent(weddingPlan(), 'kaffee', 'essen')).toEqual({ ok: false, reason: 'anchor' })
  })

  it('lehnt einen Tausch ab, der einen Kreis erzeugen würde', () => {
    const items = patch(weddingPlan(), { foto: { waitsFor: ['sekt'] } })
    expect(swapAdjacent(items, 'sekt', 'foto')).toEqual({ ok: false, reason: 'cycle' })
  })
})

describe('insertAfter (docs/KONZEPT.md Abschnitt 3, Einschub)', () => {
  const settings = DEFAULT_PROJECT_SETTINGS
  const rede = { id: 'rede', plannedDurationMin: 10, isAnchor: false, mayStartEarly: false, status: 'PLANNED' as const, actualStart: null, actualEnd: null, reportedDelayMin: null, waitsFor: [] }

  it('kommt direkt nach dem laufenden Punkt; die folgenden rutschen über die normale Kette', () => {
    const items = patch(weddingPlan(), { trauung: { status: 'RUNNING', actualStart: at('14:00') } })
    const result = insertAfter(items, 'trauung', rede, at('14:20'), settings)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.item).toMatchObject({ id: 'rede', trackId: 'main', sortOrder: 2, plannedStart: at('14:45') })
    // Platz in der Reihenfolge schaffen, geplante Zeiten der anderen bleiben.
    expect(result.changes).toEqual([
      { id: 'sekt', sortOrder: 3 }, { id: 'foto', sortOrder: 4 }, { id: 'kaffee', sortOrder: 5 }, { id: 'essen', sortOrder: 6 }
    ])
    const after = [...applyChanges(items, result.changes), result.item]
    expect(times(after, at('14:20'))).toMatchObject({
      rede: '14:45–14:55', sekt: '14:55–15:40', foto: '15:40–16:10', kaffee: '16:30–18:00', essen: '18:30–20:30'
    })
  })

  it('ein langer Einschub: Anker bleibt, der Konflikt erscheint fürs Team', () => {
    const items = patch(weddingPlan(), {
      trauung: { status: 'DONE', actualStart: at('14:00'), actualEnd: at('14:45') },
      sekt: { status: 'DONE', actualStart: at('14:45'), actualEnd: at('15:30') },
      foto: { status: 'DONE', actualStart: at('15:30'), actualEnd: at('16:00') },
      kaffee: { status: 'RUNNING', actualStart: at('16:30') }
    })
    const result = insertAfter(items, 'kaffee', { ...rede, plannedDurationMin: 45 }, at('17:00'), settings)
    if (!result.ok) throw new Error(result.reason)
    const projection = project([...applyChanges(items, result.changes), result.item], at('17:00'), settings)
    expect(projection.ok && projection.conflicts).toEqual([{ anchorId: 'essen', itemId: 'rede', overlapMin: 15 }])
  })

  it('nach einem schon beendeten Punkt beginnt der Einschub frühestens jetzt, auf die volle Minute aufgerundet', () => {
    const items = patch(weddingPlan(), { trauung: { status: 'DONE', actualStart: at('14:00'), actualEnd: at('14:30') } })
    const result = insertAfter(items, 'trauung', rede, new Date(at('14:40').getTime() + 30_000), settings)
    expect(result.ok && result.item.plannedStart).toEqual(at('14:41'))
  })

  it('nimmt Lücken in sortOrder und lässt andere Spuren unberührt', () => {
    const items = [
      item({ id: 'a', start: '14:00', min: 30, sortOrder: 10 }),
      item({ id: 'b', start: '14:30', min: 30, sortOrder: 20 }),
      item({ id: 'x', trackId: 'technik', start: '14:00', min: 30, sortOrder: 11 })
    ]
    const result = insertAfter(items, 'a', rede, at('12:00'), settings)
    expect(result.ok && result.item.sortOrder).toBe(11)
    expect(result.ok && result.changes).toEqual([])
  })

  it('lehnt unbekannte, zurückgestellte und ausgefallene Punkte als Anker für den Einschub ab', () => {
    expect(insertAfter(weddingPlan(), 'gibt-es-nicht', rede, at('12:00'), settings)).toEqual({ ok: false, reason: 'not-found' })
    const cancelled = patch(weddingPlan(), { sekt: { status: 'CANCELLED' } })
    expect(insertAfter(cancelled, 'sekt', rede, at('12:00'), settings)).toEqual({ ok: false, reason: 'inactive' })
  })

  it('lehnt einen Einschub mit vorhandener id oder ungültigen Abhängigkeiten ab', () => {
    expect(insertAfter(weddingPlan(), 'sekt', { ...rede, id: 'foto' }, at('12:00'), settings)).toEqual({ ok: false, reason: 'duplicate' })
    expect(insertAfter(weddingPlan(), 'sekt', { ...rede, waitsFor: ['essen'] }, at('12:00'), settings)).toEqual({ ok: false, reason: 'cycle' })
  })
})
