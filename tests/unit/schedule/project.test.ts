import { describe, expect, it } from 'vitest'
import { project } from '../../../app/lib/schedule/project'
import { DEFAULT_PROJECT_SETTINGS, type ProjectSettings, type ScheduleItem } from '../../../app/lib/schedule/types'
import { at, hhmm, item, patch, weddingPlan } from './fixtures'

// Regeln aus docs/KONZEPT.md Abschnitt 2 - je Regel ein Block, das Beispiel als Tabellentest.

function run(items: ScheduleItem[], now: Date, settings: ProjectSettings = DEFAULT_PROJECT_SETTINGS) {
  const result = project(items, now, settings)
  if (!result.ok) throw new Error(`Unerwartetes Problem: ${JSON.stringify(result.problem)}`)
  return result
}

/** { id: "14:10–14:55" } für den Vergleich mit den Tabellen im Konzept. */
function times(items: ScheduleItem[], now: Date, settings?: ProjectSettings): Record<string, string> {
  return Object.fromEntries(run(items, now, settings).items.map(i => [i.id, `${hhmm(i.expectedStart)}–${hhmm(i.expectedEnd)}`]))
}

function byId(items: ScheduleItem[], now: Date, settings?: ProjectSettings) {
  const result = run(items, now, settings)
  return { ...result, get: (id: string) => result.items.find(i => i.id === id)! }
}

describe('Beispiel aus dem Konzept (Tabellentest)', () => {
  const cases: { column: string; items: () => ScheduleItem[]; now: Date; expected: Record<string, string>; conflicts: { anchorId: string; itemId: string; overlapMin: number }[] }[] = [
    {
      column: 'Plan',
      items: weddingPlan,
      now: at('12:00'),
      expected: { trauung: '14:00–14:45', sekt: '14:45–15:30', foto: '15:30–16:00', kaffee: '16:30–18:00', essen: '18:30–20:30' },
      conflicts: []
    },
    {
      column: 'Trauung +10',
      items: () => patch(weddingPlan(), { trauung: { reportedDelayMin: 10 } }),
      now: at('13:55'),
      expected: { trauung: '14:10–14:55', sekt: '14:55–15:40', foto: '15:40–16:10', kaffee: '16:30–18:00', essen: '18:30–20:30' },
      conflicts: []
    },
    {
      column: 'Trauung endet 15:20',
      items: () => patch(weddingPlan(), { trauung: { reportedDelayMin: 10, status: 'DONE', actualStart: at('14:10'), actualEnd: at('15:20') } }),
      now: at('15:20'),
      expected: { trauung: '14:10–15:20', sekt: '15:20–16:05', foto: '16:05–16:35', kaffee: '16:35–18:05', essen: '18:30–20:30' },
      conflicts: []
    },
    {
      column: 'Kaffee endet 18:40',
      items: () => patch(weddingPlan(), {
        trauung: { status: 'DONE', actualStart: at('14:10'), actualEnd: at('15:20') },
        sekt: { status: 'DONE', actualStart: at('15:20'), actualEnd: at('16:05') },
        foto: { status: 'DONE', actualStart: at('16:05'), actualEnd: at('16:35') },
        kaffee: { status: 'DONE', actualStart: at('16:35'), actualEnd: at('18:40') }
      }),
      now: at('18:40'),
      expected: { trauung: '14:10–15:20', sekt: '15:20–16:05', foto: '16:05–16:35', kaffee: '16:35–18:40', essen: '18:30–20:30' },
      conflicts: [{ anchorId: 'essen', itemId: 'kaffee', overlapMin: 10 }]
    }
  ]

  for (const c of cases) {
    it(c.column, () => {
      const items = c.items()
      expect(times(items, c.now)).toEqual(c.expected)
      expect(run(items, c.now).conflicts).toEqual(c.conflicts)
    })
  }

  it('Kaffee läuft um 18:40 noch (ohne "beendet"): Fortschreiben bis zum Deckel, Konflikt fürs Team', () => {
    const items = patch(weddingPlan(), {
      trauung: { status: 'DONE', actualStart: at('14:10'), actualEnd: at('15:20') },
      sekt: { status: 'DONE', actualStart: at('15:20'), actualEnd: at('16:05') },
      foto: { status: 'DONE', actualStart: at('16:05'), actualEnd: at('16:35') },
      kaffee: { status: 'RUNNING', actualStart: at('16:35') }
    })
    const result = byId(items, at('18:25'))
    expect(hhmm(result.get('kaffee').expectedEnd)).toBe('18:25')
    expect(result.conflicts).toEqual([])

    const later = byId(items, at('18:40'))
    expect(hhmm(later.get('kaffee').expectedEnd)).toBe('18:35') // 18:05 + Deckel 30
    expect(later.get('kaffee').capped).toBe(true)
    expect(later.get('essen').expectedStart).toEqual(at('18:30'))
    expect(later.conflicts).toEqual([{ anchorId: 'essen', itemId: 'kaffee', overlapMin: 5 }])
  })
})

