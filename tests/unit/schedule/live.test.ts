import { describe, expect, it } from 'vitest'
import {
  applyLiveCommand, applyLivePatches, autoEndAt, currentDelayMin, liveReference, nextInTrack, type LiveCommand
} from '../../../app/lib/schedule/live'
import { project } from '../../../app/lib/schedule/project'
import { DEFAULT_PROJECT_SETTINGS, type ScheduleItem } from '../../../app/lib/schedule/types'
import { at, hhmm, item, patch, weddingPlan } from './fixtures'

// Live-Steuerung (docs/KONZEPT.md Abschnitt 3): Befehle als reine Funktion, Zeit ist immer der übergebene
// Zeitpunkt (Serverzeit), Befehle sind absichtsbasiert und idempotent.

function run(items: ScheduleItem[], command: LiveCommand, now: Date) {
  return applyLiveCommand(items, command, now, DEFAULT_PROJECT_SETTINGS)
}

/** Führt den Befehl aus und gibt die neue Liste zurück (wirft bei Ablehnung). */
function step(items: ScheduleItem[], command: LiveCommand, now: Date): ScheduleItem[] {
  const result = run(items, command, now)
  if (!result.ok) throw new Error(`abgelehnt: ${result.reason}`)
  return applyLivePatches(items, result.patches)
}

const get = (items: ScheduleItem[], id: string) => items.find(i => i.id === id)!

describe('Weiter (advance)', () => {
  it('beendet den laufenden und startet den nächsten Punkt mit der übergebenen Zeit', () => {
    let items = step(weddingPlan(), { kind: 'advance', fromId: null, toId: 'trauung' }, at('14:05'))
    expect(get(items, 'trauung')).toMatchObject({ status: 'RUNNING', actualStart: at('14:05') })
    items = step(items, { kind: 'advance', fromId: 'trauung', toId: 'sekt' }, at('14:52'))
    expect(get(items, 'trauung')).toMatchObject({ status: 'DONE', actualEnd: at('14:52') })
    expect(get(items, 'sekt')).toMatchObject({ status: 'RUNNING', actualStart: at('14:52') })
    expect(nextInTrack(items, 'main')?.id).toBe('foto')
  })

  it('zweimal dasselbe "Weiter" überspringt nichts: das zweite ändert nichts', () => {
    const started = step(weddingPlan(), { kind: 'advance', fromId: null, toId: 'trauung' }, at('14:00'))
    const once = step(started, { kind: 'advance', fromId: 'trauung', toId: 'sekt' }, at('14:45'))
    const twice = run(once, { kind: 'advance', fromId: 'trauung', toId: 'sekt' }, at('14:45'))
    expect(twice).toEqual({ ok: false, reason: 'already' })
    expect(get(once, 'foto').actualStart).toBeNull()
  })

  it('nur zum nächsten Punkt der Spur - nicht zu einem späteren oder in eine andere Spur', () => {
    const started = step(weddingPlan(), { kind: 'advance', fromId: null, toId: 'trauung' }, at('14:00'))
    expect(run(started, { kind: 'advance', fromId: 'trauung', toId: 'foto' }, at('14:45'))).toEqual({ ok: false, reason: 'not-next' })
    expect(run(weddingPlan(), { kind: 'advance', fromId: null, toId: 'sekt' }, at('14:00'))).toEqual({ ok: false, reason: 'not-next' })
    const other = [...started, item({ id: 'paar', trackId: 'paar', start: '14:50', min: 30 })]
    expect(run(other, { kind: 'advance', fromId: 'trauung', toId: 'paar' }, at('14:45'))).toEqual({ ok: false, reason: 'not-next' })
    // Ohne laufenden Punkt: nur, wenn in der Spur wirklich nichts läuft.
    expect(run(started, { kind: 'advance', fromId: null, toId: 'sekt' }, at('14:45'))).toEqual({ ok: false, reason: 'not-next' })
  })

  it('überspringt zurückgestellte und ausgefallene Punkte', () => {
    const items = patch(step(weddingPlan(), { kind: 'advance', fromId: null, toId: 'trauung' }, at('14:00')), { sekt: { status: 'CANCELLED' } })
    expect(nextInTrack(items, 'main')?.id).toBe('foto')
    expect(run(items, { kind: 'advance', fromId: 'trauung', toId: 'foto' }, at('14:45')).ok).toBe(true)
  })

  it('eine vor dem Start gemeldete Verspätung hat sich mit dem Beginn erledigt', () => {
    const delayed = patch(weddingPlan(), { trauung: { reportedDelayMin: 10 } })
    const started = step(delayed, { kind: 'advance', fromId: null, toId: 'trauung' }, at('14:03'))
    expect(get(started, 'trauung').reportedDelayMin).toBeNull()
    const projection = project(started, at('14:10'), DEFAULT_PROJECT_SETTINGS)
    if (!projection.ok) throw new Error()
    expect(hhmm(projection.items.find(i => i.id === 'trauung')!.expectedEnd)).toBe('14:48')
  })
})

