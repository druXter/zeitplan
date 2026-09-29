// app/lib/permissions.ts
import { timingSafeEqual } from 'node:crypto'
import type { CurrentUser } from './auth'

/** Events anlegen dürfen Admins und Creator, nicht Moderator*innen (siehe prisma/schema.prisma, enum Role). */
export function canCreateEvents(user: CurrentUser): boolean {
  return user.role !== 'MODERATOR'
}

/** Konten einladen dürfen Admins (jede Rolle) und Creator (nur Moderator*innen, siehe createUser). */
export function canInviteUsers(user: CurrentUser): boolean {
  return user.role !== 'MODERATOR'
}

/**
 * owner:     Besitzer*in oder Admin - Event-Einstellungen, löschen, freigeben, Plan bearbeiten.
 * moderator: per EventAccess freigegeben - ansehen und live steuern (Phase 4). Plan bearbeiten und
 *            Einschübe nur mit den Schaltern des Events (Phase 2/4, docs/KONZEPT.md Abschnitt 7).
 *
 * Anders als in Seating (dort darf eine Freigabe alles außer löschen und weiter freigeben) ändert eine
 * Freigabe hier nichts an den Event-Einstellungen: Moderator*innen bekommen genau die Rechte aus dem
 * Konzept, der Rest bleibt bei Besitzer*in und Admin.
 *
 * DIE zentrale Prüfung für Events. Die Freigabe fragt app/lib/events/store.ts aus der Datenbank ab und
 * reicht sie hier herein, damit die Regel selbst ohne Datenbank testbar bleibt. Jede Seite, Server
 * Action und jeder Route Handler geht über loadEventForUser (dort) und damit über diese Funktion.
 *
 * SECRET-Punkte (Phase 2) prüft eine eigene Regel pro Punkt - auch owner sieht sie nur, wenn eingetragen.
 */
export type EventLevel = 'owner' | 'moderator'

export function eventLevel(user: CurrentUser, event: { ownerId: string | null }, hasShare: boolean): EventLevel | null {
  if (user.role === 'ADMIN' || (event.ownerId !== null && event.ownerId === user.id)) return 'owner'
  return hasShare ? 'moderator' : null
}

/** Konstantzeitvergleich für Tokens - `===` würde über die Antwortzeit verraten, wie viele Zeichen stimmen. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