describe('Kette: Verspätung wandert weiter, Puffer schluckt', () => {
  it('eine Verspätung schiebt alle folgenden Punkte bis zum Puffer', () => {
    const items = patch(weddingPlan(), { sekt: { reportedDelayMin: 20 } })
    expect(times(items, at('12:00'))).toMatchObject({ sekt: '15:05–15:50', foto: '15:50–16:20', kaffee: '16:30–18:00' })
  })

  it('ist der Puffer aufgebraucht, wandert der Rest weiter', () => {
    const items = patch(weddingPlan(), { sekt: { reportedDelayMin: 45 } })
    expect(times(items, at('12:00'))).toMatchObject({ foto: '16:15–16:45', kaffee: '16:45–18:15' })
  })

  it('delayMin ist die Abweichung vom aktuellen Plan', () => {
    const result = byId(patch(weddingPlan(), { trauung: { reportedDelayMin: 10 } }), at('12:00'))
    expect(result.get('trauung').delayMin).toBe(10)
    expect(result.get('foto').delayMin).toBe(10)
    expect(result.get('kaffee').delayMin).toBe(0)
  })

  it('eine Meldung "im Plan" (null) nimmt die Verspätung zurück', () => {
    const items = patch(weddingPlan(), { trauung: { reportedDelayMin: null } })
    expect(times(items, at('12:00')).sekt).toBe('14:45–15:30')
  })
})

describe('Kein Vorziehen', () => {
  it('endet ein Punkt früher, beginnt der nächste trotzdem zur geplanten Zeit', () => {
    const items = patch(weddingPlan(), { trauung: { status: 'DONE', actualStart: at('14:00'), actualEnd: at('14:30') } })
    const result = byId(items, at('14:30'))
    expect(hhmm(result.get('sekt').expectedStart)).toBe('14:45')
    expect(result.get('sekt').delayMin).toBe(0)
  })

  it('"darf früher beginnen" rückt an das Ende des vorherigen Punkts', () => {
    const items = patch(weddingPlan(), {
      trauung: { status: 'DONE', actualStart: at('14:00'), actualEnd: at('14:30') },
      sekt: { mayStartEarly: true }
    })
    const result = byId(items, at('14:30'))
    expect(times(items, at('14:30')).sekt).toBe('14:30–15:15')
    expect(result.get('sekt').delayMin).toBe(-15)
    // Der Punkt danach rückt nicht mit vor (kein Vorziehen für ihn).
    expect(hhmm(result.get('foto').expectedStart)).toBe('15:30')
  })

  it('"darf früher beginnen" schließt auch einen geplanten Puffer davor (Annahme im Konzept)', () => {
    const items = patch(weddingPlan(), { kaffee: { mayStartEarly: true } })
    expect(times(items, at('12:00')).kaffee).toBe('16:00–17:30')
  })

  it('der erste Punkt einer Spur beginnt auch mit "darf früher beginnen" zur geplanten Zeit', () => {
    const items = patch(weddingPlan(), { trauung: { mayStartEarly: true } })
    expect(times(items, at('12:00')).trauung).toBe('14:00–14:45')
  })

  it('eine gemeldete Verspätung gilt auch mit "darf früher beginnen"', () => {
    const items = patch(weddingPlan(), { sekt: { mayStartEarly: true, reportedDelayMin: 10 } })
    expect(times(items, at('12:00')).sekt).toBe('14:55–15:40')
  })
})

