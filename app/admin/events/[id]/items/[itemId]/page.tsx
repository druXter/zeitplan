import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '../../../../../lib/auth'
import { loadEventOr404 } from '../../../../../lib/events/store'
import { canAddRemoveItems, canEditItem } from '../../../../../lib/permissions'
import { loadPlan } from '../../../../../lib/planning/store'
import { utcToZonedInput } from '../../../../../lib/timezone'
import { deleteItem } from '../../../plan-actions'
import ItemForm from '../../../item-form'
import ConfirmForm from '../../../../../ui/confirm-form'
import { itemFormOptions } from '../options'

export const dynamic = 'force-dynamic'

/**
 * Punkt bearbeiten. Wer den Punkt nicht bearbeiten darf (kein Planrecht, geheimer Punkt ohne Eintrag), landet
 * wieder in der Liste - die Seite verrät nicht, ob es den Punkt gibt.
 */
export default async function EditItemPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params
  const user = await requireUser(`/admin/events/${id}/items/${itemId}`)
  const event = await loadEventOr404(id, user)
  const { tracks, items } = await loadPlan(event.id, user.id)
  const item = items.find(i => i.id === itemId)
  if (!item || !canEditItem(event.level, event, item, item.canSee)) redirect(`/admin/events/${event.id}/plan`)
  const { options, minStart, maxStart } = await itemFormOptions(event, user, tracks, items, item.id)

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-4 text-gray-900">
        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <p className="text-sm"><Link href={`/admin/events/${event.id}/plan?track=${item.trackId}#item-${item.id}`} className="text-blue-700 hover:underline">Zurück zum Ablauf</Link></p>
          <h1 className="text-2xl font-bold">Punkt bearbeiten</h1>
          <ItemForm
            eventId={event.id}
            itemId={item.id}
            version={item.version}
            options={options}
            minStart={minStart}
            maxStart={maxStart}
            values={{
              title: item.title, location: item.location ?? '', description: item.description ?? '', internalNote: item.internalNote ?? '',
              trackId: item.trackId, start: utcToZonedInput(item.plannedStart, event.timezone), durationMin: String(item.plannedDurationMin),
              visibility: item.visibility, isAnchor: item.isAnchor, mayStartEarly: item.mayStartEarly, waitsFor: item.waitsFor,
              secretViewers: item.visibility === 'SECRET' ? item.secretViewerIds : [user.id]
            }}
          />
        </div>
        {canAddRemoveItems(event.level, event) && (
          <div className="bg-white p-4 rounded-lg shadow space-y-2">
            <h2 className="font-bold">Punkt löschen</h2>
            <p className="text-xs text-gray-600">Punkte, die auf diesen warten, beginnen danach ohne ihn.</p>
            <ConfirmForm action={deleteItem} message={`Punkt „${item.title}“ löschen?`}>
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="itemId" value={item.id} />
              <button type="submit" className="text-sm text-red-700 hover:underline">Punkt löschen</button>
            </ConfirmForm>
          </div>
        )}
      </div>
    </main>
  )
}
