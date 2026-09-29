import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * Events und Reihen liegen beide direkt unter /<slug> und teilen sich deshalb einen Namensraum
 * (docs/KONZEPT.md "Entschieden"). Der Unique-Index gilt nur je Tabelle - diese Prüfung deckt die jeweils
 * andere ab. Aufrufen innerhalb der Transaktion, die speichert.
 */
export async function slugTaken(slug: string, except: { eventId?: string; seriesId?: string } = {}, db: Db = prisma): Promise<boolean> {
  const [event, series] = await Promise.all([
    db.event.findFirst({ where: { slug, ...(except.eventId ? { id: { not: except.eventId } } : {}) }, select: { id: true } }),
    db.series.findFirst({ where: { slug, ...(except.seriesId ? { id: { not: except.seriesId } } : {}) }, select: { id: true } })
  ])
  return event !== null || series !== null
}

export const SLUG_TAKEN = 'Adresse: Diese Adresse ist schon vergeben.'

/** Fehler, den eine Transaktion wirft, wenn die Adresse vergeben ist - die Server Action zeigt SLUG_TAKEN. */
export class SlugTakenError extends Error {}