describe('Zurückgestellt und Ausfall', () => {
  it('verbrauchen keine Zeit: ein Ausfall schluckt Verspätung', () => {
    const items = patch(weddingPlan(), { trauung: { reportedDelayMin: 30 }, sekt: { status: 'CANCELLED' } })
    // Trauung 14:30-15:15, Sekt fällt aus, Foto beginnt 15:30 wie geplant.
    expect(times(items, at('12:00'))).toMatchObject({ trauung: '14:30–15:15', foto: '15:30–16:00' })
  })

  it('zurückgestellte Punkte zählen nicht in der Kette', () => {
    const items = patch(weddingPlan(), { trauung: { reportedDelayMin: 30 }, sekt: { status: 'DEFERRED' } })
    expect(times(items, at('12:00')).foto).toBe('15:30–16:00')
  })

  it('behalten ihre Planzeit und die passende Phase', () => {
    const result = byId(patch(weddingPlan(), { sekt: { status: 'DEFERRED', reportedDelayMin: 10 }, foto: { status: 'CANCELLED' } }), at('12:00'))
    expect(result.get('sekt')).toMatchObject({ phase: 'deferred', expectedStart: at('14:45'), expectedEnd: at('15:30'), delayMin: 0 })
    expect(result.get('foto')).toMatchObject({ phase: 'cancelled', expectedStart: at('15:30'), delayMin: 0 })
  })

  it('wer auf einen ausgefallenen Punkt wartet, wartet nicht mehr', () => {
    const items = [
      item({ id: 'a', trackId: 'A', start: '14:00', min: 60, status: 'CANCELLED' }),
      item({ id: 'b', trackId: 'B', start: '14:30', min: 30, waitsFor: ['a'] })
    ]
    expect(times(items, at('12:00')).b).toBe('14:30–15:00')
  })
})

describe('Anker', () => {
  it('rutschen nicht mit - weder durch die Kette noch durch Zusammenführung', () => {
    const items = [
      ...patch(weddingPlan(), { kaffee: { reportedDelayMin: 20 } }),
      item({ id: 'band', trackId: 'technik', start: '17:00', min: 120 })
    ].map(i => (i.id === 'essen' ? { ...i, waitsFor: ['band'] } : i))
    const result = byId(items, at('12:00'))
    expect(result.get('essen').expectedStart).toEqual(at('18:30'))
    // Kaffee bis 18:20 passt, die Band (bis 19:00) überschneidet sich.
    expect(result.conflicts).toEqual([{ anchorId: 'essen', itemId: 'band', overlapMin: 30 }])
  })

  it('eine gemeldete Verspätung verschiebt auch einen Anker', () => {
    const result = byId(patch(weddingPlan(), { essen: { reportedDelayMin: 15 } }), at('12:00'))
    expect(hhmm(result.get('essen').expectedStart)).toBe('18:45')
  })

  it('der Punkt nach einem Anker startet nach dessen Ende', () => {
    const items = [...weddingPlan(), item({ id: 'tanz', start: '20:00', min: 60, sortOrder: 6 })]
    expect(times(items, at('12:00')).tanz).toBe('20:30–21:30')
  })

  it('kein Konflikt mehr, sobald der Anker begonnen hat', () => {
    const items = patch(weddingPlan(), {
      kaffee: { status: 'RUNNING', actualStart: at('16:30'), reportedDelayMin: 45 },
      essen: { status: 'RUNNING', actualStart: at('18:35') }
    })
    const result = byId(items, at('18:36'))
    expect(result.conflicts).toEqual([])
    expect(hhmm(result.get('essen').expectedStart)).toBe('18:35')
  })
})

