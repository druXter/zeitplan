// app/lib/live/store.ts
import { Prisma, type EventStatus } from '@prisma/client'
import { prisma } from '../prisma'
import { bumpLiveVersion } from '../planning/store'
import { autoEndAt, type LivePatch } from '../schedule'
import { snapshotOf, type ActionState, type ItemRecord, type LiveActionType } from './history'

type Tx = Prisma.TransactionClient

/** Ablehnung innerhalb einer Live-Transaktion - rollt alles zurück (auch das vorgezogene liveVersion++). */
export class LiveRefused extends Error {
  constructor(public readonly reason: string) {
    super(reason)
  }
}

function isWriteConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return true
  return error instanceof Error && /database is locked|SQLITE_BUSY|write conflict|deadlock/i.test(error.message)
}

/**
 * Transaktion für Live-Aktionen. Sie SCHREIBT ZUERST (liveVersion++) und hält damit die Schreibsperre von
 * SQLite, bevor sie liest: Zwei gleichzeitige Aktionen laufen so nacheinander, und die zweite sieht den Stand
 * nach der ersten (zweites "Weiter" → 'already'). Scheitert eine Transaktion trotzdem an einem Schreibkonflikt,
 * wird sie wiederholt - mit frisch gelesenem Stand.
 */
export async function liveTransaction<T>(eventId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        await bumpLiveVersion(eventId, tx)
        return fn(tx)
      }, { maxWait: 10_000, timeout: 15_000 })
    } catch (error) {
      if (attempt >= 5 || !isWriteConflict(error)) throw error
      await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 100))
    }
  }
}

const recordSelect = {
  id: true, trackId: true, sortOrder: true, plannedStart: true, status: true, actualStart: true, actualEnd: true,
  reportedDelayMin: true, reportedAt: true, cancelReason: true,
  title: true, location: true, description: true, internalNote: true, visibility: true, isAnchor: true, mayStartEarly: true,
  plannedDurationMin: true, insertedLive: true, originalStart: true, originalDurationMin: true, originalSortOrder: true, createdAt: true,
  waitsFor: { select: { waitsForItemId: true } },
  waitedOnBy: { select: { itemId: true } },
  secretViewers: { select: { userId: true } }
} as const

/**
 * Momentaufnahmen der genannten Punkte (fehlende: null). withContent: dazu alles, was nötig ist, um den Punkt
 * exakt wieder anzulegen (Einschub/Entfernen).
 */
export async function readRecords(tx: Tx, eventId: string, ids: string[], withContent = false): Promise<Record<string, ItemRecord | null>> {
  const rows = await tx.item.findMany({ where: { eventId, id: { in: ids } }, select: recordSelect })
  const result: Record<string, ItemRecord | null> = Object.fromEntries(ids.map(id => [id, null]))
  for (const row of rows) {
    result[row.id] = {
      ...snapshotOf(row),
      ...(withContent ? {
        content: {
          title: row.title,
          location: row.location,
          description: row.description,
          internalNote: row.internalNote,
          visibility: row.visibility,
          isAnchor: row.isAnchor,
          mayStartEarly: row.mayStartEarly,
          plannedDurationMin: row.plannedDurationMin,
          insertedLive: row.insertedLive,
          originalStart: row.originalStart?.toISOString() ?? null,
          originalDurationMin: row.originalDurationMin,
          originalSortOrder: row.originalSortOrder,
          waitsFor: row.waitsFor.map(d => d.waitsForItemId),
          waitedOnBy: row.waitedOnBy.map(d => d.itemId),
          secretViewerIds: row.secretViewers.map(v => v.userId),
          createdAt: row.createdAt.toISOString()
        }
      } : {})
    }
  }
  return result
}

/** Schreibt Patches aus dem Kern; jeder geänderte Punkt bekommt eine neue Version (veraltete Formulare scheitern). */
export async function applyPatches(tx: Tx, eventId: string, patches: LivePatch[]): Promise<void> {
  for (const { id, ...fields } of patches) {
    const updated = await tx.item.updateMany({ where: { id, eventId }, data: { ...fields, version: { increment: 1 } } })
    if (updated.count !== 1) throw new LiveRefused('not-found')
  }
}

export async function logAction(tx: Tx, entry: {
  eventId: string; actorId: string | null; type: LiveActionType; itemId: string | null; before: ActionState; after: ActionState
}): Promise<string> {
  const action = await tx.liveAction.create({
    data: {
      eventId: entry.eventId,
      actorId: entry.actorId,
      type: entry.type,
      itemId: entry.itemId,
      before: entry.before as unknown as Prisma.InputJsonValue,
      after: entry.after as unknown as Prisma.InputJsonValue
    },
    select: { id: true }
  })
  return action.id
}

const toDate = (value: string | null) => (value ? new Date(value) : null)

