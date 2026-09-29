// app/lib/events/store.ts
import { notFound } from 'next/navigation'
import type { Event } from '@prisma/client'
import { prisma } from '../prisma'
import { eventLevel, type EventLevel } from '../permissions'
import type { CurrentUser } from '../auth'

export type LoadedEvent = Event & { level: EventLevel }

/**
 * Lädt ein Event für ein Konto oder gibt null zurück, wenn es das Event nicht gibt ODER das Konto
 * keinen Zugriff hat - nach außen gleich (keine Bestätigung fremder ids). Über diese Funktion
 * gehen alle Admin-Seiten, Server Actions und Route Handler für Events.
 */
export async function loadEventForUser(id: string, user: CurrentUser): Promise<LoadedEvent | null> {
  if (!id) return null
  const event = await prisma.event.findUnique({ where: { id } })
  if (!event) return null
  const share = event.ownerId === user.id || user.role === 'ADMIN'
    ? null
    : await prisma.eventAccess.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } }, select: { id: true } })
  const level = eventLevel(user, event, share !== null)
  return level ? { ...event, level } : null
}

export async function loadEventOr404(id: string, user: CurrentUser): Promise<LoadedEvent> {
  const event = await loadEventForUser(id, user)
  if (!event) notFound()
  return event
}