describe('Fortschreiben', () => {
  const running = () => patch(weddingPlan(), { trauung: { status: 'RUNNING', actualStart: at('14:00') } })

  it('solange der laufende Punkt nicht überzogen ist, gilt seine geplante Dauer', () => {
    const result = byId(running(), at('14:30'))
    expect(result.get('trauung')).toMatchObject({ expectedEnd: at('14:45'), overrun: false, capped: false, needsCheck: false })
  })

  it('ein überzogener Punkt wächst live mit, die folgenden rutschen', () => {
    const result = byId(running(), at('14:52'))
    expect(result.get('trauung')).toMatchObject({ expectedEnd: at('14:52'), overrun: true, capped: false, needsCheck: true })
    expect(hhmm(result.get('sekt').expectedStart)).toBe('14:52')
  })

  it('Nachfrage erst nach creepNudgeMin Minuten', () => {
    expect(byId(running(), at('14:49')).get('trauung').needsCheck).toBe(false)
    expect(byId(running(), at('14:50')).get('trauung').needsCheck).toBe(true)
  })

  it('nach dem Deckel wächst nichts mehr', () => {
    const result = byId(running(), at('16:00'))
    expect(result.get('trauung')).toMatchObject({ expectedEnd: at('15:15'), overrun: true, capped: true })
  })

  it('ohne Fortschreiben bleibt die geplante Dauer stehen, überzogen ist er trotzdem', () => {
    const result = byId(running(), at('15:00'), { ...DEFAULT_PROJECT_SETTINGS, autoCreep: false })
    expect(result.get('trauung')).toMatchObject({ expectedEnd: at('14:45'), overrun: true, capped: false, needsCheck: true })
    expect(hhmm(result.get('sekt').expectedStart)).toBe('14:45')
  })

  it('eine Meldung am laufenden Punkt verlängert ihn - ohne die Verspätung vom Start doppelt zu zählen', () => {
    // +10 vor dem Start, dann um 14:10 gestartet: Ende weiterhin 14:55, nicht 15:05.
    const started = patch(weddingPlan(), { trauung: { status: 'RUNNING', actualStart: at('14:10'), reportedDelayMin: 10 } })
    expect(byId(started, at('14:20')).get('trauung').expectedEnd).toEqual(at('14:55'))
    // "+5" während er läuft (Meldung jetzt 15 gegenüber dem Plan): Ende 15:00, Deckel zählt ab dort.
    const extended = patch(started, { trauung: { reportedDelayMin: 15 } })
    expect(byId(extended, at('14:58')).get('trauung')).toMatchObject({ expectedEnd: at('15:00'), overrun: false })
    expect(byId(extended, at('16:00')).get('trauung').expectedEnd).toEqual(at('15:30'))
  })
})

describe('Phasen', () => {
  it('leitet "jetzt" und "vorbei" aus der Uhr ab, wenn nichts gemeldet ist', () => {
    const before = byId(weddingPlan(), at('13:00'))
    expect(before.get('trauung')).toMatchObject({ phase: 'upcoming', confirmed: false, unconfirmed: false })
    const during = byId(weddingPlan(), at('14:10'))
    expect(during.get('trauung')).toMatchObject({ phase: 'now', confirmed: false, unconfirmed: true })
    const after = byId(weddingPlan(), at('14:50'))
    expect(after.get('trauung')).toMatchObject({ phase: 'past', confirmed: false, unconfirmed: true })
    expect(after.get('sekt')).toMatchObject({ phase: 'now', confirmed: false })
  })

  it('gemeldete Zustände haben Vorrang vor der Uhr', () => {
    const items = patch(weddingPlan(), {
      trauung: { status: 'DONE', actualStart: at('14:00'), actualEnd: at('14:20') },
      sekt: { status: 'RUNNING', actualStart: at('14:20') }
    })
    const result = byId(items, at('14:25'))
    expect(result.get('trauung')).toMatchObject({ phase: 'past', confirmed: true, unconfirmed: false })
    expect(result.get('sekt')).toMatchObject({ phase: 'now', confirmed: true, expectedStart: at('14:20') })
  })
})

