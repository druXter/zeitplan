'use client'

import { useEffect, useState } from 'react'
import PendingButton from '../../../../ui/pending-button'
import { liveCommand } from './actions'

/**
 * "Rückgängig" für die eigene letzte Aktion (docs/KONZEPT.md Abschnitt 3): als Leiste unten am Bildschirm, mit
 * dem Daumen erreichbar, einige Sekunden sichtbar - danach bleibt Rückgängig im Verlauf möglich.
 */
export default function UndoBar({ eventId, track, actionId, description, seconds = 12 }: {
  eventId: string; track: string; actionId: string; description: string; seconds?: number
}) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), seconds * 1000)
    return () => clearTimeout(timer)
  }, [actionId, seconds])
  if (!visible) return null
  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <form action={liveCommand} className="max-w-xl mx-auto flex items-center gap-3 rounded-lg bg-gray-900 text-white shadow-lg p-3">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="track" value={track} />
        <input type="hidden" name="command" value="undo" />
        <input type="hidden" name="actionId" value={actionId} />
        <p className="grow min-w-0 text-sm">{description}</p>
        <PendingButton className="shrink-0 min-h-12 px-4 rounded bg-white text-gray-900 font-bold">Rückgängig</PendingButton>
      </form>
    </div>
  )
}
