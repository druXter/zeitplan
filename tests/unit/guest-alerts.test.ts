import { describe, expect, it } from 'vitest'
import { dueGuestAlerts, guestAlertMessage, guestSubscriptionActive, sentKey, type GuestAlertSettings } from '../../app/lib/guest-alerts/due'
import { toGuestView, DEFAULT_GUEST_SETTINGS, type GuestAlertMode, type GuestSourceItem, type GuestTrack } from '../../app/lib/schedule/guest-view'
import { project } from '../../app/lib/schedule/project'
import { DEFAULT_PROJECT_SETTINGS } from '../../app/lib/schedule/types'
import { guestReminders, reminderSummary } from '../../app/lib/guest/payload'
import { parseGuestAlertOptions } from '../../app/lib/events/settings'
import { at, hhmm, item } from './schedule/fixtures'

// Erinnerungen für Gäste (Idee L12): welche Punkte eine Erinnerung haben (toGuestView), wann was fällig ist
// (dueGuestAlerts), was in der Mitteilung steht und welche Gäste-Abos noch gelten.

const TRACKS: GuestTrack[] = [
  { id: 'main', name: 'Ablauf', visibility: 'PUBLIC', sortOrder: 1 },
  { id: 'technik', name: 'Technik', visibility: 'TEAM', sortOrder: 2 }
]

function source(overrides: Parameters<typeof item>[0] & Partial<GuestSourceItem>): GuestSourceItem {
  const { title, location, description, internalNote, visibility, cancelReason, guestAlert, ...rest } = overrides
  return {
    ...item(rest),
    title: title ?? rest.id ?? 'Punkt', location: location ?? null, description: description ?? null, internalNote: internalNote ?? 'Notiz',
    visibility: visibility ?? 'PUBLIC', cancelReason: cancelReason ?? null, guestAlert
  }
}

const plan = () => [
  source({ id: 'reden', start: '20:30', min: 30, sortOrder: 1 }),
  source({ id: 'torte', start: '21:00', min: 15, sortOrder: 2, guestAlert: true, location: 'Saal' }),
  source({ id: 'tanz', start: '21:15', min: 15, sortOrder: 3 }),
  source({ id: 'aufbau', start: '21:30', min: 15, sortOrder: 4, visibility: 'TEAM', guestAlert: true }),
  source({ id: 'licht', trackId: 'technik', start: '21:00', min: 15, guestAlert: true }),
  source({ id: 'feuerwerk', start: '22:00', min: 15, sortOrder: 5, guestAlert: true, status: 'CANCELLED' })
]

function view(items: GuestSourceItem[], now: Date, mode: GuestAlertMode = 'MARKED') {
  const projection = project(items, now, DEFAULT_PROJECT_SETTINGS)
  if (!projection.ok) throw new Error('Schleife')
  return toGuestView({ items: projection.items, tracks: TRACKS }, {}, now, { ...DEFAULT_GUEST_SETTINGS, guestAlerts: mode })
}

const reminded = (items: GuestSourceItem[], now: Date, mode: GuestAlertMode) => view(items, now, mode).items.filter(i => i.reminder).map(i => i.id)

describe('toGuestView: reminder', () => {
  it('MARKED nur markierte, ALL alle sichtbaren, OFF keine - nie TEAM, Team-Spur oder ausgefallene', () => {
    expect(reminded(plan(), at('20:00'), 'MARKED')).toEqual(['torte'])
    expect(reminded(plan(), at('20:00'), 'ALL')).toEqual(['reden', 'torte', 'tanz'])
    expect(reminded(plan(), at('20:00'), 'OFF')).toEqual([])
    expect(view(plan(), at('20:00'), 'ALL').items.find(i => i.id === 'feuerwerk')?.reminder).toBe(false)
  })

  it('ohne Einstellung (ältere Aufrufer) keine Erinnerungen', () => {
    const projection = project(plan(), at('20:00'), DEFAULT_PROJECT_SETTINGS)
    if (!projection.ok) throw new Error('Schleife')
    expect(toGuestView({ items: projection.items, tracks: TRACKS }, {}, at('20:00'), DEFAULT_GUEST_SETTINGS).items.some(i => i.reminder)).toBe(false)
  })
})

const LIVE: GuestAlertSettings = { leadMin: 10, shiftMin: 30, live: true }

function due(items: GuestSourceItem[], now: Date, settings = LIVE, sent = new Map<string, Date>(), announced = new Map<string, Date>()) {
  return dueGuestAlerts(view(items, now).items, announced, sent, settings, now).map(alert => `${alert.kind}:${alert.itemId}:${alert.minutesUntil}:${hhmm(alert.start)}`)
}

