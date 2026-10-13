// app/lib/review/store.ts
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import type { PlanItem } from '../planning/items'
import { loadPlan } from '../planning/store'
import { buildReview } from './review'

type Db = Prisma.TransactionClient | typeof prisma

export type ReviewExtras = { originalStart: Date | null; originalDurationMin: number | null; resultNote: string | null }

/**
 * Was Rückblick und Live-Steuerung über loadPlan hinaus brauchen: Ursprungsplan und Protokollnotiz je Punkt.
 * Die Punkte kommen aus loadPlan (SECRET-Regel schon angewandt) - die Notiz eines geheimen Punkts bekommt nur,
 * wer ihn sehen darf (canSee), wie die interne Notiz.
 */
export async function loadReviewExtras(eventId: string, items: PlanItem[], db: Db = prisma): Promise<Map<string, ReviewExtras>> {
  const rows = await db.item.findMany({
    where: { eventId },
    select: { id: true, originalStart: true, originalDurationMin: true, resultNote: true }
  })
  const visible = new Map(items.map(item => [item.id, item.canSee]))
  return new Map(rows.map(row => [row.id, {
    originalStart: row.originalStart,
    originalDurationMin: row.originalDurationMin,
    resultNote: visible.get(row.id) ? row.resultNote : null
  }]))
}

export type ReviewItem = PlanItem & ReviewExtras

/** Spuren und Punkte (SECRET-Regel über loadPlan) samt Ursprungsplan und Protokollnotiz, dazu der Rückblick. */
export async function loadReview(eventId: string, userId: string) {
  const { tracks, items } = await loadPlan(eventId, userId)
  const extras = await loadReviewExtras(eventId, items)
  const merged: ReviewItem[] = items.map(item => ({
    ...item,
    ...(extras.get(item.id) ?? { originalStart: null, originalDurationMin: null, resultNote: null })
  }))
  return { tracks, ...buildReview(merged, tracks.map(track => track.id)) }
}
