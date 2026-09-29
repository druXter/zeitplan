import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireUser } from '../../../lib/auth'
import { canCreateEvents } from '../../../lib/permissions'
import { baseUrl } from '../../../lib/base-url'
import { ImportEventForm } from '../event-forms'

export const dynamic = 'force-dynamic'

export default async function ImportEventPage() {
  const user = await requireUser('/admin/events/import')
  if (!canCreateEvents(user)) redirect('/admin/events')

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white p-6 rounded-lg shadow space-y-4 text-gray-900">
        <p className="text-sm"><Link href="/admin/events" className="text-blue-700 hover:underline">Alle Events</Link></p>
        <h1 className="text-2xl font-bold">Ablauf importieren</h1>
        <p className="text-sm text-gray-600">
          Legt aus einer exportierten Ablauf-Datei ein neues Event an (Entwurf). Ein bestehendes Event wird dabei nie
          überschrieben. Geheime Punkte siehst danach nur du.
        </p>
        <ImportEventForm baseUrl={baseUrl()} />
      </div>
    </main>
  )
}
