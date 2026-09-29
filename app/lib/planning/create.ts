import { prisma } from '../prisma'
import type { EventFields, EventOptions } from '../events/settings'
import type { MaterializedPlan } from './exchange'
import { SlugTakenError, slugTaken } from './slug-store'

/** Leerer Ablauf eines neuen Events: eine öffentliche Spur. */
export const EMPTY_PLAN: MaterializedPlan = { tracks: [{ key: 'ablauf', name: 'Ablauf', visibility: 'PUBLIC', sortOrder: 1 }], items: [] }

/**
 * Legt ein neues Event samt Spuren, Punkten, Abhängigkeiten und SECRET-Liste in EINER Transaktion an - für
 * "Neues Event" (leer oder mit Vorlage), Import und Duplizieren. Der Plan ist vorher geprüft (parseExport) und
 * auf den Eventtag gelegt (materializePlan). Neue Events sind immer Entwurf, ohne Freigaben und mit
 * ausgeschalteten Schaltern für Moderator*innen.
 *
 * Geheime Punkte sieht danach nur das anlegende Konto - eine Kontenliste steht in keiner Datei, und Freigaben
 * werden nicht mitkopiert.
 *
 * Wirft SlugTakenError, wenn die Adresse (auch als Reihe) vergeben ist.
 */
export async function createEventFromPlan(ownerId: string, fields: EventFields, options: EventOptions, plan: MaterializedPlan): Promise<string> {
  return prisma.$transaction(async tx => {
    if (await slugTaken(fields.slug, {}, tx)) throw new SlugTakenError()
    const event = await tx.event.create({ data: { ...fields, ...options, status: 'DRAFT', ownerId } })

    const trackIds = new Map<string, string>()
    for (const track of plan.tracks) {
      const created = await tx.track.create({ data: { eventId: event.id, name: track.name, visibility: track.visibility, sortOrder: track.sortOrder } })
      trackIds.set(track.key, created.id)
    }

    const itemIds = new Map<string, string>()
    for (const item of plan.items) {
      const created = await tx.item.create({
        data: {
          eventId: event.id,
          trackId: trackIds.get(item.track)!,
          sortOrder: item.sortOrder,
          title: item.title,
          location: item.location,
          description: item.description,
          internalNote: item.internalNote,
          visibility: item.visibility,
          isAnchor: item.isAnchor,
          mayStartEarly: item.mayStartEarly,
          plannedStart: item.plannedStart,
          plannedDurationMin: item.plannedDurationMin,
          ...(item.visibility === 'SECRET' ? { secretViewers: { create: { userId: ownerId } } } : {})
        }
      })
      itemIds.set(item.key, created.id)
    }

    const dependencies = plan.items.flatMap(item => item.waitsFor.map(other => ({ itemId: itemIds.get(item.key)!, waitsForItemId: itemIds.get(other)! })))
    if (dependencies.length > 0) await tx.itemDependency.createMany({ data: dependencies })
    return event.id
  })
}
