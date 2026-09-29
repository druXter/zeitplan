import type { GuestPayload } from './payload'

/**
 * Letzter Stand der Gästeansicht im Browser (docs/KONZEPT.md Abschnitt 5, "Schlechter Empfang"). Nur das, was
 * Gäste ohnehin sehen (GuestPayload), nie Team-Daten und nie die Vorschau eines Entwurfs. Gelesen von der Seite
 * selbst und von public/offline.html, falls die Seite ohne Verbindung neu geladen wird - der Schlüssel ist dort
 * gleich aufgebaut. Höchstens MAX_ENTRIES Events, das älteste fliegt raus.
 */
export const OFFLINE_KEY_PREFIX = 'zeitplan-ablauf:'
const MAX_ENTRIES = 5

type Stored = { savedAt: number; payload: GuestPayload }

export function rememberView(slug: string, payload: GuestPayload): void {
  try {
    const entry: Stored = { savedAt: Date.now(), payload }
    localStorage.setItem(OFFLINE_KEY_PREFIX + slug, JSON.stringify(entry))
    const keys: { key: string; savedAt: number }[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(OFFLINE_KEY_PREFIX)) continue
      let savedAt = 0
      try { savedAt = Number((JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Stored>).savedAt) || 0 } catch { /* kaputt: zuerst weg */ }
      keys.push({ key, savedAt })
    }
    keys.sort((a, b) => b.savedAt - a.savedAt).slice(MAX_ENTRIES).forEach(({ key }) => localStorage.removeItem(key))
  } catch {
    // Kein Speicher (privater Modus, voll): Die Ansicht funktioniert trotzdem, nur ohne Offline-Stand.
  }
}

export function forgetView(slug: string): void {
  try { localStorage.removeItem(OFFLINE_KEY_PREFIX + slug) } catch { /* siehe oben */ }
}
