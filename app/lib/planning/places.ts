import { cleanText, PLAN_LIMITS } from './rules'

/**
 * Orte mit Adresse (Idee L22, docs/KONZEPT.md "Entschieden"). Ein Punkt gehört zu einem Ort, wenn sein Feld "Ort"
 * dem Namen entspricht (placeKey: ohne Groß-/Kleinschreibung und doppelte Leerzeichen) - keine Fremdschlüssel,
 * damit Formulare, Export und Live-Einschübe beim Freitext bleiben. Rein, ohne Datenbank.
 */
export const PLACE_LIMITS = {
  /** Wie das Feld "Ort" am Punkt - der Name muss dort hineinpassen. */
  nameMax: PLAN_LIMITS.locationMax,
  addressMax: 300,
  mapUrlMax: 500,
  maxPlaces: 30
} as const

export type PlaceFields = { name: string; address: string; mapUrl: string | null }

export type Place = PlaceFields & { id: string }

/** Vergleichsschlüssel für Ortsnamen: "Kirche St. Marien" = "kirche  st. marien". */
export function placeKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')
}

/** Der Ort zu einem Punkt (über sein Feld "Ort") oder null. */
export function placeFor<P extends PlaceFields>(location: string | null | undefined, places: P[]): P | null {
  if (!location) return null
  const key = placeKey(location)
  return places.find(place => placeKey(place.name) === key) ?? null
}

/** Nachschlagen für viele Punkte: Map von placeKey auf den Ort. */
export function placeIndex<P extends PlaceFields>(places: P[]): (location: string | null | undefined) => P | null {
  const byKey = new Map(places.map(place => [placeKey(place.name), place]))
  return location => (location ? byKey.get(placeKey(location)) ?? null : null)
}

/**
 * Link für "Route öffnen": der eigene Kartenlink des Orts oder eine Route zu Google Maps (öffnet auf dem Handy
 * die Karten-App). Es wird nichts eingebettet oder vorab geladen - Google erfährt erst beim Klick davon.
 */
export function routeUrl(place: PlaceFields): string {
  return place.mapUrl ?? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.address)}`
}

/** Eigener Kartenlink: nur https, ohne Zugangsdaten - sonst null. */
export function normalizeMapUrl(input: string): string | null {
  if (!input || input.length > PLACE_LIMITS.mapUrlMax) return null
  let url: URL
  try { url = new URL(input) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return url.toString()
}

export type ParsedPlace = { ok: true; fields: PlaceFields } | { ok: false; errors: string[] }

/**
 * Prüft Name, Adresse und Kartenlink eines Orts. others: die übrigen Orte des Events (Namen müssen eindeutig
 * sein, sonst wäre die Zuordnung der Punkte nicht klar).
 */
export function parsePlace(input: { name: string; address: string; mapUrl: string }, others: { name: string }[]): ParsedPlace {
  const name = cleanText(input.name.slice(0, PLACE_LIMITS.nameMax + 1))
  const address = cleanText(input.address.slice(0, PLACE_LIMITS.addressMax + 1))
  const rawUrl = input.mapUrl.trim().slice(0, PLACE_LIMITS.mapUrlMax + 1)
  const errors: string[] = []
  if (!name) errors.push('Name: Bitte gib einen Namen ein.')
  else if (name.length > PLACE_LIMITS.nameMax) errors.push(`Name: höchstens ${PLACE_LIMITS.nameMax} Zeichen.`)
  else if (others.some(other => placeKey(other.name) === placeKey(name))) errors.push('Name: Diesen Ort gibt es schon.')
  if (!address) errors.push('Adresse: Bitte gib eine Adresse ein.')
  else if (address.length > PLACE_LIMITS.addressMax) errors.push(`Adresse: höchstens ${PLACE_LIMITS.addressMax} Zeichen.`)
  const mapUrl = rawUrl ? normalizeMapUrl(rawUrl) : null
  if (rawUrl && !mapUrl) errors.push('Kartenlink: Bitte einen vollständigen https-Link angeben (oder leer lassen).')
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, fields: { name, address, mapUrl } }
}
