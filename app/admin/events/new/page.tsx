// app/admin/events/new/page.tsx
import { redirect } from 'next/navigation'
import { requireUser } from '../../../lib/auth'
import { canCreateEvents } from '../../../lib/permissions'
import { baseUrl } from '../../../lib/base-url'
import { CreateEventForm } from '../event-forms'

export const dynamic = 'force-dynamic'

export default async function NewEventPage() {
  const user = await requireUser('/admin/events/new')
  if (!canCreateEvents(user)) redirect('/admin/events')

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white p-6 rounded-lg shadow space-y-4 text-gray-900">
        <h1 className="text-2xl font-bold">Neues Event</h1>
        <CreateEventForm baseUrl={baseUrl()} />
      </div>
    </main>
  )
}
