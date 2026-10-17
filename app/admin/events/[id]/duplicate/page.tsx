import { redirect } from 'next/navigation'
import { requireUser } from '../../../../lib/auth'
import { canCreateEvents } from '../../../../lib/permissions'
import { baseUrl } from '../../../../lib/base-url'
import { loadEventOr404 } from '../../../../lib/events/store'
import { DuplicateEventForm } from '../../event-forms'
import { Card } from '../../../../ui/kit'

export const dynamic = 'force-dynamic'

export default async function DuplicateEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/duplicate`)
  const event = await loadEventOr404(id, user)
  if (!canCreateEvents(user)) redirect(`/admin/events/${event.id}`)

  return (
    <Card className="max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">Event duplizieren</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Kopiert Spuren und Programmpunkte samt Einstellungen in ein neues Event (Entwurf) – ohne Live-Stand, Freigaben
        und Rechte der Moderator*innen. Geheime Punkte, die du nicht sehen darfst, werden nur mit Zeit und Dauer als
        „Geheimer Punkt“ übernommen.
      </p>
      <DuplicateEventForm eventId={event.id} title={event.title} baseUrl={baseUrl()} />
    </Card>
  )
}
