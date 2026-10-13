// app/lib/guest/announcement.ts

/**
 * Durchsage an Gäste und Tafel (Idee L15): ein kurzer Hinweis aus der Live-Steuerung („Bitte zum Gruppenfoto in
 * den Garten“), höchstens einer zur Zeit. Reine Funktionen ohne Datenbank und Uhr - die Server Action speichert,
 * buildGuestPayload gibt nur aus, was currentAnnouncement freigibt.
 */
export const ANNOUNCEMENT_LIMITS = {
  textMax: 280,
  /** Auswahl in der Live-Steuerung, in Minuten; 0 = bis jemand sie entfernt. */
  durations: [15, 30, 60, 120, 0]
} as const

export type AnnouncementSource = {
  status: string
  announcementText: string | null
  announcementAt: Date | null
  announcementUntil: Date | null
}

export type Announcement = { text: string; at: Date; until: Date | null }

/** Nur veröffentlichte und laufende Events zeigen eine Durchsage - im Rückblick (ENDED) ist sie vorbei. */
const SHOWN_STATUSES = ['PUBLISHED', 'LIVE']

/** Die Durchsage, die jetzt gilt, oder null (keine, abgelaufen, Event nicht veröffentlicht oder vorbei). */
export function currentAnnouncement(event: AnnouncementSource, now: Date): Announcement | null {
  if (!SHOWN_STATUSES.includes(event.status) || !event.announcementText || !event.announcementAt) return null
  if (event.announcementUntil && event.announcementUntil.getTime() <= now.getTime()) return null
  return { text: event.announcementText, at: event.announcementAt, until: event.announcementUntil }
}

/** Ablaufzeit aus der gewählten Dauer; null = ohne Ablauf. undefined: keine erlaubte Auswahl. */
export function announcementUntil(now: Date, durationMin: number): Date | null | undefined {
  if (!(ANNOUNCEMENT_LIMITS.durations as readonly number[]).includes(durationMin)) return undefined
  return durationMin === 0 ? null : new Date(now.getTime() + durationMin * 60_000)
}

/** Für gemerkte Stände im Browser (Offline): eine abgelaufene Durchsage nicht mehr zeigen. */
export function announcementVisible(announcement: { until: string | null } | null, nowMs: number): boolean {
  return announcement !== null && (announcement.until === null || Date.parse(announcement.until) > nowMs)
}