describe('dueGuestAlerts', () => {
  it('START im Vorlauf-Fenster, aufgerundete Minuten, nur Punkte mit Erinnerung', () => {
    expect(due(plan(), at('20:49'))).toEqual([])
    expect(due(plan(), at('20:50'))).toEqual(['START:torte:10:21:00'])
    expect(due(plan(), new Date(at('20:59').getTime() + 30_000))).toEqual(['START:torte:1:21:00'])
    expect(due(plan(), at('21:00'))).toEqual([])
  })

  it('nach der Zeit, die Gäste sehen: Prognose, gerundet', () => {
    // Reden 17 Minuten später: Torte erwartet 21:17, Gäste sehen "ca. 21:15".
    const items = plan().map(i => (i.id === 'reden' ? { ...i, reportedDelayMin: 17 } : i))
    expect(due(items, at('20:50'), { ...LIVE, shiftMin: null })).toEqual([])
    expect(due(items, at('21:05'), { ...LIVE, shiftMin: null })).toEqual(['START:torte:10:21:15'])
  })

  it('einmal je Punkt; rutscht er um mehr als den Vorlauf, kommt eine neue', () => {
    const sent = new Map([[sentKey('torte', 'START'), at('21:00')]])
    expect(due(plan(), at('20:55'), LIVE, sent)).toEqual([])
    const items = plan().map(i => (i.id === 'reden' ? { ...i, reportedDelayMin: 15 } : i))
    expect(due(items, at('21:06'), LIVE, sent)).toEqual(['START:torte:9:21:15'])
    const slightly = plan().map(i => (i.id === 'reden' ? { ...i, reportedDelayMin: 10 } : i))
    expect(due(slightly, at('21:01'), LIVE, sent)).toEqual([])
  })

  it('SHIFT nur live, ab der Schwelle, außerhalb des Vorlaufs - gemessen an der zuletzt bekannten Zeit', () => {
    const late = plan().map(i => (i.id === 'reden' ? { ...i, reportedDelayMin: 30 } : i))
    expect(due(late, at('20:35'))).toEqual(['SHIFT:torte:55:21:30'])
    expect(due(late, at('20:35'), { ...LIVE, live: false })).toEqual([])
    expect(due(late, at('20:35'), { ...LIVE, shiftMin: null })).toEqual([])
    expect(due(late, at('20:35'), { ...LIVE, shiftMin: 45 })).toEqual([])
    // Schon gemeldet: erst die nächste Verschiebung um die Schwelle zählt.
    const sent = new Map([[sentKey('torte', 'SHIFT'), at('21:30')]])
    expect(due(late, at('20:35'), LIVE, sent)).toEqual([])
    // Beim Live-Schalten stand die Torte auf 20:45 (Ursprungsplan) - Gäste kennen diese Zeit, nicht den heutigen Plan.
    const moved = plan().map(i => (i.id === 'torte' ? { ...i, plannedStart: at('21:00') } : i))
    expect(due(moved, at('20:00'), LIVE, new Map(), new Map([['torte', at('20:30')]]))).toEqual(['SHIFT:torte:60:21:00'])
    expect(due(moved, at('20:00'), LIVE, new Map(), new Map([['torte', at('20:45')]]))).toEqual([])
  })

  it('im Vorlauf übernimmt die Erinnerung statt "Neue Zeit"', () => {
    const late = plan().map(i => (i.id === 'reden' ? { ...i, reportedDelayMin: 30 } : i))
    expect(due(late, at('21:20'))).toEqual(['START:torte:10:21:30'])
  })
})

describe('guestAlertMessage', () => {
  const event = { slug: 'anna-ben', title: 'Hochzeit Anna & Ben' }
  const clock = hhmm

  it('Erinnerung mit Zeit und Ort, Link zur Gästeansicht beim Punkt - ohne interne Notiz', () => {
    const item = { id: 'torte', title: 'Torte', location: 'Saal', approximate: true }
    const message = guestAlertMessage(item, { kind: 'START', start: at('21:15'), minutesUntil: 10, before: null }, event, clock)
    expect(message).toEqual({ title: 'In 10 Min: Torte', body: 'Hochzeit Anna & Ben: ca. 21:15 Uhr · Saal', url: '/anna-ben#punkt-torte', tag: 'gast-torte' })
    expect(JSON.stringify(message)).not.toContain('Notiz')
  })

  it('Neue Zeit nennt die alte', () => {
    const item = { id: 'essen', title: 'Abendessen', location: null, approximate: true }
    const message = guestAlertMessage(item, { kind: 'SHIFT', start: at('19:30'), minutesUntil: 50, before: at('19:00') }, event, clock)
    expect(message.title).toBe('Neue Zeit: Abendessen')
    expect(message.body).toBe('Hochzeit Anna & Ben: jetzt ca. 19:30 Uhr statt 19:00 Uhr')
  })
})

