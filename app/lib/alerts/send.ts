// app/lib/alerts/send.ts
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { project } from '../schedule'
import { isPushConfigured, sendPushToUser } from '../push'
import { formatItemClock } from '../timezone'
import { alertMessage, dueAlerts, sentKey, type AlertRecipient, type AlertSourceItem } from './due'

const DAY = 24 * 60 * 60 * 1000

export type AlertRun = { events: number; sent: number; delivered: number }

/**
 * Vorwarnung fürs Team (Idee L17), aufgerufen jede Minute vom Cron-Endpunkt app/api/cron/alerts: für jedes
 * veröffentlichte oder laufende Event um den heutigen Tag die Prognose rechnen (wie die Team-Ansicht), fällige
 * Vorwarnungen bestimmen (dueAlerts) und per Push schicken.
 *
 * - Empfänger: Konten mit Einstellung (AlertSetting), Zugriff aufs Event (Besitzer*in, Freigabe, Admin) und
 *   mindestens einem Gerät mit Push - ohne Gerät wird auch nichts als gesendet vermerkt.
 * - Jede Vorwarnung wird vor dem Senden in AlertSent "beansprucht" (anlegen bzw. Vergleich mit dem alten Beginn),
 *   damit zwei gleichzeitige Läufe nie doppelt schicken.
 * - Die Mitteilung gilt nur bis zum erwarteten Beginn (TTL) - ein Handy, das erst später online kommt, bekommt keine
 *   veraltete Vorwarnung.
 */
export async function runAlerts(now: Date): Promise<AlertRun> {
  const run: AlertRun = { events: 0, sent: 0, delivered: 0 }
  if (!isPushConfigured()) return run

  // Punkte liegen zwischen dem Vortag und 3 Tage nach dem Eventtag (PLAN_LIMITS).
  const events = await prisma.event.findMany({
    where: {
      status: { in: ['PUBLISHED', 'LIVE'] },
      date: { gte: new Date(now.getTime() - 4 * DAY), lte: new Date(now.getTime() + 2 * DAY) },
      alertSettings: { some: {} }
    }
  })

  for (const event of events) {
    run.events++
    const settings = await prisma.alertSetting.findMany({
      where: {
        eventId: event.id,
        user: {
          pushSubscriptions: { some: {} },
          OR: [{ role: 'ADMIN' }, ...(event.ownerId ? [{ id: event.ownerId }] : []), { eventAccess: { some: { eventId: event.id } } }]
        }
      },
      select: { userId: true, scope: true, leadMin: true }
    })
    if (settings.length === 0) continue
    const recipients: AlertRecipient[] = settings

    const rows = await prisma.item.findMany({
      where: { eventId: event.id },
      include: { waitsFor: { select: { waitsForItemId: true } }, secretViewers: { select: { userId: true } }, assignees: { select: { userId: true } } }
    })
    const items: AlertSourceItem[] = rows.map(row => ({
      id: row.id,
      trackId: row.trackId,
      sortOrder: row.sortOrder,
      plannedStart: row.plannedStart,
      plannedDurationMin: row.plannedDurationMin,
      minDurationMin: row.minDurationMin,
      isAnchor: row.isAnchor,
      mayStartEarly: row.mayStartEarly,
      status: row.status,
      actualStart: row.actualStart,
      actualEnd: row.actualEnd,
      reportedDelayMin: row.reportedDelayMin,
      waitsFor: row.waitsFor.map(d => d.waitsForItemId),
      title: row.title,
      location: row.location,
      internalNote: row.internalNote,
      visibility: row.visibility,
      assigneeIds: row.assignees.map(a => a.userId),
      secretViewerIds: row.secretViewers.map(v => v.userId)
    }))
    // Wie Team-Ansicht und Gästeansicht: Sollte eine Schleife in der Datenbank stehen, ohne Zusammenführungen rechnen.
    let projection = project(items, now, event)
    if (!projection.ok) projection = project(items.map(item => ({ ...item, waitsFor: [] })), now, event)
    if (!projection.ok) continue
    const byId = new Map(projection.items.map(item => [item.id, item]))

    const sentRows = await prisma.alertSent.findMany({ where: { itemId: { in: rows.map(row => row.id) } }, select: { itemId: true, userId: true, expectedStart: true } })
    const sent = new Map(sentRows.map(row => [sentKey(row.itemId, row.userId), row.expectedStart]))
    const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)

    for (const alert of dueAlerts(projection.items, recipients, sent, now)) {
      if (!(await claim(alert.itemId, alert.userId, alert.expectedStart, alert.previousStart, now))) continue
      run.sent++
      const message = alertMessage(byId.get(alert.itemId)!, alert, event, clock)
      run.delivered += await sendPushToUser(alert.userId, message, { ttlSeconds: alert.minutesUntil * 60, urgency: 'high' })
    }
  }
  return run
}

/** Beansprucht eine Vorwarnung - false, wenn ein anderer Lauf sie schon geschickt hat. */
async function claim(itemId: string, userId: string, expectedStart: Date, previousStart: Date | null, now: Date): Promise<boolean> {
  if (previousStart === null) {
    try {
      await prisma.alertSent.create({ data: { itemId, userId, expectedStart, sentAt: now } })
      return true
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false
      throw error
    }
  }
  const updated = await prisma.alertSent.updateMany({ where: { itemId, userId, expectedStart: previousStart }, data: { expectedStart, sentAt: now } })
  return updated.count === 1
}