/**
 * Stellt Punkte auf gespeicherte Momentaufnahmen zurück (Rückgängig): null → Punkt löschen, fehlt der Punkt →
 * mit Inhalt, Abhängigkeiten und SECRET-Liste unter derselben id neu anlegen, sonst die Live-Felder setzen.
 */
export async function restoreRecords(tx: Tx, eventId: string, target: Record<string, ItemRecord | null>, current: Record<string, ItemRecord | null>): Promise<void> {
  for (const [id, record] of Object.entries(target)) {
    if (record === null) {
      if (current[id]) await tx.item.deleteMany({ where: { id, eventId } })
      continue
    }
    const fields = {
      trackId: record.trackId,
      sortOrder: record.sortOrder,
      plannedStart: new Date(record.plannedStart),
      status: record.status,
      actualStart: toDate(record.actualStart),
      actualEnd: toDate(record.actualEnd),
      reportedDelayMin: record.reportedDelayMin,
      reportedAt: toDate(record.reportedAt),
      cancelReason: record.cancelReason
    }
    if (current[id]) {
      await tx.item.updateMany({ where: { id, eventId }, data: { ...fields, version: { increment: 1 } } })
      continue
    }
    if (!record.content) throw new LiveRefused('changed')
    const { content } = record
    const existing = new Set((await tx.item.findMany({
      where: { eventId, id: { in: [...content.waitsFor, ...content.waitedOnBy] } }, select: { id: true }
    })).map(row => row.id))
    await tx.item.create({
      data: {
        id,
        eventId,
        ...fields,
        title: content.title,
        location: content.location,
        description: content.description,
        internalNote: content.internalNote,
        visibility: content.visibility,
        isAnchor: content.isAnchor,
        mayStartEarly: content.mayStartEarly,
        plannedDurationMin: content.plannedDurationMin,
        insertedLive: content.insertedLive,
        originalStart: toDate(content.originalStart),
        originalDurationMin: content.originalDurationMin,
        originalSortOrder: content.originalSortOrder,
        createdAt: new Date(content.createdAt),
        waitsFor: { create: content.waitsFor.filter(other => existing.has(other)).map(waitsForItemId => ({ waitsForItemId })) },
        secretViewers: { create: content.secretViewerIds.map(userId => ({ userId })) }
      }
    })
    const waitedOnBy = content.waitedOnBy.filter(other => existing.has(other))
    if (waitedOnBy.length > 0) await tx.itemDependency.createMany({ data: waitedOnBy.map(itemId => ({ itemId, waitsForItemId: id })) })
  }
}

/**
 * Live schalten friert den Ursprungsplan ein (docs/KONZEPT.md Abschnitt 1 und 4): Beginn, Dauer und Reihenfolge
 * jedes Punkts, der noch keinen Ursprung hat. Danach nie mehr verändert.
 */
export async function freezeOriginalPlan(tx: Tx, eventId: string): Promise<void> {
  const items = await tx.item.findMany({ where: { eventId, originalStart: null }, select: { id: true, plannedStart: true, plannedDurationMin: true, sortOrder: true } })
  for (const item of items) {
    await tx.item.update({
      where: { id: item.id },
      data: { originalStart: item.plannedStart, originalDurationMin: item.plannedDurationMin, originalSortOrder: item.sortOrder }
    })
  }
}

const ENDABLE: EventStatus[] = ['PUBLISHED', 'LIVE']

/**
 * Nach Eventende automatisch ENDED (docs/KONZEPT.md Abschnitt 10): veröffentlichte und laufende Events, deren
 * autoEndAt (Kern) vorbei ist. Live-Steuerung danach gesperrt, die Gästeansicht bleibt als Rückblick. Aufgerufen
 * von Live-Seite, Live-Aktionen und dem täglichen Cron. Gibt zurück, ob das Event jetzt beendet ist.
 */
export async function endIfOver(event: { id: string; date: Date; status: EventStatus }, now: Date): Promise<boolean> {
  if (!ENDABLE.includes(event.status)) return event.status === 'ENDED'
  const items = await prisma.item.findMany({
    where: { eventId: event.id },
    select: { id: true, trackId: true, sortOrder: true, plannedStart: true, plannedDurationMin: true, isAnchor: true, mayStartEarly: true, status: true, actualStart: true, actualEnd: true, reportedDelayMin: true }
  })
  if (now < autoEndAt(items.map(item => ({ ...item, waitsFor: [] })), event.date)) return false
  return prisma.$transaction(async tx => {
    const updated = await tx.event.updateMany({ where: { id: event.id, status: { in: ENDABLE } }, data: { status: 'ENDED', liveVersion: { increment: 1 } } })
    if (updated.count === 0) return true
    await logAction(tx, {
      eventId: event.id, actorId: null, type: 'endevent', itemId: null,
      before: { items: {}, meta: { ids: [], auto: true } }, after: { items: {}, meta: { ids: [], auto: true } }
    })
    return true
  })
}