describe('guestSubscriptionActive', () => {
  const now = at('20:00')
  const later = at('23:00')
  const earlier = at('19:00')
  const base = { expiresAt: later, guestSession: null, session: null }

  it('öffentlich jedes Abo bis zum Ablauf', () => {
    expect(guestSubscriptionActive('PUBLIC', base, now)).toBe(true)
    expect(guestSubscriptionActive('PUBLIC', { ...base, expiresAt: earlier }, now)).toBe(false)
  })

  it('Zugangscode und rsvp nur mit passender, gültiger Gast-Sitzung', () => {
    const code = { ...base, guestSession: { expiresAt: later, rsvpId: null } }
    const rsvp = { ...base, guestSession: { expiresAt: later, rsvpId: 'z1' } }
    expect(guestSubscriptionActive('CODE', base, now)).toBe(false)
    expect(guestSubscriptionActive('CODE', code, now)).toBe(true)
    expect(guestSubscriptionActive('CODE', rsvp, now)).toBe(false)
    expect(guestSubscriptionActive('RSVP', rsvp, now)).toBe(true)
    expect(guestSubscriptionActive('RSVP', code, now)).toBe(false)
    expect(guestSubscriptionActive('CODE', { ...base, guestSession: { expiresAt: earlier, rsvpId: null } }, now)).toBe(false)
  })

  it('Konto-Sitzung: bei "nur mit Konto" jedes Konto, sonst nur mit Zugriff aufs Event', () => {
    const account = { ...base, session: { expiresAt: later, eventAccess: false } }
    const team = { ...base, session: { expiresAt: later, eventAccess: true } }
    expect(guestSubscriptionActive('ACCOUNT', account, now)).toBe(true)
    expect(guestSubscriptionActive('ACCOUNT', base, now)).toBe(false)
    expect(guestSubscriptionActive('CODE', account, now)).toBe(false)
    expect(guestSubscriptionActive('CODE', team, now)).toBe(true)
    expect(guestSubscriptionActive('ACCOUNT', { ...base, session: { expiresAt: earlier, eventAccess: true } }, now)).toBe(false)
  })
})

describe('Einstellung', () => {
  const form = (values: Record<string, string>) => {
    const data = new FormData()
    for (const [key, value] of Object.entries(values)) data.set(key, value)
    return data
  }

  it('prüft Umfang, Vorlauf und Schwelle', () => {
    expect(parseGuestAlertOptions(form({ guestAlerts: 'MARKED', guestAlertLeadMin: '10', guestShiftAlertMin: '' })))
      .toEqual({ ok: true, options: { guestAlerts: 'MARKED', guestAlertLeadMin: 10, guestShiftAlertMin: null } })
    expect(parseGuestAlertOptions(form({ guestAlerts: 'ALL', guestAlertLeadMin: '5', guestShiftAlertMin: '30' })))
      .toEqual({ ok: true, options: { guestAlerts: 'ALL', guestAlertLeadMin: 5, guestShiftAlertMin: 30 } })
    const bad = parseGuestAlertOptions(form({ guestAlerts: 'IMMER', guestAlertLeadMin: '7', guestShiftAlertMin: '3' }))
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.errors).toHaveLength(3)
  })

  it('Gäste bekommen Erinnerungen nur bei veröffentlichten und laufenden Events angeboten', () => {
    const event = { guestAlerts: 'MARKED' as const, guestAlertLeadMin: 15, guestShiftAlertMin: 30 }
    expect(guestReminders({ ...event, status: 'LIVE' })).toEqual({ mode: 'MARKED', leadMin: 15, shiftMin: 30 })
    expect(guestReminders({ ...event, status: 'PUBLISHED' })).not.toBeNull()
    expect(guestReminders({ ...event, status: 'ENDED' })).toBeNull()
    expect(guestReminders({ ...event, status: 'DRAFT' })).toBeNull()
    expect(guestReminders({ ...event, guestAlerts: 'OFF', status: 'LIVE' })).toBeNull()
    expect(reminderSummary({ mode: 'MARKED', leadMin: 15, shiftMin: 30 })).toMatch(/^Du bekommst 15 Minuten vor den Programmpunkten mit 🔔 .* um 30 Minuten oder mehr/)
  })
})
