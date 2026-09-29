import { describe, expect, it } from 'vitest'
import { buildExport, EXPORT_FORMAT, materializePlan, parseExport, type PlanExport } from '../../../app/lib/planning/exchange'
import { redactItem, type StoredItem } from '../../../app/lib/planning/items'
import { WEDDING_TEMPLATE } from '../../../app/lib/planning/template'
import { DEFAULT_EVENT_OPTIONS } from '../../../app/lib/events/settings'
import { utcToZonedInput, zonedDateToUtc } from '../../../app/lib/timezone'

function stored(overrides: Partial<StoredItem> & { id: string }): StoredItem {
  return {
    trackId: 't1', sortOrder: 1, title: 'Punkt', location: null, description: null, internalNote: null,
    visibility: 'PUBLIC', isAnchor: false, mayStartEarly: false, plannedStart: new Date('2026-06-20T12:00:00Z'),
    plannedDurationMin: 30, status: 'PLANNED', insertedLive: false, actualStart: null, actualEnd: null,
    reportedDelayMin: null, cancelReason: null, version: 1, waitsFor: [], secretViewerIds: [], ...overrides
  }
}

const event = { title: 'Hochzeit', description: 'Im Garten', date: zonedDateToUtc('2026-06-20')!, timezone: 'Europe/Berlin', ...DEFAULT_EVENT_OPTIONS }
const tracks = [
  { id: 't2', name: 'Brautpaar', visibility: 'PUBLIC' as const, sortOrder: 2 },
  { id: 't1', name: 'Ablauf', visibility: 'PUBLIC' as const, sortOrder: 1 }
]

function clone(value: PlanExport): Record<string, unknown> & PlanExport {
  return JSON.parse(JSON.stringify(value))
}

describe('buildExport', () => {
  const items = [
    stored({ id: 'b', sortOrder: 2, title: 'Sekt', plannedStart: new Date('2026-06-20T12:45:00Z'), waitsFor: ['s'], internalNote: 'Tablett' }),
    stored({ id: 'a', sortOrder: 1, title: 'Trauung', location: 'Kirche', isAnchor: true }),
    stored({ id: 's', trackId: 't2', title: 'Shooting', plannedStart: new Date('2026-06-20T12:15:00Z') }),
    stored({ id: 'g', sortOrder: 3, title: 'Überraschung', description: 'Feuerwerk', visibility: 'SECRET', secretViewerIds: ['u1'], plannedStart: new Date('2026-06-20T13:30:00Z') })
  ]

  it('Schlüssel statt ids, Kette in Reihenfolge, Zeiten mit Versatz, keine Live-Felder', () => {
    const file = buildExport(event, tracks, items.map(i => redactItem(i, 'u1')))
    expect(file.tracks).toEqual([{ key: 'spur-1', name: 'Ablauf', visibility: 'PUBLIC' }, { key: 'spur-2', name: 'Brautpaar', visibility: 'PUBLIC' }])
    expect(file.items.map(i => [i.key, i.title, i.start])).toEqual([
      ['punkt-1', 'Trauung', '2026-06-20T14:00:00+02:00'],
      ['punkt-2', 'Sekt', '2026-06-20T14:45:00+02:00'],
      ['punkt-3', 'Überraschung', '2026-06-20T15:30:00+02:00'],
      ['punkt-4', 'Shooting', '2026-06-20T14:15:00+02:00']
    ])
    expect(file.items[1]).toMatchObject({ waitsFor: ['punkt-4'], internalNote: 'Tablett' })
    const serialized = JSON.stringify(file)
    for (const leaked of ['"a"', '"t1"', 'version', 'actualStart', 'secretViewer', 'u1']) expect(serialized).not.toContain(leaked)
  })

  it('geheime Punkte ohne Eintrag nur als Platzhalter', () => {
    const file = buildExport(event, tracks, items.map(i => redactItem(i, 'owner')))
    expect(file.items[2]).toEqual({
      key: 'punkt-3', track: 'spur-1', title: 'Geheimer Punkt', visibility: 'SECRET', isAnchor: false, mayStartEarly: false,
      start: '2026-06-20T15:30:00+02:00', durationMin: 30, waitsFor: []
    })
    expect(JSON.stringify(file)).not.toMatch(/Überraschung|Feuerwerk/)
  })

  it('übersteht den eigenen Import unverändert', () => {
    const file = buildExport(event, tracks, items.map(i => redactItem(i, 'u1')))
    const parsed = parseExport(clone(file))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.plan.title).toBe('Hochzeit')
    expect(parsed.plan.items).toHaveLength(4)
    expect(parsed.plan.items[0]).toMatchObject({ key: 'punkt-1', location: 'Kirche', isAnchor: true, start: new Date('2026-06-20T12:00:00Z') })
  })
})

