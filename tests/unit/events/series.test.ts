import { describe, expect, it } from 'vitest'
import { canManageSeries, parseSeriesForm } from '../../../app/lib/events/series'

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('Reihen', () => {
  it('prüft Titel und Adresse wie bei Events (reservierte Namen, Format)', () => {
    expect(parseSeriesForm(form({ title: ' Hochzeitswochenende ', slug: 'wochenende' }))).toEqual({ ok: true, fields: { title: 'Hochzeitswochenende', slug: 'wochenende' } })
    expect(parseSeriesForm(form({ title: '', slug: 'reihe' }))).toEqual({
      ok: false, errors: ['Titel: Bitte gib einen Titel ein.', 'Adresse: Diese Adresse ist für das Tool selbst reserviert.']
    })
  })

  it('ändern nur das besitzende Konto oder Admins', () => {
    expect(canManageSeries({ id: 'u1', role: 'CREATOR' }, { ownerId: 'u1' })).toBe(true)
    expect(canManageSeries({ id: 'u2', role: 'CREATOR' }, { ownerId: 'u1' })).toBe(false)
    expect(canManageSeries({ id: 'u2', role: 'ADMIN' }, { ownerId: 'u1' })).toBe(true)
    expect(canManageSeries({ id: 'u2', role: 'CREATOR' }, { ownerId: null })).toBe(false)
  })
})
