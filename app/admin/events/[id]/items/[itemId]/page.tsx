import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '../../../../../lib/auth'
import { loadEventOr404 } from '../../../../../lib/events/store'
import { canAddRemoveItems, canEditItem } from '../../../../../lib/permissions'
import { loadPlan } from '../../../../../lib/planning/store'
import { utcToZonedInput } from '../../../../../lib/timezone'
import { MAX_SHIFT_MIN } from '../../../../../lib/schedule'
import { deleteItem, shiftItems } from '../../../plan-actions'
import Notice from '../../../../../ui/notice'
import ItemForm from '../../../item-form'
import ConfirmForm from '../../../../../ui/confirm-form'
import { itemFormOptions } from '../options'

export const dynamic = 'force-dynamic'

const SHIFT_ERRORS: Record<string, string> = {
  started: 'Im Block ist ein Punkt, der schon begonnen hat – begonnene Punkte bleiben, wo sie sind.',
  order: 'So früh geht nicht: Der Block begänne vor dem vorherigen Punkt der Spur.',
  range: 'Bitte 1 bis 1440 Minuten angeben; alle Punkte müssen im erlaubten Zeitraum des Events bleiben.',
  secret: 'Im Block liegt ein geheimer Punkt, den du nicht bearbeiten darfst.',
  stale: 'Der Punkt wurde inzwischen geändert. Hier ist der aktuelle Stand – versuche es noch einmal.',
  forbidden: 'Diesen Punkt darfst du nicht verschieben.',
  'not-found': 'Den Punkt gibt es nicht mehr.'
}

/**
 * Punkt bearbeiten. Wer den Punkt nicht bearbeiten darf (kein Planrecht, geheimer Punkt ohne Eintrag), landet
 * wieder in der Liste - die Seite verrät nicht, ob es den Punkt gibt.
 */
export default async function EditItemPage({ params, searchParams }: {
  params: Promise<{ id: string; itemId: string }>; searchParams: Promise<{ shiftError?: string }>
}) {
  const { id, itemId } = await params
  const { shiftError } = await searchParams
  const user = await requireUser(`/admin/events/${id}/items/${itemId}`)
  const event = await loadEventOr404(id, user)
  const { tracks, items } = await loadPlan(event.id, user.id)
  const item = items.find(i => i.id === itemId)
  if (!item || !canEditItem(event.level, event, item, item.canSee)) redirect(`/admin/events/${event.id}/plan`)
  const { options, minStart, maxStart } = await itemFormOptions(event, user, tracks, items, item.id)

  return (
    <main className="bg-gray-50 dark:bg-gray-900 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-4 text-gray-900 dark:text-gray-100">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4">
          <p className="text-sm"><Link href={`/admin/events/${event.id}/plan?track=${item.trackId}#item-${item.id}`} className="text-blue-700 dark:text-blue-300 hover:underline">Zurück zum Ablauf</Link></p>
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
              secretViewers: item.visibility === 'SECRET' ? item.secretViewerIds : [user.id],
              assignees: item.assigneeIds
            }}
          />
        </div>
        {!item.actualStart && !item.actualEnd && <div id="block" className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow space-y-3">
          <h2 className="font-bold">Block verschieben</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Verschiebt diesen Punkt und alle folgenden seiner Spur um dieselbe Zeit – Dauern und Abstände bleiben. Begonnene
            Punkte bleiben, wo sie sind.
          </p>
          {shiftError && <Notice tone="error">{SHIFT_ERRORS[shiftError] ?? 'Das hat nicht geklappt.'}</Notice>}
          <form action={shiftItems} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="eventId" value={event.id} />
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="version" value={item.version} />
            <div>
              <label htmlFor="shift-minutes" className="block text-sm font-medium mb-1">Minuten</label>
              <input id="shift-minutes" name="minutes" type="number" inputMode="numeric" min={1} max={MAX_SHIFT_MIN} required defaultValue={15} className="w-24 border border-gray-300 dark:border-gray-600 p-2 rounded text-sm" />
            </div>
            <div>
              <label htmlFor="shift-direction" className="block text-sm font-medium mb-1">Richtung</label>
              <select id="shift-direction" name="direction" defaultValue="later" className="border border-gray-300 dark:border-gray-600 p-2 rounded text-sm bg-white dark:bg-gray-800">
                <option value="later">später</option>
                <option value="earlier">früher</option>
              </select>
            </div>
            <div className="grow min-w-48">
              <label htmlFor="shift-scope" className="block text-sm font-medium mb-1">Bis</label>
              <select id="shift-scope" name="scope" defaultValue="until-anchor" className="w-full border border-gray-300 dark:border-gray-600 p-2 rounded text-sm bg-white dark:bg-gray-800">
                <option value="until-anchor">vor den nächsten Anker (Anker bleibt)</option>
                <option value="track-end">zum Ende der Spur (Anker mit)</option>
              </select>
            </div>
            <button type="submit" className="py-2 px-3 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900 text-sm">Verschieben</button>
          </form>
        </div>}
        {canAddRemoveItems(event.level, event) && (
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow space-y-2">
            <h2 className="font-bold">Punkt löschen</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400">Punkte, die auf diesen warten, beginnen danach ohne ihn.</p>
            <ConfirmForm action={deleteItem} message={`Punkt „${item.title}“ löschen?`}>
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="itemId" value={item.id} />
              <button type="submit" className="text-sm text-red-700 dark:text-red-300 hover:underline">Punkt löschen</button>
            </ConfirmForm>
          </div>
        )}
      </div>
    </main>
  )
}
