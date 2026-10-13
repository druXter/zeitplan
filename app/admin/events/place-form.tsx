'use client'

import { useActionState } from 'react'
import { savePlace } from './place-actions'
import { PLACE_LIMITS } from '../../lib/planning/places'
import { Feedback } from './event-forms'

const field = 'w-full border border-gray-300 dark:border-gray-600 p-2 rounded text-sm'

/** Ort anlegen (ohne place) oder ändern (Idee L22). Geprüft wird in savePlace. */
export default function PlaceForm({ eventId, place }: { eventId: string; place?: { id: string; name: string; address: string; mapUrl: string | null } }) {
  const [state, action, pending] = useActionState(savePlace, null)
  const prefix = place ? `place-${place.id}` : 'place-new'
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="eventId" value={eventId} />
      {place && <input type="hidden" name="placeId" value={place.id} />}
      <Feedback state={state} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${prefix}-name`} className="block text-xs font-medium mb-1">Name (wie im Feld „Ort“)</label>
          <input id={`${prefix}-name`} name="name" required maxLength={PLACE_LIMITS.nameMax} defaultValue={place?.name} placeholder="z. B. Kirche St. Marien" className={field} />
        </div>
        <div>
          <label htmlFor={`${prefix}-address`} className="block text-xs font-medium mb-1">Adresse</label>
          <input id={`${prefix}-address`} name="address" required maxLength={PLACE_LIMITS.addressMax} defaultValue={place?.address} placeholder="Straße 1, 12345 Ort" className={field} />
        </div>
      </div>
      <div>
        <label htmlFor={`${prefix}-map`} className="block text-xs font-medium mb-1">Eigener Kartenlink (optional, sonst Route über Google Maps)</label>
        <input id={`${prefix}-map`} name="mapUrl" type="url" maxLength={PLACE_LIMITS.mapUrlMax} defaultValue={place?.mapUrl ?? ''} placeholder="https://…" className={field} />
      </div>
      <button type="submit" disabled={pending} className="py-1.5 px-3 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900 text-sm disabled:opacity-50">
        {place ? 'Ort speichern' : 'Ort anlegen'}
      </button>
    </form>
  )
}
