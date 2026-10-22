// app/lib/guest-alerts/send.ts
import { Prisma, type GuestAlertKind } from '@prisma/client'
import { prisma } from '../prisma'
import { isPushConfigured, sendPush } from '../push'
import { findGuestEvents, loadGuestView } from '../guest/store'
import { formatItemClock } from '../timezone'
import { dueGuestAlerts, guestAlertMessage, guestSubscriptionActive, sentKey } from './due'

const DAY = 24 * 60 * 60 * 1000

export type GuestAlertRun = { events: number; sent: number; delivered: number }

/**
 * Erinnerungen für Gäste (Idee L12), aufgerufen jede Minute vom Cron-Endpunkt app/api/cron/alerts wie die Vorwarnung
 * fürs Team: für jedes veröffentlichte oder laufende Event mit Erinnerungen um den heutigen Tag die Gästeansicht rechnen
 * (loadGuestView - dieselben Zeiten, die Gäste sehen), fällige Erinnerungen bestimmen (dueGuestAlerts) und an alle
 * Gäste-Geräte mit gültigem Zugang schicken (guestSubscriptionActive).
 *
 * - Jede Erinnerung wird vor dem Senden in GuestAlertSent "beansprucht", damit zwei gleichzeitige Läufe nie doppelt
 *   schicken. Ohne aktives Gäste-Gerät wird nichts beansprucht - wer danach abonniert, bekommt sie noch.
 * - Die Mitteilung gilt nur bis zum angekündigten Beginn (TTL).
 */
export async function runGuestAlerts(now: Date): Promise<GuestAlertRun> {
  const run: GuestAlertRun = { events: 0, sent: 0, delivered: 0 }
  if (!isPushConfigured()) return run

  // Punkte liegen zwischen dem Vortag und 3 Tage nach dem Eventtag (PLAN_LIMITS).
  const events = await findGuestEvents({
    status: { in: ['PUBLISHED', 'LIVE'] },
    guestAlerts: { not: 'OFF' },
    date: { gte: new Date(now.getTime() - 4 * DAY), lte: new Date(now.getTime() + 2 * DAY) },
    guestPushSubscriptions: { some: { expiresAt: { gt: now } } }
  })

  for (const event of events) {
    if (event.guestAlerts === 'OFF') continue
    run.events++
    const rows = await prisma.guestPushSubscription.findMany({
      where: { eventId: event.id, expiresAt: { gt: now } },
      select: {
        id: true, endpoint: true, p256dh: true, auth: true, expiresAt: true,
        guestSession: { select: { expiresAt: true, rsvpId: true } },
        session: { select: { expiresAt: true, user: { select: { id: true, role: true, eventAccess: { where: { eventId: event.id }, select: { userId: true } } } } } }
      }
    })
    const owner = await prisma.event.findUnique({ where: { id: event.id }, select: { ownerId: true } })
    const targets = rows.filter(row => guestSubscriptionActive(event.access, {
      expiresAt: row.expiresAt,
      guestSession: row.guestSession,
      session: row.session && {
        expiresAt: row.session.expiresAt,
        eventAccess: row.session.user.role === 'ADMIN' || row.session.user.id === owner?.ownerId || row.session.user.eventAccess.length > 0
      }
    }, now))
    if (targets.length === 0) continue

    const { view } = await loadGuestView(event, now)
    const reminded = view.items.filter(item => item.reminder)
    if (reminded.length === 0) continue
    const ids = reminded.map(item => item.id)
    const [plans, sentRows] = await Promise.all([
      prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, originalStart: true } }),
      prisma.guestAlertSent.findMany({ where: { itemId: { in: ids } }, select: { itemId: true, kind: true, start: true } })
    ])
    const announced = new Map(plans.flatMap(plan => plan.originalStart ? [[plan.id, plan.originalStart] as const] : []))
    const sent = new Map(sentRows.map(row => [sentKey(row.itemId, row.kind), row.start]))
    const byId = new Map(reminded.map(item => [item.id, item]))
    const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)
    const settings = { leadMin: event.guestAlertLeadMin, shiftMin: event.guestShiftAlertMin, live: event.status === 'LIVE' }

    for (const alert of dueGuestAlerts(reminded, announced, sent, settings, now)) {
      if (!(await claim(alert.itemId, alert.kind, alert.start, alert.previous, now))) continue
      run.sent++
      const message = guestAlertMessage(byId.get(alert.itemId)!, alert, event, clock)
      run.delivered += await sendPush(targets, message, { ttlSeconds: Math.max(60, alert.minutesUntil * 60), urgency: 'high' },
        gone => prisma.guestPushSubscription.deleteMany({ where: { id: { in: gone } } }))
    }
  }
  return run
}

/** Beansprucht eine Erinnerung - false, wenn ein anderer Lauf sie schon geschickt hat. */
async function claim(itemId: string, kind: GuestAlertKind, start: Date, previous: Date | null, now: Date): Promise<boolean> {
  if (previous === null) {
    try {
      await prisma.guestAlertSent.create({ data: { itemId, kind, start, sentAt: now } })
      return true
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false
      throw error
    }
  }
  const updated = await prisma.guestAlertSent.updateMany({ where: { itemId, kind, start: previous }, data: { start, sentAt: now } })
  return updated.count === 1
}
