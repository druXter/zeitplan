'use client'

import { useActionState } from 'react'
import { savePlace } from './place-actions'
import { PLACE_LIMITS } from '../../lib/planning/places'
import { Feedback } from './event-forms'

const field = 'w-full rounded-lg border border-gray-300 bg-white p-2 text-base sm:text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900'

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
      <button type="submit" disabled={pending} className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-60 whitespace-nowrap px-3.5 py-2 text-sm bg-white text-gray-800 hover:bg-gray-50 border border-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-700">
        {place ? 'Ort speichern' : 'Ort anlegen'}
      </button>
    </form>
  )
}
