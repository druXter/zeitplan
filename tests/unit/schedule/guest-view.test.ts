import { describe, expect, it } from 'vitest'
import { toGuestView, DEFAULT_GUEST_SETTINGS, type GuestSettings, type GuestSourceItem, type GuestTrack } from '../../../app/lib/schedule/guest-view'
import { project } from '../../../app/lib/schedule/project'
import { DEFAULT_PROJECT_SETTINGS, type ScheduleItem } from '../../../app/lib/schedule/types'
import { at, hhmm, item, patch, weddingPlan } from './fixtures'

// toGuestView ist die EINZIGE Stelle, an der Daten für Gäste entstehen (CLAUDE.md). Geprüft werden
// Sichtbarkeit (TEAM/SECRET/interne Notizen nie in der Ausgabe), Rundung, Hysterese, Horizont und die
// Anzeige der Abweichung (docs/KONZEPT.md Abschnitt 2, "Anzeige für Gäste").

const TRACKS: GuestTrack[] = [
  { id: 'main', name: 'Ablauf', visibility: 'PUBLIC', sortOrder: 1 },
  { id: 'paar', name: 'Brautpaar', visibility: 'PUBLIC', sortOrder: 2 },
  { id: 'technik', name: 'Technik', visibility: 'TEAM', sortOrder: 3 }
]

function guest(base: ScheduleItem, extra: Partial<GuestSourceItem> = {}): GuestSourceItem {
  return {
    ...base,
    title: `Titel ${base.id}`,
    location: `Ort ${base.id}`,
    description: `Beschreibung ${base.id}`,
    internalNote: `Notiz ${base.id}`,
    visibility: 'PUBLIC',
    cancelReason: null,
    ...extra
  }
}

function view(
  items: GuestSourceItem[], now: Date, previouslyShown: Record<string, Date | null> = {},
  settings: GuestSettings = DEFAULT_GUEST_SETTINGS, tracks: GuestTrack[] = TRACKS
) {
  const projection = project(items, now, DEFAULT_PROJECT_SETTINGS)
  if (!projection.ok) throw new Error(JSON.stringify(projection.problem))
  const result = toGuestView({ items: projection.items, tracks }, previouslyShown, now, settings)
  return { ...result, get: (id: string) => result.items.find(i => i.id === id) }
}

const wedding = () => weddingPlan().map(i => guest(i))

describe('Sichtbarkeit', () => {
  const mixed = () => [
    ...wedding(),
    guest(item({ id: 'aufbau', start: '13:00', min: 60, sortOrder: 0 }), { visibility: 'TEAM', title: 'Aufbau Bühne', location: 'Hintereingang', description: 'Mikro 2 prüfen', internalNote: 'Schlüssel bei Hausmeister' }),
    guest(item({ id: 'ueberraschung', start: '18:00', min: 10, sortOrder: 6 }), { visibility: 'SECRET', title: 'Flashmob der Trauzeugen', location: 'Tanzfläche', description: 'Song: Dancing Queen', internalNote: 'Handzeichen vom DJ' }),
    guest(item({ id: 'licht', trackId: 'technik', start: '14:00', min: 30 }), { title: 'Lichtprobe', location: 'Saal', description: 'Nebelmaschine', internalNote: 'Sicherung 3' }),
    guest(item({ id: 'pause', start: '16:10', min: 10, sortOrder: 7, status: 'DEFERRED' }), { title: 'Zurückgestellte Rede', description: 'Onkel Horst' }),
    guest(item({ id: 'fremd', trackId: 'unbekannt', start: '15:00', min: 10 }), { title: 'Punkt ohne bekannte Spur' })
  ]

  it('TEAM- und SECRET-Punkte, Team-Spuren, zurückgestellte Punkte und unbekannte Spuren fehlen vollständig', () => {
    const result = view(mixed(), at('12:00'))
    expect(result.items.map(i => i.id)).toEqual(['trauung', 'sekt', 'foto', 'kaffee', 'essen'])
    expect(Object.keys(result.shown).sort()).toEqual(['essen', 'foto', 'kaffee', 'sekt', 'trauung'])

    const json = JSON.stringify(result)
    for (const secret of [
      'aufbau', 'Aufbau Bühne', 'Hintereingang', 'Mikro 2', 'Hausmeister',
      'ueberraschung', 'Flashmob', 'Tanzfläche', 'Dancing Queen', 'Handzeichen',
      'licht', 'Lichtprobe', 'Nebelmaschine', 'Sicherung', 'Technik',
      'pause', 'Zurückgestellte Rede', 'Onkel Horst', 'fremd', 'Punkt ohne bekannte Spur'
    ]) {
      expect(json, secret).not.toContain(secret)
    }
  })

  it('interne Notizen und interne Felder erscheinen auch bei öffentlichen Punkten nie', () => {
    const result = view(mixed(), at('12:00'))
    const json = JSON.stringify(result)
    expect(json).not.toContain('Notiz ')
    for (const key of ['internalNote', 'visibility', 'waitsFor', 'reportedDelayMin', 'actualStart', 'isAnchor', 'trackId', 'expectedStart', 'needsCheck', 'capped']) {
      expect(json, key).not.toContain(`"${key}"`)
    }
    expect(Object.keys(result.items[0]).sort()).toEqual(
      ['approximate', 'cancelReason', 'delayMin', 'description', 'id', 'location', 'plannedStart', 'shownStart', 'status', 'title', 'track'].sort()
    )
  })

  it('Verspätungen durch versteckte Punkte wirken, ohne dass der Punkt selbst sichtbar wird', () => {
    const items = [
      guest(item({ id: 'rede', start: '14:00', min: 30, sortOrder: 1 }), { visibility: 'SECRET', title: 'Geheime Rede' }),
      guest(item({ id: 'essen', start: '14:30', min: 60, sortOrder: 2 }))
    ]
    const result = view(patch(items, { rede: { reportedDelayMin: 20 } }) as GuestSourceItem[], at('14:00'))
    expect(result.items.map(i => i.id)).toEqual(['essen'])
    expect(hhmm(result.get('essen')!.shownStart)).toBe('14:50')
  })
})

