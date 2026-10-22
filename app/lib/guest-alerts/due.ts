// app/lib/guest-alerts/due.ts
import type { GuestAccess, GuestAlertKind } from '@prisma/client'
import type { GuestItem } from '../schedule'
import { sessionMatchesAccess } from '../guest/access'

const MINUTE = 60_000

/** Höchstzahl der Gäste-Geräte je Event - begrenzt, was ein Unbekannter über die öffentliche Seite anlegen kann. */
export const MAX_GUEST_SUBSCRIPTIONS = 5000

export type GuestAlertSettings = {
  leadMin: number
  /** Schwelle für "Neue Zeit", null = aus. */
  shiftMin: number | null
  /** Verschiebungen nur, solange das Event live ist - vorher ändert sich der Plan, nicht der Ablauf. */
  live: boolean
}

export type DueGuestAlert = {
  kind: GuestAlertKind
  itemId: string
  /** Angekündigter Beginn - wie Gäste ihn sehen (shownStart). */
  start: Date
  /** Bis zum Beginn, aufgerundet. */
  minutesUntil: number
  /** SHIFT: die Zeit, die Gäste zuletzt kannten ("statt 19:00"). */
  before: Date | null
  /** Schon einmal geschickt (mit diesem Beginn) - die neue ersetzt den Eintrag. */
  previous: Date | null
}

export function sentKey(itemId: string, kind: GuestAlertKind): string {
  return `${itemId}/${kind}`
}

/**
 * Welche Erinnerungen an Gäste jetzt fällig sind (Idee L12) - rein, ohne Datenbank und Uhr. Grundlage ist allein die
 * Gästeansicht (toGuestView): nur Punkte, die Gäste sehen und die eine Erinnerung haben (reminder), mit der Zeit, die
 * Gäste sehen (gerundet, mit Hysterese). Gesendet wird je Punkt einmal an alle Gäste-Geräte.
 *
 * - START ("In 10 Min: Trauung"): kommender Punkt, dessen angezeigter Beginn in (now, now + leadMin] liegt. Rutscht er
 *   danach um mehr als leadMin nach hinten, kommt eine neue - wie die Vorwarnung fürs Team (app/lib/alerts/due.ts).
 * - SHIFT ("Neue Zeit: Abendessen"), nur mit shiftMin und live: Der angezeigte Beginn weicht um mindestens shiftMin von
 *   der Zeit ab, die Gäste zuletzt kannten - der zuletzt gemeldeten, sonst der Planzeit beim Live-Schalten (announced,
 *   Item.originalStart, bei Einschüben der Plan). Nur außerhalb des Vorlaufs; darin übernimmt die Erinnerung.
 */
export function dueGuestAlerts(
  items: GuestItem[],
  announced: Map<string, Date>,
  sent: Map<string, Date>,
  settings: GuestAlertSettings,
  now: Date
): DueGuestAlert[] {
  const due: DueGuestAlert[] = []
  const nowMs = now.getTime()
  const leadMs = settings.leadMin * MINUTE
  for (const item of items) {
    if (!item.reminder || item.status !== 'upcoming') continue
    const start = item.shownStart
    const untilMs = start.getTime() - nowMs
    if (untilMs <= 0) continue
    const minutesUntil = Math.ceil(untilMs / MINUTE)

    if (untilMs <= leadMs) {
      const previous = sent.get(sentKey(item.id, 'START')) ?? null
      if (previous && start.getTime() <= previous.getTime() + leadMs) continue
      due.push({ kind: 'START', itemId: item.id, start, minutesUntil, before: null, previous })
      continue
    }

    if (settings.shiftMin === null || !settings.live) continue
    const previous = sent.get(sentKey(item.id, 'SHIFT')) ?? null
    const before = previous ?? announced.get(item.id) ?? item.plannedStart
    if (Math.abs(start.getTime() - before.getTime()) < settings.shiftMin * MINUTE) continue
    due.push({ kind: 'SHIFT', itemId: item.id, start, minutesUntil, before, previous })
  }
  return due
}

/**
 * Text der Mitteilung - nur Felder aus der Gästeansicht (Titel, Zeit, Ort), nie Notizen. Der Link öffnet die
 * Gästeansicht beim Punkt; gleiche Tags (ein Punkt) ersetzen eine ältere Mitteilung.
 */
export function guestAlertMessage(
  item: Pick<GuestItem, 'id' | 'title' | 'location' | 'approximate'>,
  alert: Pick<DueGuestAlert, 'kind' | 'start' | 'minutesUntil' | 'before'>,
  event: { slug: string; title: string },
  clock: (date: Date) => string
): { title: string; body: string; url: string; tag: string } {
  const time = `${item.approximate ? 'ca. ' : ''}${clock(alert.start)} Uhr`
  const when = alert.kind === 'SHIFT' && alert.before ? `jetzt ${time} statt ${clock(alert.before)} Uhr` : time
  return {
    title: alert.kind === 'SHIFT' ? `Neue Zeit: ${item.title}` : `In ${alert.minutesUntil} Min: ${item.title}`,
    body: `${event.title}: ${[when, item.location].filter(Boolean).join(' · ')}`,
    url: `/${event.slug}#punkt-${item.id}`,
    tag: `gast-${item.id}`
  }
}

/** Woran ein Gäste-Abo hängt - geladen in app/lib/guest-alerts/send.ts. */
export type GuestSubscriptionState = {
  expiresAt: Date
  /** Gast-Sitzung nach Zugangscode bzw. rsvp-Link. */
  guestSession: { expiresAt: Date; rsvpId: string | null } | null
  /** Konto-Sitzung (Zugang "nur mit Konto" oder Vorschau des Teams); eventAccess: Konto mit Zugriff aufs Event. */
  session: { expiresAt: Date; eventAccess: boolean } | null
}

/**
 * Bekommt dieses Gäste-Abo noch Erinnerungen? Nur, solange der Zugang gilt, über den es entstand - dieselben Regeln
 * wie in der Gästeansicht (app/lib/guest/access.ts): öffentlich jedes Abo, "nur mit Konto" mit gültiger Konto-Sitzung,
 * Zugangscode und rsvp mit passender Gast-Sitzung oder als Konto mit Zugriff aufs Event. Wechselt der Zugang, gilt
 * kein altes Abo, auch wenn es noch in der Datenbank steht.
 */
export function guestSubscriptionActive(access: GuestAccess, subscription: GuestSubscriptionState, now: Date): boolean {
  if (subscription.expiresAt <= now) return false
  if (access === 'PUBLIC') return true
  const session = subscription.session
  if (session && session.expiresAt > now && (access === 'ACCOUNT' || session.eventAccess)) return true
  const guestSession = subscription.guestSession
  return guestSession !== null && guestSession.expiresAt > now && sessionMatchesAccess(access, guestSession)
}
