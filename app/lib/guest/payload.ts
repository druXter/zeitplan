import type { GuestStatus, GuestView } from '../schedule'
import type { Announcement } from './announcement'

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
  address: string | null
  routeUrl: string | null
  description: string | null
  track: string
  status: GuestStatus
  plannedStart: string
  shownStart: string
  approximate: boolean
  delayMin: number | null
  cancelReason: string | null
  /** Erinnerung per Push vor diesem Punkt (Idee L12). */
  reminder: boolean
}

/** Erinnerungen für Gäste (Idee L12), nur bei veröffentlichten und laufenden Events, sonst null. */
export type GuestPayloadReminders = { mode: 'MARKED' | 'ALL'; leadMin: number; shiftMin: number | null }

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
  /** Durchsage (Idee L15), nur aus currentAnnouncement. until: ab dann blendet auch ein gemerkter Stand sie aus. */
  announcement: { text: string; at: string; until: string | null } | null
  reminders: GuestPayloadReminders | null
  items: GuestPayloadItem[]
}

export type GuestEventSource = {
  title: string
  description: string
  date: Date
  timezone: string
  status: string
  series: { slug: string; title: string } | null
  guestAlerts?: 'OFF' | 'MARKED' | 'ALL'
  guestAlertLeadMin?: number
  guestShiftAlertMin?: number | null
}

/** Erinnerungen, wie Gäste sie angeboten bekommen - nur bei PUBLISHED und LIVE, sonst null. */
export function guestReminders(event: Pick<GuestEventSource, 'status' | 'guestAlerts' | 'guestAlertLeadMin' | 'guestShiftAlertMin'>): GuestPayloadReminders | null {
  if (!event.guestAlerts || event.guestAlerts === 'OFF' || (event.status !== 'PUBLISHED' && event.status !== 'LIVE')) return null
  return { mode: event.guestAlerts, leadMin: event.guestAlertLeadMin ?? 10, shiftMin: event.guestShiftAlertMin ?? null }
}

export function buildGuestPayload(event: GuestEventSource, view: GuestView, publicTrackCount: number, announcement: Announcement | null = null): GuestPayload {
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
    announcement: announcement
      ? { text: announcement.text, at: announcement.at.toISOString(), until: announcement.until?.toISOString() ?? null }
      : null,
    reminders: guestReminders(event),
    items: view.items.map(item => ({
      id: item.id,
      title: item.title,
      location: item.location,
      address: item.address,
      routeUrl: item.routeUrl,
      description: item.description,
      track: item.track,
      status: item.status,
      plannedStart: item.plannedStart.toISOString(),
      shownStart: item.shownStart.toISOString(),
      approximate: item.approximate,
      delayMin: item.delayMin,
      cancelReason: item.cancelReason,
      reminder: item.reminder
    }))
  }
}

/** Satz im Kasten "Erinnerungen aufs Handy" der Gästeansicht (app/[slug]/reminder-toggle.tsx). */
export function reminderSummary(reminders: GuestPayloadReminders): string {
  const which = reminders.mode === 'ALL' ? 'jedem Programmpunkt' : 'den Programmpunkten mit 🔔'
  const shift = reminders.shiftMin !== null
    ? ` Verschiebt sich einer davon um ${reminders.shiftMin} Minuten oder mehr, bekommst du die neue Uhrzeit.`
    : ''
  return `Du bekommst ${reminders.leadMin} Minuten vor ${which} eine Mitteilung – nach der aktuellen Zeit, auch wenn sich etwas verschiebt.${shift}`
}