describe('Rundung und "ca."', () => {
  it('Planzeiten bleiben minutengenau, Abweichungen werden auf 5 Minuten gerundet und als "ca." markiert', () => {
    const items = patch(wedding(), { trauung: { reportedDelayMin: 12 } }) as GuestSourceItem[]
    const result = view(items, at('13:00'))
    expect(result.get('trauung')).toMatchObject({ shownStart: at('14:10'), plannedStart: at('14:00'), approximate: true })
    expect(result.get('sekt')).toMatchObject({ shownStart: at('14:55'), approximate: true }) // 14:57 -> 14:55
    expect(result.get('kaffee')).toMatchObject({ shownStart: at('16:30'), approximate: false })

    const odd = [guest(item({ id: 'x', start: '14:47', min: 10 }))]
    expect(view(odd, at('13:00')).get('x')).toMatchObject({ shownStart: at('14:47'), approximate: false })
  })

  it('rundet auf die nächsten 5 Minuten, genau in der Mitte nach oben', () => {
    const one = (delay: number) => view(patch(wedding(), { trauung: { reportedDelayMin: delay } }) as GuestSourceItem[], at('13:00')).get('trauung')!
    expect(hhmm(one(2).shownStart)).toBe('14:00')
    expect(one(2).approximate).toBe(false) // gerundet wieder auf der Planzeit
    expect(hhmm(one(3).shownStart)).toBe('14:05')
    expect(hhmm(one(7).shownStart)).toBe('14:05')
    expect(hhmm(one(8).shownStart)).toBe('14:10')
  })

  it('rundet auch in der Nacht der Zeitumstellung korrekt (25.10.2026)', () => {
    // 02:30 Winterzeit (01:30 UTC) + 12 Minuten = 02:42 -> ca. 02:40 Winterzeit.
    const items = [guest(item({ id: 'abschied', start: '02:30', day: '2026-10-25', min: 30, reportedDelayMin: 12 }))]
    const result = view(items, new Date('2026-10-25T01:00:00.000Z'))
    expect(result.get('abschied')!.shownStart.toISOString()).toBe('2026-10-25T01:40:00.000Z')
  })

  it('"+10" nur mit showDelayToGuests, sonst nur die neue Uhrzeit', () => {
    const items = patch(wedding(), { trauung: { reportedDelayMin: 10 } }) as GuestSourceItem[]
    expect(view(items, at('13:00')).get('trauung')!.delayMin).toBeNull()
    const withDelay = view(items, at('13:00'), {}, { ...DEFAULT_GUEST_SETTINGS, showDelayToGuests: true })
    expect(withDelay.get('trauung')!.delayMin).toBe(10)
    expect(withDelay.get('kaffee')!.delayMin).toBe(0)
  })
})

describe('Hysterese', () => {
  const late = (delay: number) => patch(wedding(), { foto: { reportedDelayMin: delay } }) as GuestSourceItem[]

  it('kleine Schwankungen (< 3 Min) ändern die Anzeige nicht', () => {
    // Zuletzt gezeigt: ca. 15:40. Neue Prognose 15:42 bleibt bei 15:40, 15:43 springt auf 15:45.
    expect(hhmm(view(late(12), at('14:00'), { foto: at('15:40') }).get('foto')!.shownStart)).toBe('15:40')
    expect(hhmm(view(late(13), at('14:00'), { foto: at('15:40') }).get('foto')!.shownStart)).toBe('15:45')
    // Ohne vorherigen Wert: normal gerundet.
    expect(hhmm(view(late(12), at('14:00')).get('foto')!.shownStart)).toBe('15:40')
    expect(hhmm(view(late(12), at('14:00'), { foto: null }).get('foto')!.shownStart)).toBe('15:40')
  })

  it('eine kleine Abweichung von der Planzeit bleibt unsichtbar, solange die Planzeit gezeigt wurde', () => {
    const result = view(late(2), at('14:00'), { foto: at('15:30') })
    expect(result.get('foto')).toMatchObject({ shownStart: at('15:30'), approximate: false })
  })

  it('zurück im Plan: sofort wieder die genaue Planzeit', () => {
    const result = view(wedding(), at('14:00'), { foto: at('15:35') })
    expect(result.get('foto')).toMatchObject({ shownStart: at('15:30'), approximate: false })
  })

  it('liefert den gezeigten Beginn je Punkt zum Speichern (guestShownStart)', () => {
    const result = view(late(13), at('14:00'), { foto: at('15:40') })
    expect(result.shown.foto).toEqual(at('15:45'))
    expect(result.shown.trauung).toEqual(at('14:00'))
  })
})