describe('parseExport lehnt ab', () => {
  const base = () => clone(WEDDING_TEMPLATE)

  it('fremde Dateien und falsche Version', () => {
    expect(parseExport({ format: 'seating-plan' })).toEqual({ ok: false, errors: ['Das ist keine Ablauf-Datei dieses Tools.'] })
    expect(parseExport(null).ok).toBe(false)
    expect(parseExport({ ...base(), schemaVersion: 2 }).ok).toBe(false)
  })

  it('ungültige Werte mit Pfad', () => {
    const file = base()
    ;(file.items[0] as unknown as Record<string, unknown>).durationMin = -1
    const parsed = parseExport(file)
    expect(parsed).toEqual({ ok: false, errors: ['Ungültiger Wert bei „items.0.durationMin“.'] })
  })

  it('unbekannte Felder (z. B. ids oder Live-Stand)', () => {
    const file = base()
    ;(file.items[0] as unknown as Record<string, unknown>).actualStart = '2026-06-20T14:00:00+02:00'
    expect(parseExport(file).ok).toBe(false)
  })

  it('doppelte Schlüssel, fehlende Spuren und Punkte, Selbstbezug', () => {
    const file = base()
    file.items[1].key = file.items[0].key
    file.items[2].track = 'gibt-es-nicht'
    file.items[3].waitsFor = ['fehlt']
    file.items[5].waitsFor = [file.items[5].key]
    const parsed = parseExport(file)
    expect(!parsed.ok && parsed.errors).toEqual([
      'Punkt „ankunft“ kommt doppelt vor.',
      'Punkt „Sektempfang & Gratulation“: Die Spur „gibt-es-nicht“ gibt es nicht.',
      'Punkt „Gruppenfoto“: wartet auf „fehlt“, den es nicht gibt.',
      'Punkt „Kaffee & Kuchen“: wartet auf sich selbst.'
    ])
  })

  it('Kreise in "wartet auf", auch über die Reihenfolge der Spuren', () => {
    const file = base()
    // Shooting (Brautpaar) wartet auf den Kaffee, die Torte davor wartet auf das Shooting.
    file.items.find(i => i.key === 'shooting')!.waitsFor = ['kaffee']
    const parsed = parseExport(file)
    expect(!parsed.ok && parsed.errors).toEqual(['„Wartet auf“ ergibt eine Schleife: Anschnitt der Hochzeitstorte → Fotoshooting Brautpaar → Kaffee & Kuchen.'])
  })

  it('Beginn weit weg vom Eventtag, fremde Zeitzone, leerer Titel', () => {
    const far = base()
    far.items[0].start = '2026-07-20T14:00:00+02:00'
    expect(!parseExport(far).ok && (parseExport(far) as { errors: string[] }).errors[0]).toMatch(/Beginn liegt nicht/)
    expect(parseExport({ ...base(), timezone: 'America/New_York' }).ok).toBe(false)
    const blank = base()
    blank.items[0].title = '  \u0007 '
    expect(parseExport(blank).ok).toBe(false)
  })

  it('zu viele Punkte', () => {
    const file = base()
    file.items = Array.from({ length: 301 }, (_, i) => ({ ...file.items[0], key: `p${i}` }))
    expect(parseExport(file).ok).toBe(false)
  })
})

describe('Vorlage "Hochzeit" und materializePlan', () => {
  it('die Vorlage besteht die Import-Prüfung', () => {
    const parsed = parseExport(clone(WEDDING_TEMPLATE))
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.plan.items.filter(i => i.visibility === 'SECRET')).toHaveLength(1)
  })

  it('landet auf dem gewählten Tag mit gleichen Uhrzeiten - auch in der Nacht der Zeitumstellung', () => {
    const parsed = parseExport(clone(WEDDING_TEMPLATE))
    if (!parsed.ok) throw new Error('Vorlage ungültig')
    const plan = materializePlan(parsed.plan, zonedDateToUtc('2026-10-24')!)
    const local = (key: string) => utcToZonedInput(plan.items.find(i => i.key === key)!.plannedStart)
    expect(local('trauung')).toBe('2026-10-24T14:00')
    expect(local('snack')).toBe('2026-10-25T00:45')
    expect(local('abbau')).toBe('2026-10-25T03:00')
    // Ausklang 01:15 + 105 Min endet in echter Zeit um 02:00 Winterzeit (die Stunde 02-03 gibt es zweimal).
    expect(plan.items.find(i => i.key === 'ausklang')!.plannedDurationMin).toBe(105)
    expect(plan.tracks.map(t => [t.key, t.sortOrder])).toEqual([['ablauf', 1], ['brautpaar', 2], ['team', 3]])
    expect(plan.items.filter(i => i.track === 'ablauf').map(i => i.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(plan.items.find(i => i.key === 'shooting')!.sortOrder).toBe(1)
  })

  it('Format-Kennung', () => {
    expect(WEDDING_TEMPLATE.format).toBe(EXPORT_FORMAT)
  })
})
