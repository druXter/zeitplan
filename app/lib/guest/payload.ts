import type { GuestStatus, GuestView } from '../schedule'

/**
 * Was Gästeansicht, Tafel und Polling-Endpunkt ausliefern - als JSON (Zeiten als ISO-Strings), identisch für
 * das erste HTML und jede Aktualisierung. Die Punkte stammen ausschließlich aus toGuestView (CLAUDE.md); hier
 * kommen nur die öffentlichen Angaben zum Event dazu. Jedes Feld ist einzeln aufgeführt - nichts per Spread,
 * damit ein neues Feld in der Datenbank oder im Kern nie unbemerkt bei Gästen landet.
 */
export type GuestPayloadItem = {
  id: string
  title: string
  location: string | null
  description: string | null
  track: string
  status: GuestStatus
  plannedStart: string
  shownStart: string
  approximate: boolean
  delayMin: number | null
  cancelReason: string | null
}

export type GuestPayload = {
  event: {
    title: string
    description: string
    /** Beginn des Eventtags (00:00 Ortszeit) als ISO-String. */
    date: string
    timezone: string
    status: string
    series: { slug: string; title: string } | null
  }
  /** Mehr als eine öffentliche Spur: Spur je Punkt anzeigen. */
  showTracks: boolean
  items: GuestPayloadItem[]
}

export type GuestEventSource = {
  title: string
  description: string
  date: Date
  timezone: string
  status: string
  series: { slug: string; title: string } | null
}

export function buildGuestPayload(event: GuestEventSource, view: GuestView, publicTrackCount: number): GuestPayload {
  return {
    event: {
      title: event.title,
      description: event.description,
      date: event.date.toISOString(),
      timezone: event.timezone,
      status: event.status,
      series: event.series ? { slug: event.series.slug, title: event.series.title } : null
    },
    showTracks: publicTrackCount > 1,
    items: view.items.map(item => ({
      id: item.id,
      title: item.title,
      location: item.location,
      description: item.description,
      track: item.track,
      status: item.status,
      plannedStart: item.plannedStart.toISOString(),
      shownStart: item.shownStart.toISOString(),
      approximate: item.approximate,
      delayMin: item.delayMin,
      cancelReason: item.cancelReason
    }))
  }
}
