import { describe, expect, it } from 'vitest'
import { alertMessage, dueAlerts, sentKey, type AlertRecipient, type AlertSourceItem } from '../../app/lib/alerts/due'
import { project } from '../../app/lib/schedule/project'
import { DEFAULT_PROJECT_SETTINGS } from '../../app/lib/schedule/types'
import { at, hhmm, item } from './schedule/fixtures'

// Vorwarnung fürs Team (Idee L17): wer wann für welchen Punkt eine Mitteilung bekommt.

function source(overrides: Partial<AlertSourceItem> & { id: string; start: string; min: number }): AlertSourceItem {
  const { start, min, ...rest } = overrides
  return { ...item({ start, min, ...rest }), title: rest.id, location: null, internalNote: null, visibility: 'PUBLIC', assigneeIds: [], secretViewerIds: [], ...rest }
}

const plan = () => [
  source({ id: 'reden', start: '20:45', min: 30, sortOrder: 1, assigneeIds: ['tom'] }),
  source({ id: 'tanz', start: '21:15', min: 15, sortOrder: 2, assigneeIds: ['dj'], internalNote: 'Song: Perfect' }),
  source({ id: 'ueberraschung', start: '21:30', min: 15, sortOrder: 3, visibility: 'SECRET', secretViewerIds: ['tom'], assigneeIds: ['tom'] })
]

function due(items: AlertSourceItem[], recipients: AlertRecipient[], now: Date, sent = new Map<string, Date>()) {
  const projection = project(items, now, DEFAULT_PROJECT_SETTINGS)
  if (!projection.ok) throw new Error('Schleife')
  return dueAlerts(projection.items, recipients, sent, now).map(alert => `${alert.userId}:${alert.itemId}:${alert.minutesUntil}`)
}

describe('dueAlerts', () => {
  it('nur eigene Punkte im Vorlauf-Fenster, aufgerundete Minuten', () => {
    const dj: AlertRecipient = { userId: 'dj', scope: 'MINE', leadMin: 10 }
    expect(due(plan(), [dj], at('21:04'))).toEqual([])
    expect(due(plan(), [dj], at('21:05'))).toEqual(['dj:tanz:10'])
    expect(due(plan(), [dj], new Date(at('21:14').getTime() + 30_000))).toEqual(['dj:tanz:1'])
    expect(due(plan(), [dj], at('21:15'))).toEqual([])
  })

  it('nach der Prognose, nicht nach der Planzeit', () => {
    const items = plan().map(i => (i.id === 'reden' ? { ...i, reportedDelayMin: 20 } : i))
    const dj: AlertRecipient = { userId: 'dj', scope: 'MINE', leadMin: 10 }
    expect(due(items, [dj], at('21:05'))).toEqual([]) // Tanz erst 21:35
    expect(due(items, [dj], at('21:25'))).toEqual(['dj:tanz:10'])
  })

  it('ALL: alle Punkte, SECRET nur für Eingetragene', () => {
    const lead = 60
    expect(due(plan(), [{ userId: 'dj', scope: 'ALL', leadMin: lead }], at('20:40'))).toEqual(['dj:reden:5', 'dj:tanz:35'])
    expect(due(plan(), [{ userId: 'tom', scope: 'ALL', leadMin: lead }], at('20:40'))).toEqual(['tom:reden:5', 'tom:tanz:35', 'tom:ueberraschung:50'])
    // Auch als Zuständige*r eines geheimen Punkts nur mit Eintrag.
    const leaked = plan().map(i => (i.id === 'ueberraschung' ? { ...i, secretViewerIds: [], assigneeIds: ['dj'] } : i))
    expect(due(leaked, [{ userId: 'dj', scope: 'MINE', leadMin: lead }], at('20:40'))).toEqual(['dj:tanz:35'])
  })

  it('begonnene, ausgefallene und zurückgestellte Punkte nicht', () => {
    const dj: AlertRecipient = { userId: 'dj', scope: 'MINE', leadMin: 10 }
    const started = plan().map(i => (i.id === 'tanz' ? { ...i, status: 'RUNNING' as const, actualStart: at('21:05') } : i))
    expect(due(started, [dj], at('21:06'))).toEqual([])
    for (const status of ['CANCELLED', 'DEFERRED'] as const) {
      expect(due(plan().map(i => (i.id === 'tanz' ? { ...i, status } : i)), [dj], at('21:10'))).toEqual([])
    }
  })

  it('nur einmal - außer der Punkt rutscht danach um mehr als den Vorlauf', () => {
    const dj: AlertRecipient = { userId: 'dj', scope: 'MINE', leadMin: 10 }
    const sent = new Map([[sentKey('tanz', 'dj'), at('21:15')]])
    expect(due(plan(), [dj], at('21:10'), sent)).toEqual([])
    // +10: angekündigter Beginn 21:15, jetzt 21:25 - noch im Rahmen, keine zweite Mitteilung.
    const plus10 = plan().map(i => (i.id === 'reden' ? { ...i, reportedDelayMin: 10 } : i))
    expect(due(plus10, [dj], at('21:16'), sent)).toEqual([])
    // +25: jetzt 21:40 - die alte Ankündigung stimmt nicht mehr, im neuen Fenster kommt eine neue.
    const plus25 = plan().map(i => (i.id === 'reden' ? { ...i, reportedDelayMin: 25 } : i))
    expect(due(plus25, [dj], at('21:20'), sent)).toEqual([])
    const result = project(plus25, at('21:30'), DEFAULT_PROJECT_SETTINGS)
    const again = result.ok ? dueAlerts(result.items, [dj], sent, at('21:30')) : []
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ itemId: 'tanz', minutesUntil: 10, previousStart: at('21:15') })
  })
})

describe('alertMessage', () => {
  const event = { id: 'ev1', title: 'Hochzeit' }
  it('Titel mit Minuten, Zeit mit Planzeit bei Abweichung, Ort, Notiz, Link zu „Meine Punkte“', () => {
    const items = plan().map(i => (i.id === 'reden' ? { ...i, reportedDelayMin: 10 } : i.id === 'tanz' ? { ...i, location: 'Saal' } : i))
    const projection = project(items, at('21:15'), DEFAULT_PROJECT_SETTINGS)
    const tanz = projection.ok ? projection.items.find(i => i.id === 'tanz')! : null
    expect(alertMessage(tanz!, { minutesUntil: 10, userId: 'dj' }, event, hhmm)).toEqual({
      title: 'In 10 Min: tanz',
      body: 'Hochzeit: ca. 21:25 Uhr (Plan 21:15) · Saal · Notiz: Song: Perfect',
      url: '/admin/events/ev1/team?meine=1#punkt-tanz',
      tag: 'punkt-tanz'
    })
    expect(alertMessage(tanz!, { minutesUntil: 10, userId: 'trauzeugin' }, event, hhmm).url).toBe('/admin/events/ev1/team#punkt-tanz')
  })

  it('kürzt lange Notizen', () => {
    const projection = project([source({ id: 'x', start: '21:00', min: 10, internalNote: 'a'.repeat(300) })], at('20:55'), DEFAULT_PROJECT_SETTINGS)
    const message = alertMessage(projection.ok ? projection.items[0] : (null as never), { minutesUntil: 5, userId: 'u' }, event, hhmm)
    expect(message.body.length).toBeLessThan(200)
    expect(message.body.endsWith('…')).toBe(true)
  })
})
