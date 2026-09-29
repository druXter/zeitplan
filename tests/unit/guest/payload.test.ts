import { describe, expect, it } from 'vitest'
import { buildGuestPayload } from '../../../app/lib/guest/payload'
import { project } from '../../../app/lib/schedule/project'
import { toGuestView, DEFAULT_GUEST_SETTINGS, type GuestSourceItem, type GuestTrack } from '../../../app/lib/schedule/guest-view'
import { DEFAULT_PROJECT_SETTINGS } from '../../../app/lib/schedule/types'
import { at, item } from '../schedule/fixtures'

// Der GuestPayload ist das, was Gästeansicht, Tafel und Polling-Endpunkt ausliefern. Er darf nur Felder aus
// toGuestView und die öffentlichen Angaben zum Event enthalten - und nichts von TEAM/SECRET/Notizen.

const TRACKS: GuestTrack[] = [
  { id: 'main', name: 'Ablauf', visibility: 'PUBLIC', sortOrder: 1 },
  { id: 'technik', name: 'Technikspur', visibility: 'TEAM', sortOrder: 2 }
]

const EVENT = {
  title: 'Hochzeit', description: 'Wir freuen uns!', date: at('00:00'), timezone: 'Europe/Berlin', status: 'LIVE',
  series: { slug: 'hochzeitswochenende', title: 'Hochzeitswochenende' }
}

function source(overrides: Partial<GuestSourceItem> & { start: string; min: number }): GuestSourceItem {
  const { start, min, ...rest } = overrides
  return {
    ...item({ start, min, ...rest }),
    title: 'Titel', location: null, description: null, internalNote: null, visibility: 'PUBLIC', cancelReason: null,
    ...rest
  }
}

function payloadFor(items: GuestSourceItem[], now = at('14:30')) {
  const projection = project(items, now, DEFAULT_PROJECT_SETTINGS)
  if (!projection.ok) throw new Error('Schleife')
  return buildGuestPayload(EVENT, toGuestView({ items: projection.items, tracks: TRACKS }, {}, now, DEFAULT_GUEST_SETTINGS), 1)
}

describe('buildGuestPayload', () => {
  const items = [
    source({ id: 'trauung', start: '14:00', min: 45, sortOrder: 1, title: 'Trauung', location: 'Kirche', description: 'Bitte pünktlich', internalNote: 'Ringe bei Trauzeugin' }),
    source({ id: 'geheim', start: '14:45', min: 15, sortOrder: 2, title: 'Flashmob', location: 'Tanzfläche', visibility: 'SECRET', internalNote: 'DJ gibt Zeichen' }),
    source({ id: 'team', start: '15:00', min: 30, sortOrder: 3, title: 'Umbau Saal', visibility: 'TEAM', description: 'Tische rücken' }),
    source({ id: 'licht', trackId: 'technik', start: '14:00', min: 30, title: 'Lichtprobe' }),
    source({ id: 'ausfall', start: '15:30', min: 30, sortOrder: 4, title: 'Kutschfahrt', status: 'CANCELLED', cancelReason: 'Regen', internalNote: 'Kutscher abgesagt' })
  ]

  it('enthält nur freigegebene Felder, Zeiten als ISO-Strings', () => {
    const payload = payloadFor(items)
    expect(Object.keys(payload).sort()).toEqual(['event', 'items', 'showTracks'])
    expect(Object.keys(payload.event).sort()).toEqual(['date', 'description', 'series', 'status', 'timezone', 'title'])
    for (const entry of payload.items) {
      expect(Object.keys(entry).sort()).toEqual([
        'approximate', 'cancelReason', 'delayMin', 'description', 'id', 'location', 'plannedStart', 'shownStart', 'status', 'title', 'track'
      ])
      expect(entry.shownStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/)
    }
    expect(payload.items.map(i => i.id)).toEqual(['trauung', 'ausfall'])
    expect(payload.items[1]).toMatchObject({ status: 'cancelled', cancelReason: 'Regen' })
    expect(payload.event.series).toEqual({ slug: 'hochzeitswochenende', title: 'Hochzeitswochenende' })
  })

  it('nichts von TEAM, SECRET, Team-Spuren und internen Notizen - auch keine ids', () => {
    const json = JSON.stringify(payloadFor(items))
    for (const secret of ['geheim', 'Flashmob', 'Tanzfläche', 'DJ gibt', 'team', 'Umbau', 'Tische rücken', 'licht', 'Lichtprobe', 'Technikspur', 'Ringe', 'Kutscher', 'internalNote', 'visibility']) {
      expect(json, secret).not.toContain(secret)
    }
    // Positivkontrolle
    for (const visible of ['Trauung', 'Kirche', 'Bitte pünktlich', 'Kutschfahrt', 'Regen']) expect(json).toContain(visible)
  })

  it('Spuren nur anzeigen, wenn es mehr als eine öffentliche gibt', () => {
    const projection = project([], at('14:00'), DEFAULT_PROJECT_SETTINGS)
    if (!projection.ok) throw new Error()
    const view = toGuestView({ items: projection.items, tracks: TRACKS }, {}, at('14:00'), DEFAULT_GUEST_SETTINGS)
    expect(buildGuestPayload(EVENT, view, 1).showTracks).toBe(false)
    expect(buildGuestPayload(EVENT, view, 2).showTracks).toBe(true)
    expect(buildGuestPayload({ ...EVENT, series: null }, view, 1).event.series).toBeNull()
  })
})