describe('Gestartet / Beendet (auch "vor ...")', () => {
  it('"Beendet vor 10 Min" stellt einen vergessenen Knopf richtig - nie vor dem Beginn, nie in der Zukunft', () => {
    const running = step(weddingPlan(), { kind: 'start', id: 'trauung', minutesAgo: 0 }, at('14:00'))
    const ended = step(running, { kind: 'end', id: 'trauung', minutesAgo: 10 }, at('14:55'))
    expect(get(ended, 'trauung')).toMatchObject({ status: 'DONE', actualEnd: at('14:45') })
    expect(run(running, { kind: 'end', id: 'trauung', minutesAgo: 15 }, at('14:10'))).toEqual({ ok: false, reason: 'too-early' })
    expect(run(running, { kind: 'end', id: 'trauung', minutesAgo: -5 }, at('14:10'))).toEqual({ ok: false, reason: 'range' })
    expect(run(running, { kind: 'end', id: 'trauung', minutesAgo: 181 }, at('18:10'))).toEqual({ ok: false, reason: 'range' })
    expect(run(ended, { kind: 'end', id: 'trauung', minutesAgo: 0 }, at('15:00'))).toEqual({ ok: false, reason: 'already' })
    expect(run(weddingPlan(), { kind: 'end', id: 'sekt', minutesAgo: 0 }, at('15:00'))).toEqual({ ok: false, reason: 'not-running' })
  })

  it('"Gestartet vor 5 Min": nicht vor dem Beginn eines früheren Punkts der Spur', () => {
    const items = step(weddingPlan(), { kind: 'start', id: 'trauung', minutesAgo: 5 }, at('14:05'))
    expect(get(items, 'trauung').actualStart).toEqual(at('14:00'))
    expect(run(items, { kind: 'start', id: 'sekt', minutesAgo: 10 }, at('14:05'))).toEqual({ ok: false, reason: 'too-early' })
    expect(run(items, { kind: 'start', id: 'sekt', minutesAgo: 5 }, at('14:05')).ok).toBe(true)
    expect(run(items, { kind: 'start', id: 'trauung', minutesAgo: 0 }, at('14:06'))).toEqual({ ok: false, reason: 'already' })
    expect(run(items, { kind: 'start', id: 'trauung', minutesAgo: 1.5 }, at('14:06'))).toEqual({ ok: false, reason: 'range' })
  })
})

describe('Verspätung und "Im Plan"', () => {
  it('Zielwert aus bisheriger Abweichung + 5: gleiche Meldung von zwei Handys ergibt dasselbe', () => {
    const items = weddingPlan()
    const once = step(items, { kind: 'delay', id: 'trauung', delayMin: 10 }, at('13:50'))
    expect(get(once, 'trauung').reportedDelayMin).toBe(10)
    expect(run(once, { kind: 'delay', id: 'trauung', delayMin: 10 }, at('13:50'))).toEqual({ ok: false, reason: 'already' })
    expect(run(items, { kind: 'delay', id: 'trauung', delayMin: 601 }, at('13:50'))).toEqual({ ok: false, reason: 'range' })
    const back = step(once, { kind: 'ontime', id: 'trauung' }, at('13:55'))
    expect(get(back, 'trauung').reportedDelayMin).toBeNull()
    expect(run(back, { kind: 'ontime', id: 'trauung' }, at('13:55'))).toEqual({ ok: false, reason: 'already' })
  })

  it('currentDelayMin: bei einem laufenden Punkt die Abweichung des Endes, sonst des Beginns', () => {
    const running = step(weddingPlan(), { kind: 'start', id: 'trauung', minutesAgo: 0 }, at('14:10'))
    const projection = project(running, at('14:20'), DEFAULT_PROJECT_SETTINGS)
    if (!projection.ok) throw new Error()
    const trauung = projection.items.find(i => i.id === 'trauung')!
    expect(currentDelayMin(trauung)).toBe(10)
    // "+5" am laufenden Punkt: Meldung 15 verlängert sein Ende um 5 Minuten.
    const longer = step(running, { kind: 'delay', id: 'trauung', delayMin: currentDelayMin(trauung) + 5 }, at('14:20'))
    const after = project(longer, at('14:20'), DEFAULT_PROJECT_SETTINGS)
    if (!after.ok) throw new Error()
    expect(hhmm(after.items.find(i => i.id === 'trauung')!.expectedEnd)).toBe('15:00')
    expect(currentDelayMin(after.items.find(i => i.id === 'sekt')!)).toBe(15)
  })
})

