// app/lib/alerts/due.ts
import type { AlertScope, ItemVisibility } from '@prisma/client'
import { isActive, type Projected, type ScheduleItem } from '../schedule'

const MINUTE = 60_000

/** Erlaubte Vorlaufzeiten der Vorwarnung in Minuten (Idee L17) - Auswahl in der Team-Ansicht. */
export const ALERT_LEAD_OPTIONS = [5, 10, 15, 20, 30] as const

export const ALERT_SCOPE_LABELS: Record<AlertScope, string> = {
  MINE: 'nur meine Punkte',
  ALL: 'alle Punkte'
}

export type AlertSourceItem = ScheduleItem & {
  title: string
  location: string | null
  internalNote: string | null
  visibility: ItemVisibility
  assigneeIds: string[]
  secretViewerIds: string[]
}

/** Wer eine Vorwarnung will - nur Konten mit Zugriff aufs Event und mindestens einem Gerät mit Push. */
export type AlertRecipient = { userId: string; scope: AlertScope; leadMin: number }

export type DueAlert = {
  userId: string
  itemId: string
  expectedStart: Date
  /** Bis zum erwarteten Beginn, aufgerundet (1 bis leadMin). */
  minutesUntil: number
  /** Schon einmal angekündigt (mit diesem Beginn) - die neue ersetzt die alte. */
  previousStart: Date | null
}

/**
 * Welche Vorwarnungen jetzt fällig sind (Idee L17) - rein, ohne Datenbank und Uhr:
 * - Punkte, die noch nicht begonnen haben und aktiv sind, deren ERWARTETER Beginn (Prognose) in (now, now + leadMin] liegt.
 * - MINE: nur Punkte, für die das Konto zuständig ist (Idee L16); ALL: alle.
 * - SECRET-Punkte nur für eingetragene Konten (wie überall: auch nicht für Besitzer*in oder Admin).
 * - Jede Vorwarnung nur einmal je Punkt und Konto (sent: angekündigter Beginn). Rutscht der Punkt danach um mehr als
 *   leadMin nach hinten, ist die alte Ankündigung falsch - dann kommt eine neue.
 */
export function dueAlerts(items: Projected<AlertSourceItem>[], recipients: AlertRecipient[], sent: Map<string, Date>, now: Date): DueAlert[] {
  const due: DueAlert[] = []
  const nowMs = now.getTime()
  for (const item of items) {
    if (!isActive(item) || item.actualStart !== null || item.actualEnd !== null) continue
    const untilMs = item.expectedStart.getTime() - nowMs
    if (untilMs <= 0) continue
    for (const recipient of recipients) {
      if (untilMs > recipient.leadMin * MINUTE) continue
      if (recipient.scope === 'MINE' && !item.assigneeIds.includes(recipient.userId)) continue
      if (item.visibility === 'SECRET' && !item.secretViewerIds.includes(recipient.userId)) continue
      const previous = sent.get(sentKey(item.id, recipient.userId)) ?? null
      if (previous && item.expectedStart.getTime() <= previous.getTime() + recipient.leadMin * MINUTE) continue
      due.push({ userId: recipient.userId, itemId: item.id, expectedStart: item.expectedStart, minutesUntil: Math.ceil(untilMs / MINUTE), previousStart: previous })
    }
  }
  return due
}

export function sentKey(itemId: string, userId: string): string {
  return `${itemId}/${userId}`
}

/**
 * Text der Mitteilung: "In 10 Min: Eröffnungstanz", darunter Uhrzeit (mit Planzeit bei Abweichung), Ort und die
 * interne Notiz ("Song: …") - das Team sieht sie ohnehin, und der Inhalt ist Ende-zu-Ende verschlüsselt. Der Link
 * führt zu "Meine Punkte" bzw. zur Team-Ansicht, direkt zum Punkt.
 */
export function alertMessage(
  item: Pick<Projected<AlertSourceItem>, 'id' | 'title' | 'location' | 'internalNote' | 'expectedStart' | 'plannedStart' | 'delayMin' | 'assigneeIds'>,
  alert: Pick<DueAlert, 'minutesUntil' | 'userId'>,
  event: { id: string; title: string },
  clock: (date: Date) => string
): { title: string; body: string; url: string; tag: string } {
  const time = item.delayMin !== 0 ? `ca. ${clock(item.expectedStart)} Uhr (Plan ${clock(item.plannedStart)})` : `${clock(item.expectedStart)} Uhr`
  const note = item.internalNote ? item.internalNote.replace(/\s+/g, ' ').trim() : ''
  const body = [time, item.location, note ? `Notiz: ${note.length > 140 ? `${note.slice(0, 139)}…` : note}` : null].filter(Boolean).join(' · ')
  const mine = item.assigneeIds.includes(alert.userId)
  return {
    title: `In ${alert.minutesUntil} Min: ${item.title}`,
    body: `${event.title}: ${body}`,
    url: `/admin/events/${event.id}/team${mine ? '?meine=1' : ''}#punkt-${item.id}`,
    tag: `punkt-${item.id}`
  }
}
