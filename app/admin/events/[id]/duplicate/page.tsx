import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireUser } from '../../../../lib/auth'
import { canCreateEvents } from '../../../../lib/permissions'
import { baseUrl } from '../../../../lib/base-url'
import { loadEventOr404 } from '../../../../lib/events/store'
import { DuplicateEventForm } from '../../event-forms'

export const dynamic = 'force-dynamic'

export default async function DuplicateEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/duplicate`)
  const event = await loadEventOr404(id, user)
  if (!canCreateEvents(user)) redirect(`/admin/events/${event.id}`)

  return (
    <main className="bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4 text-gray-900 dark:text-gray-100">
        <p className="text-sm"><Link href={`/admin/events/${event.id}`} className="text-blue-700 dark:text-blue-300 hover:underline">{event.title}</Link></p>
        <h1 className="text-2xl font-bold">Event duplizieren</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Kopiert Spuren und Programmpunkte samt Einstellungen in ein neues Event (Entwurf) – ohne Live-Stand, Freigaben
          und Rechte der Moderator*innen. Geheime Punkte, die du nicht sehen darfst, werden nur mit Zeit und Dauer als
          „Geheimer Punkt“ übernommen.
        </p>
        <DuplicateEventForm eventId={event.id} title={event.title} baseUrl={baseUrl()} />
      </div>
    </main>
  )
}