describe('Zurückstellen, Ausfall, Wiederherstellen, als Nächstes', () => {
  it('Zurückstellen und Ausfall nur vor dem Beginn; Wiederherstellen macht beides rückgängig', () => {
    const deferred = step(weddingPlan(), { kind: 'defer', id: 'foto' }, at('14:00'))
    expect(get(deferred, 'foto').status).toBe('DEFERRED')
    expect(run(deferred, { kind: 'defer', id: 'foto' }, at('14:00'))).toEqual({ ok: false, reason: 'already' })
    const cancelled = applyLiveCommand(weddingPlan(), { kind: 'cancel', id: 'kaffee', reason: '  Regen  ' }, at('14:00'), DEFAULT_PROJECT_SETTINGS)
    expect(cancelled).toEqual({ ok: true, patches: [{ id: 'kaffee', status: 'CANCELLED', cancelReason: 'Regen' }] })
    const running = step(weddingPlan(), { kind: 'start', id: 'trauung', minutesAgo: 0 }, at('14:00'))
    expect(run(running, { kind: 'defer', id: 'trauung' }, at('14:10'))).toEqual({ ok: false, reason: 'started' })
    expect(run(running, { kind: 'cancel', id: 'trauung', reason: null }, at('14:10'))).toEqual({ ok: false, reason: 'started' })
    expect(get(step(deferred, { kind: 'restore', id: 'foto' }, at('14:05')), 'foto').status).toBe('PLANNED')
    expect(run(weddingPlan(), { kind: 'restore', id: 'foto' }, at('14:05'))).toEqual({ ok: false, reason: 'already' })
  })

  it('als Nächstes: direkt nach dem laufenden Punkt, beginnt, wenn er laut Prognose endet', () => {
    let items = step(weddingPlan(), { kind: 'defer', id: 'foto' }, at('13:00'))
    items = step(items, { kind: 'start', id: 'trauung', minutesAgo: 0 }, at('14:00'))
    items = step(items, { kind: 'requeue', id: 'foto' }, at('14:20'))
    const order = items.filter(i => i.trackId === 'main').sort((a, b) => a.sortOrder - b.sortOrder).map(i => i.id)
    expect(order.slice(0, 3)).toEqual(['trauung', 'foto', 'sekt'])
    expect(get(items, 'foto')).toMatchObject({ status: 'PLANNED', plannedStart: at('14:45') })
    expect(nextInTrack(items, 'main')?.id).toBe('foto')
  })

  it('als Nächstes geht erst, wenn in der Spur etwas begonnen hat; Anker nie', () => {
    const deferred = step(weddingPlan(), { kind: 'defer', id: 'foto' }, at('13:00'))
    expect(run(deferred, { kind: 'requeue', id: 'foto' }, at('13:00'))).toEqual({ ok: false, reason: 'nothing-started' })
    const anchor = patch(deferred, { foto: { isAnchor: true } })
    expect(run(anchor, { kind: 'requeue', id: 'foto' }, at('13:00'))).toEqual({ ok: false, reason: 'anchor' })
    expect(run(weddingPlan(), { kind: 'requeue', id: 'foto' }, at('13:00'))).toEqual({ ok: false, reason: 'already' })
  })
})

describe('Bezugspunkt und nächster Punkt', () => {
  it('laufend vor zuletzt begonnen; von vorn, wenn nichts begonnen hat', () => {
    const items = weddingPlan()
    expect(liveReference(items, 'main')).toBeNull()
    expect(nextInTrack(items, 'main')?.id).toBe('trauung')
    const done = patch(items, { trauung: { actualStart: at('14:00'), actualEnd: at('14:40'), status: 'DONE' } })
    expect(liveReference(done, 'main')?.id).toBe('trauung')
    expect(nextInTrack(done, 'main')?.id).toBe('sekt')
  })
})

describe('autoEndAt', () => {
  it('6 Stunden nach dem letzten Punkt, ohne Punkte zwei Tage nach dem Eventtag', () => {
    expect(autoEndAt(weddingPlan(), at('00:00'))).toEqual(new Date(at('18:30').getTime() + (120 + 360) * 60_000))
    const withActual = patch(weddingPlan(), { essen: { actualStart: at('18:30'), actualEnd: at('23:00') } })
    expect(autoEndAt(withActual, at('00:00'))).toEqual(new Date(at('23:00').getTime() + 360 * 60_000))
    expect(autoEndAt([], at('00:00'))).toEqual(new Date(at('00:00').getTime() + 48 * 3600_000))
  })
})
