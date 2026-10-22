import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '../../../../../lib/auth'
import { loadEventOr404 } from '../../../../../lib/events/store'
import { canAddRemoveItems } from '../../../../../lib/permissions'
import { loadPlan } from '../../../../../lib/planning/store'
import { utcToZonedInput } from '../../../../../lib/timezone'
import ItemForm from '../../../item-form'
import { Card } from '../../../../../ui/kit'
import { itemFormOptions } from '../options'

export const dynamic = 'force-dynamic'

const HOUR = 60 * 60 * 1000

export default async function NewItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ track?: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/items/new`)
  const event = await loadEventOr404(id, user)
  if (!canAddRemoveItems(event.level, event)) redirect(`/admin/events/${event.id}/plan`)

  const { track } = await searchParams
  const { tracks, items } = await loadPlan(event.id, user.id)
  if (tracks.length === 0) redirect(`/admin/events/${event.id}/plan`)
  const trackId = tracks.some(t => t.id === track) ? track! : tracks[0].id
  const { options, minStart, maxStart } = await itemFormOptions(event, user, tracks, items)

  // Vorschlag für den Beginn: Ende des letzten Punkts der Spur, sonst 14:00 am Eventtag.
  const last = items.filter(item => item.trackId === trackId).sort((a, b) => b.sortOrder - a.sortOrder)[0]
  const start = last ? new Date(last.plannedStart.getTime() + last.plannedDurationMin * 60_000) : new Date(event.date.getTime() + 14 * HOUR)

  return (
    <Card className="max-w-2xl space-y-4">
      <p className="text-sm"><Link href={`/admin/events/${event.id}/plan${track ? `?track=${trackId}` : ''}`} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">← Zurück zum Ablauf</Link></p>
      <h2 className="text-lg font-semibold">Neuer Punkt</h2>
      <ItemForm
        eventId={event.id}
        options={options}
        minStart={minStart}
        maxStart={maxStart}
        values={{
          title: '', location: '', description: '', internalNote: '', trackId,
          start: utcToZonedInput(start, event.timezone), durationMin: '30', minDurationMin: '', visibility: 'PUBLIC',
          isAnchor: false, mayStartEarly: false, guestAlert: false, waitsFor: [], secretViewers: [user.id], assignees: []
        }}
      />
    </Card>
  )
}
