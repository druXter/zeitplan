import type { Prisma, TrackVisibility } from '@prisma/client'
import { prisma } from '../prisma'
import { redactItem, type PlanItem } from './items'

type Db = Prisma.TransactionClient | typeof prisma

export type PlanTrack = { id: string; name: string; visibility: TrackVisibility; sortOrder: number }

/**
 * Lädt Spuren und Programmpunkte eines Events für ein Konto - jeder Punkt geht durch redactItem (SECRET-Regel).
 * Die Berechtigung fürs Event prüft der Aufrufer vorher (loadEventForUser). Planung, Team-Ansicht, Export und
 * Duplizieren bekommen Punkte nur über diese Funktion.
 */
export async function loadPlan(eventId: string, userId: string, db: Db = prisma): Promise<{ tracks: PlanTrack[]; items: PlanItem[] }> {
  const [tracks, rows] = await Promise.all([
    db.track.findMany({ where: { eventId }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, visibility: true, sortOrder: true } }),
    db.item.findMany({
      where: { eventId },
      orderBy: [{ trackId: 'asc' }, { sortOrder: 'asc' }],
      include: { waitsFor: { select: { waitsForItemId: true } }, secretViewers: { select: { userId: true } } }
    })
  ])
  const items = rows.map(row => redactItem({
    id: row.id,
    trackId: row.trackId,
    sortOrder: row.sortOrder,
    title: row.title,
    location: row.location,
    description: row.description,
    internalNote: row.internalNote,
    visibility: row.visibility,
    isAnchor: row.isAnchor,
    mayStartEarly: row.mayStartEarly,
    plannedStart: row.plannedStart,
    plannedDurationMin: row.plannedDurationMin,
    status: row.status,
    insertedLive: row.insertedLive,
    actualStart: row.actualStart,
    actualEnd: row.actualEnd,
    reportedDelayMin: row.reportedDelayMin,
    cancelReason: row.cancelReason,
    version: row.version,
    waitsFor: row.waitsFor.map(d => d.waitsForItemId),
    secretViewerIds: row.secretViewers.map(v => v.userId)
  }, userId))
  return { tracks, items }
}

export type EventAccount = { id: string; email: string; name: string | null }

/**
 * Konten mit Zugriff aufs Event (Besitzer*in, Freigaben) - die Auswahl für die SECRET-Liste. Das handelnde
 * Konto kommt dazu, falls es nur als Admin Zugriff hat.
 */
export async function eventAccounts(event: { id: string; ownerId: string | null }, actor: EventAccount, db: Db = prisma): Promise<EventAccount[]> {
  const shares = await db.eventAccess.findMany({
    where: { eventId: event.id },
    select: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: 'asc' }
  })
  const owner = event.ownerId ? await db.user.findUnique({ where: { id: event.ownerId }, select: { id: true, email: true, name: true } }) : null
  const accounts = [...(owner ? [owner] : []), ...shares.map(s => s.user), actor]
  return accounts.filter((account, index) => accounts.findIndex(a => a.id === account.id) === index)
}

/**
 * Nach jeder Änderung an Plan oder Live-Stand: liveVersion hochzählen (ETag des Polling-Endpunkts, Phase 3).
 */
export async function bumpLiveVersion(eventId: string, db: Db): Promise<void> {
  await db.event.update({ where: { id: eventId }, data: { liveVersion: { increment: 1 } } })
}
