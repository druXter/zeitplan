import type { CurrentUser } from '../../../../lib/auth'
import type { LoadedEvent } from '../../../../lib/events/store'
import type { PlanItem } from '../../../../lib/planning/items'
import { startRange } from '../../../../lib/planning/rules'
import { eventAccounts, type PlanTrack } from '../../../../lib/planning/store'
import { prisma } from '../../../../lib/prisma'
import { formatShort, utcToZonedInput } from '../../../../lib/timezone'
import type { ItemFormOptions } from '../../item-form'

/** Auswahllisten und Grenzen für das Punkt-Formular - Titel geheimer Punkte schon als Platzhalter (loadPlan). */
export async function itemFormOptions(event: LoadedEvent, user: CurrentUser, tracks: PlanTrack[], items: PlanItem[], exceptId?: string) {
  const trackName = new Map(tracks.map(track => [track.id, track.name]))
  const [accounts, places] = await Promise.all([
    eventAccounts(event, { id: user.id, email: user.email, name: user.name }),
    prisma.place.findMany({ where: { eventId: event.id }, orderBy: { name: 'asc' }, select: { name: true } })
  ])
  const range = startRange(event.date)
  const options: ItemFormOptions = {
    tracks: tracks.map(track => ({ id: track.id, name: track.name })),
    items: items
      .filter(item => item.id !== exceptId)
      .sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime())
      .map(item => ({ id: item.id, label: `${formatShort(item.plannedStart, event.timezone).slice(-5)} ${item.title} (${trackName.get(item.trackId) ?? '?'})` })),
    accounts: accounts.map(account => ({ id: account.id, label: account.id === user.id ? `${account.name || account.email} (du)` : account.name || account.email })),
    places: places.map(place => place.name),
    guestAlerts: event.guestAlerts
  }
  return {
    options,
    minStart: utcToZonedInput(range.from, event.timezone),
    maxStart: utcToZonedInput(new Date(range.until.getTime() - 60_000), event.timezone)
  }
}
