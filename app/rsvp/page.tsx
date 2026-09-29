import type { Metadata } from 'next'
import Notice from '../ui/notice'

export const metadata: Metadata = { title: 'Zeitplan öffnen', robots: { index: false, follow: false } }

/**
 * Ziel ungültiger Links aus rsvp-app (app/rsvp/[eventId]/route.ts): immer dieselbe Meldung - ob es das Event
 * gibt, verrät die Seite nicht.
 */
export default function RsvpLinkInvalidPage() {
  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-4 text-gray-900">
        <h1 className="text-2xl font-bold">Zeitplan öffnen</h1>
        <Notice tone="warning">
          Dieser Link ist ungültig oder abgelaufen, oder der Zeitplan ist noch nicht veröffentlicht. Öffne ihn bitte erneut
          über „Zeitplan“ bei deiner Zusage.
        </Notice>
      </div>
    </main>
  )
}
