import { describe, expect, it } from 'vitest'
import { normalizeMapUrl, parsePlace, placeFor, placeIndex, placeKey, routeUrl } from '../../../app/lib/planning/places'

// Orte mit Adresse (Idee L22): Zuordnung über den Namen im Feld "Ort", Route über Google Maps oder eigenen Link.

const kirche = { name: 'Kirche St. Marien', address: 'Marienplatz 1, 12345 Musterstadt', mapUrl: null }
const schloss = { name: 'Schloss', address: 'Schlossallee 5, 12345 Musterstadt', mapUrl: 'https://maps.example.org/schloss?x=1' }

describe('Zuordnung über den Namen', () => {
  it('ohne Groß-/Kleinschreibung und doppelte Leerzeichen', () => {
    expect(placeKey('  Kirche   St. MARIEN ')).toBe('kirche st. marien')
    expect(placeFor('kirche st. marien', [kirche, schloss])).toBe(kirche)
    expect(placeFor('Kirche', [kirche, schloss])).toBeNull()
    expect(placeFor(null, [kirche])).toBeNull()
    const lookup = placeIndex([kirche, schloss])
    expect(lookup('SCHLOSS')).toBe(schloss)
    expect(lookup('')).toBeNull()
  })
})

describe('routeUrl', () => {
  it('Route zu Google Maps mit kodierter Adresse, sonst der eigene Link', () => {
    expect(routeUrl(kirche)).toBe('https://www.google.com/maps/dir/?api=1&destination=Marienplatz%201%2C%2012345%20Musterstadt')
    expect(routeUrl(schloss)).toBe('https://maps.example.org/schloss?x=1')
  })

  it('eigener Link nur als https ohne Zugangsdaten', () => {
    expect(normalizeMapUrl('https://maps.app.goo.gl/abc')).toBe('https://maps.app.goo.gl/abc')
    for (const bad of ['http://maps.example.org', 'javascript:alert(1)', 'https://nutzer:pw@example.org', 'kein link', `https://example.org/${'x'.repeat(600)}`]) {
      expect(normalizeMapUrl(bad), bad).toBeNull()
    }
  })
})

describe('parsePlace', () => {
  it('prüft Name, Adresse, Link und doppelte Namen', () => {
    expect(parsePlace({ name: ' Kirche ', address: ' Weg 1 ', mapUrl: '' }, [])).toEqual({ ok: true, fields: { name: 'Kirche', address: 'Weg 1', mapUrl: null } })
    expect(parsePlace({ name: '', address: '', mapUrl: 'http://x' }, [])).toEqual({
      ok: false,
      errors: ['Name: Bitte gib einen Namen ein.', 'Adresse: Bitte gib eine Adresse ein.', 'Kartenlink: Bitte einen vollständigen https-Link angeben (oder leer lassen).']
    })
    expect(parsePlace({ name: 'SCHLOSS', address: 'Weg 1', mapUrl: '' }, [schloss])).toEqual({ ok: false, errors: ['Name: Diesen Ort gibt es schon.'] })
  })
})