describe('Spuren und Zusammenführung', () => {
  const tracks = () => [
    item({ id: 'foto', trackId: 'paar', start: '15:00', min: 60, sortOrder: 1 }),
    item({ id: 'sekt', trackId: 'gaeste', start: '15:00', min: 45, sortOrder: 1 }),
    item({ id: 'spiele', trackId: 'gaeste', start: '15:45', min: 30, sortOrder: 2 }),
    item({ id: 'torte', trackId: 'gaeste', start: '16:15', min: 30, sortOrder: 3, waitsFor: ['foto', 'sekt'] })
  ]

  it('jede Spur hat ihre eigene Kette', () => {
    const items = patch(tracks(), { foto: { reportedDelayMin: 10 } })
    expect(times(items, at('12:00'))).toMatchObject({ foto: '15:10–16:10', sekt: '15:00–15:45', spiele: '15:45–16:15' })
  })

  it('ein Punkt wartet auf den spätesten seiner Vorgänger aus anderen Spuren', () => {
    const items = patch(tracks(), { foto: { reportedDelayMin: 40 } })
    // Foto 15:40-16:40: Die Torte wartet darauf, obwohl die eigene Spur schon 16:15 frei wäre.
    expect(times(items, at('12:00')).torte).toBe('16:40–17:10')
    const onlySekt = patch(tracks(), { sekt: { reportedDelayMin: 50 } })
    // Sekt 15:50-16:35, Spiele danach bis 17:05 - die eigene Spur ist hier das Späteste.
    expect(times(onlySekt, at('12:00')).torte).toBe('17:05–17:35')
  })

  it('die Reihenfolge der Eingabe spielt keine Rolle', () => {
    const items = patch(tracks(), { foto: { reportedDelayMin: 40 } })
    expect(times([...items].reverse(), at('12:00'))).toEqual(times(items, at('12:00')))
    expect(run([...items].reverse(), at('12:00')).items.map(i => i.id)).toEqual(['torte', 'spiele', 'sekt', 'foto'])
  })

  it('reicht zusätzliche Felder der Eingabe unverändert durch', () => {
    const items = tracks().map(i => ({ ...i, title: `Titel ${i.id}` }))
    const result = project(items, at('12:00'), DEFAULT_PROJECT_SETTINGS)
    expect(result.ok && result.items.map(i => i.title)).toEqual(['Titel foto', 'Titel sekt', 'Titel spiele', 'Titel torte'])
  })
})

describe('Zyklen und ungültige Abhängigkeiten', () => {
  it('erkennt einen Zyklus über Zusammenführungen', () => {
    const items = [
      item({ id: 'a', trackId: 'A', start: '14:00', min: 30, waitsFor: ['b'] }),
      item({ id: 'b', trackId: 'B', start: '14:00', min: 30, waitsFor: ['a'] })
    ]
    const result = project(items, at('12:00'), DEFAULT_PROJECT_SETTINGS)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problem.kind).toBe('cycle')
    expect(!result.ok && result.problem.kind === 'cycle' && [...result.problem.itemIds].sort()).toEqual(['a', 'b'])
  })

  it('erkennt einen Zyklus, der erst mit der Reihenfolge der Spuren entsteht', () => {
    const items = [
      item({ id: 'a1', trackId: 'A', start: '14:00', min: 30, sortOrder: 1 }),
      item({ id: 'a2', trackId: 'A', start: '14:30', min: 30, sortOrder: 2, waitsFor: ['b2'] }),
      item({ id: 'b1', trackId: 'B', start: '14:00', min: 30, sortOrder: 1, waitsFor: ['a2'] }),
      item({ id: 'b2', trackId: 'B', start: '14:30', min: 30, sortOrder: 2 })
    ]
    const result = project(items, at('12:00'), DEFAULT_PROJECT_SETTINGS)
    expect(!result.ok && result.problem).toMatchObject({ kind: 'cycle' })
    expect(!result.ok && result.problem.kind === 'cycle' && [...result.problem.itemIds].sort()).toEqual(['a2', 'b1', 'b2'])
  })

  it('ein Punkt, der auf einen späteren Punkt seiner eigenen Spur wartet, ist ein Zyklus', () => {
    const items = [
      item({ id: 'a', start: '14:00', min: 30, sortOrder: 1, waitsFor: ['b'] }),
      item({ id: 'b', start: '14:30', min: 30, sortOrder: 2 })
    ]
    expect(project(items, at('12:00'), DEFAULT_PROJECT_SETTINGS).ok).toBe(false)
  })

  it('ein Punkt, der auf sich selbst wartet, ist ein Zyklus', () => {
    const result = project([item({ id: 'a', start: '14:00', min: 30, waitsFor: ['a'] })], at('12:00'), DEFAULT_PROJECT_SETTINGS)
    expect(!result.ok && result.problem).toEqual({ kind: 'cycle', itemIds: ['a'] })
  })

  it('unbekannte Abhängigkeiten werden gemeldet statt ignoriert', () => {
    const result = project([item({ id: 'a', start: '14:00', min: 30, waitsFor: ['gibt-es-nicht'] })], at('12:00'), DEFAULT_PROJECT_SETTINGS)
    expect(!result.ok && result.problem).toEqual({ kind: 'unknown', itemId: 'a', waitsForId: 'gibt-es-nicht' })
  })

  it('auch ein Zyklus über zurückgestellte Punkte wird abgelehnt (er entstünde beim Wiedereinreihen)', () => {
    const items = [
      item({ id: 'a', trackId: 'A', start: '14:00', min: 30, waitsFor: ['b'], status: 'DEFERRED' }),
      item({ id: 'b', trackId: 'B', start: '14:00', min: 30, waitsFor: ['a'] })
    ]
    expect(project(items, at('12:00'), DEFAULT_PROJECT_SETTINGS).ok).toBe(false)
  })
})

