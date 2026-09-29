import { describe, expect, it } from 'vitest'
import { allowedStatusChanges, DEFAULT_EVENT_OPTIONS, parseEventForm, parseEventOptions } from '../../../app/lib/events/settings'

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const valid = { title: 'Hochzeit Anna & Ben', slug: 'hochzeit-anna-ben', date: '2026-10-24', description: '' }

describe('parseEventForm', () => {
  it('liefert die Felder mit dem Tag als Mitternacht in Berlin (UTC)', () => {
    const parsed = parseEventForm(form(valid))
    expect(parsed).toEqual({
      ok: true,
      fields: { title: 'Hochzeit Anna & Ben', slug: 'hochzeit-anna-ben', description: '', date: new Date('2026-10-23T22:00:00.000Z'), timezone: 'Europe/Berlin' }
    })
  })

  it('meldet jeden Fehler mit dem Feldnamen', () => {
    const parsed = parseEventForm(form({ title: '', slug: 'admin', date: '2026-02-30', description: 'x'.repeat(2001) }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors).toHaveLength(4)
    expect(parsed.errors[0]).toMatch(/^Titel:/)
    expect(parsed.errors[1]).toMatch(/^Adresse: .*reserviert/)
    expect(parsed.errors[2]).toMatch(/^Beschreibung:/)
    expect(parsed.errors[3]).toMatch(/^Datum:/)
  })

  it('lehnt zu lange Titel ab, statt sie abzuschneiden', () => {
    const parsed = parseEventForm(form({ ...valid, title: 'x'.repeat(121) }))
    expect(parsed.ok).toBe(false)
  })
})

describe('parseEventOptions', () => {
  const options = { creepNudgeMin: '5', creepCapMin: '30', guestRoundingMin: '5', hysteresisMin: '3', guestHorizonMin: '120', autoCreep: 'on' }

  it('Standardwerte, Schalter nur mit Haken', () => {
    expect(parseEventOptions(form(options))).toEqual({ ok: true, options: DEFAULT_EVENT_OPTIONS, modsMayEditPlan: false, modsMayInsert: false })
    const all = parseEventOptions(form({ ...options, showDelayToGuests: 'on', modsMayEditPlan: 'on', modsMayInsert: 'on' }))
    expect(all).toMatchObject({ ok: true, options: { showDelayToGuests: true }, modsMayEditPlan: true, modsMayInsert: true })
    expect(parseEventOptions(form({ ...options, autoCreep: '' }))).toMatchObject({ ok: true, options: { autoCreep: false } })
  })

  it('lehnt Werte außerhalb der Grenzen ab', () => {
    const parsed = parseEventOptions(form({ ...options, creepNudgeMin: '0', guestHorizonMin: '99999', hysteresisMin: '1.5' }))
    expect(!parsed.ok && parsed.errors.map(e => e.split(':')[0])).toEqual(['Nachfrage nach', 'Hysterese', 'Horizont'])
  })
})

describe('allowedStatusChanges', () => {
  it('Planung wechselt nur zwischen Entwurf, veröffentlicht und archiviert - LIVE/ENDED setzt die Live-Steuerung', () => {
    expect(allowedStatusChanges('DRAFT')).toEqual(['PUBLISHED', 'ARCHIVED'])
    expect(allowedStatusChanges('PUBLISHED')).toEqual(['DRAFT', 'ARCHIVED'])
    expect(allowedStatusChanges('LIVE')).toEqual([])
    expect(allowedStatusChanges('ENDED')).toEqual(['ARCHIVED'])
    expect(allowedStatusChanges('ARCHIVED')).toEqual(['DRAFT'])
  })
})
