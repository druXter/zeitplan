import { buttonClass, ConfirmForm, fieldClass, inputClass, labelClass, Notice } from '../../../../../ui/kit'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '../../../../../lib/auth'
import { loadEventOr404 } from '../../../../../lib/events/store'
import { canAddRemoveItems, canEditItem } from '../../../../../lib/permissions'
import { loadPlan } from '../../../../../lib/planning/store'
import { utcToZonedInput } from '../../../../../lib/timezone'
import { MAX_SHIFT_MIN } from '../../../../../lib/schedule'
import { deleteItem, shiftItems } from '../../../plan-actions'
import ItemForm from '../../../item-form'
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
    <div className="max-w-2xl space-y-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
        <p className="text-sm"><Link href={`/admin/events/${event.id}/plan?track=${item.trackId}#item-${item.id}`} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">← Zurück zum Ablauf</Link></p>
        <h2 className="text-lg font-semibold">Punkt bearbeiten</h2>
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
            minDurationMin: item.minDurationMin === null ? '' : String(item.minDurationMin),
            visibility: item.visibility, isAnchor: item.isAnchor, mayStartEarly: item.mayStartEarly, guestAlert: item.guestAlert, waitsFor: item.waitsFor,
            secretViewers: item.visibility === 'SECRET' ? item.secretViewerIds : [user.id],
            assignees: item.assigneeIds
          }}
        />
      </div>
      {!item.actualStart && !item.actualEnd && <div id="block" className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-3">
        <h2 className="font-semibold">Block verschieben</h2>
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
            <label htmlFor="shift-minutes" className={labelClass}>Minuten</label>
            <input id="shift-minutes" name="minutes" type="number" inputMode="numeric" min={1} max={MAX_SHIFT_MIN} required defaultValue={15} className={`${fieldClass} w-24`} />
          </div>
          <div>
            <label htmlFor="shift-direction" className={labelClass}>Richtung</label>
            <select id="shift-direction" name="direction" defaultValue="later" className={fieldClass}>
              <option value="later">später</option>
              <option value="earlier">früher</option>
            </select>
          </div>
          <div className="grow min-w-48">
            <label htmlFor="shift-scope" className={labelClass}>Bis</label>
            <select id="shift-scope" name="scope" defaultValue="until-anchor" className={inputClass}>
              <option value="until-anchor">vor den nächsten Anker (Anker bleibt)</option>
              <option value="track-end">zum Ende der Spur (Anker mit)</option>
            </select>
          </div>
          <button type="submit" className={buttonClass('secondary')}>Verschieben</button>
        </form>
      </div>}
      {canAddRemoveItems(event.level, event) && (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-2">
          <h2 className="font-semibold">Punkt löschen</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400">Punkte, die auf diesen warten, beginnen danach ohne ihn.</p>
          <ConfirmForm action={deleteItem} message={`Punkt „${item.title}“ löschen?`}>
            <input type="hidden" name="eventId" value={event.id} />
            <input type="hidden" name="itemId" value={item.id} />
            <button type="submit" className="text-sm text-red-700 dark:text-red-300 hover:underline">Punkt löschen</button>
          </ConfirmForm>
        </div>
      )}
    </div>
  )
}