describe('Horizont', () => {
  const items = () => patch(wedding(), { trauung: { reportedDelayMin: 30 } }) as GuestSourceItem[]

  it('weiter als 120 Minuten entfernt: Gäste sehen die Planzeit', () => {
    const result = view(items(), at('11:59'))
    expect(result.get('trauung')).toMatchObject({ shownStart: at('14:00'), approximate: false })
  })

  it('ab 120 Minuten vorher: die Prognose', () => {
    const result = view(items(), at('12:00'))
    expect(result.get('trauung')).toMatchObject({ shownStart: at('14:30'), approximate: true })
    // Der Sektempfang ist noch weiter weg und zeigt seine Planzeit, obwohl er mitrutscht.
    expect(result.get('sekt')).toMatchObject({ shownStart: at('14:45'), approximate: false })
  })

  it('der Horizont ist einstellbar', () => {
    const result = view(items(), at('10:00'), {}, { ...DEFAULT_GUEST_SETTINGS, guestHorizonMin: 300 })
    expect(result.get('sekt')).toMatchObject({ shownStart: at('15:15'), approximate: true })
  })
})

describe('Status, Ausfall und Reihenfolge', () => {
  it('zeigt jetzt/vorbei/kommt - auch abgeleitet ohne Meldung', () => {
    const items = patch(wedding(), { trauung: { status: 'DONE', actualStart: at('14:00'), actualEnd: at('14:45') } }) as GuestSourceItem[]
    const result = view(items, at('15:00'))
    expect(result.items.map(i => [i.id, i.status])).toEqual([
      ['trauung', 'past'], ['sekt', 'now'], ['foto', 'upcoming'], ['kaffee', 'upcoming'], ['essen', 'upcoming']
    ])
  })

  it('ausgefallene Punkte bleiben sichtbar (durchgestrichen) mit Planzeit und Grund', () => {
    const items = patch(wedding(), { sekt: { status: 'CANCELLED', cancelReason: 'Regen' } as Partial<GuestSourceItem> }) as GuestSourceItem[]
    const result = view(items, at('13:00'))
    expect(result.get('sekt')).toMatchObject({ status: 'cancelled', shownStart: at('14:45'), approximate: false, cancelReason: 'Regen' })
    expect(result.shown.sekt).toBeUndefined()
    // Ein Grund bei einem nicht ausgefallenen Punkt (alter Stand) erscheint nicht.
    const restored = patch(wedding(), { sekt: { cancelReason: 'Regen' } as Partial<GuestSourceItem> }) as GuestSourceItem[]
    expect(view(restored, at('13:00')).get('sekt')!.cancelReason).toBeNull()
  })

  it('öffentliche Spuren erscheinen chronologisch zusammengeführt, mit Namen der Spur', () => {
    const items = [
      guest(item({ id: 'torte', trackId: 'main', start: '16:00', min: 30, sortOrder: 2, waitsFor: ['foto'] })),
      guest(item({ id: 'foto', trackId: 'paar', start: '15:00', min: 60, sortOrder: 1 })),
      guest(item({ id: 'sekt', trackId: 'main', start: '15:00', min: 45, sortOrder: 1 })),
      guest(item({ id: 'brief', trackId: 'paar', start: '14:30', min: 10, sortOrder: 0 }))
    ]
    const result = view(items, at('12:00'))
    // Gleiche Zeit: Reihenfolge der Spuren (Ablauf vor Brautpaar).
    expect(result.items.map(i => [i.id, i.track])).toEqual([
      ['brief', 'Brautpaar'], ['sekt', 'Ablauf'], ['foto', 'Brautpaar'], ['torte', 'Ablauf']
    ])
  })

  it('ein gedeckelter Punkt zeigt den gedeckelten Stand', () => {
    const items = patch(wedding(), { trauung: { status: 'RUNNING', actualStart: at('14:00') } }) as GuestSourceItem[]
    const result = view(items, at('15:20'))
    // Trauung gedeckelt bis 15:15, Sekt danach - die Anzeige wächst nicht weiter mit.
    expect(result.get('sekt')).toMatchObject({ shownStart: at('15:15'), approximate: true })
    expect(view(items, at('15:40')).get('sekt')!.shownStart).toEqual(at('15:15'))
  })
})