describe('Mitternacht und Zeitumstellung', () => {
  it('rechnet über Mitternacht weiter - Reihenfolge nach Plan, nicht nach Uhrzeit', () => {
    const items = [
      item({ id: 'party', start: '22:00', min: 120, sortOrder: 1, reportedDelayMin: 20 }),
      item({ id: 'mitternachtssnack', start: '00:00', day: '2026-06-21', min: 30, sortOrder: 2 }),
      item({ id: 'feuerwerk', start: '00:45', day: '2026-06-21', min: 15, sortOrder: 3 })
    ]
    const result = byId(items, at('21:00'))
    expect(result.get('mitternachtssnack').expectedStart.toISOString()).toBe('2026-06-20T22:20:00.000Z') // 00:20 Uhr
    expect(result.get('mitternachtssnack').delayMin).toBe(20)
    expect(result.get('feuerwerk').expectedStart.toISOString()).toBe('2026-06-20T22:50:00.000Z') // 00:50 Uhr
  })

  it('am 25.10.2026 zählen Dauern echte Minuten über die Zeitumstellung hinweg', () => {
    // 01:30 Sommerzeit (23:30 UTC) + 90 Minuten = 02:00 Winterzeit (01:00 UTC) - auf der Wanduhr nur 30 Minuten später.
    const items = [
      item({ id: 'tanz', start: '01:30', day: '2026-10-25', min: 90, sortOrder: 1 }),
      // "02:30" ist doppelt - zonedInputToUtc nimmt die spätere (Winterzeit, 01:30 UTC).
      item({ id: 'abschied', start: '02:30', day: '2026-10-25', min: 30, sortOrder: 2 })
    ]
    const now = at('01:00', '2026-10-25')
    const result = byId(items, now)
    expect(result.get('tanz').expectedStart.toISOString()).toBe('2026-10-24T23:30:00.000Z')
    expect(result.get('tanz').expectedEnd.toISOString()).toBe('2026-10-25T01:00:00.000Z')
    expect(result.get('abschied').expectedStart.toISOString()).toBe('2026-10-25T01:30:00.000Z')

    // 40 Minuten Verspätung: Ende 01:40 UTC, der Abschied rutscht um 10 Minuten.
    const late = byId(patch(items, { tanz: { reportedDelayMin: 40 } }), now)
    expect(late.get('abschied').expectedStart.toISOString()).toBe('2026-10-25T01:40:00.000Z')
    expect(late.get('abschied').delayMin).toBe(10)
  })

  it('Fortschreiben über die Zeitumstellung: der Deckel sind echte 30 Minuten', () => {
    const items = [item({ id: 'tanz', start: '01:30', day: '2026-10-25', min: 60, status: 'RUNNING', actualStart: at('01:30', '2026-10-25') })]
    // Geplantes Ende 00:30 UTC (02:30 Sommerzeit), um 03:00 Winterzeit (02:00 UTC) gedeckelt auf 01:00 UTC.
    const result = byId(items, new Date('2026-10-25T02:00:00.000Z'))
    expect(result.get('tanz')).toMatchObject({ expectedEnd: new Date('2026-10-25T01:00:00.000Z'), capped: true })
  })
})
