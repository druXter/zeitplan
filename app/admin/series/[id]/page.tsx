import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { requireUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { canManageSeries } from '../../../lib/events/series'
import { formatDate } from '../../../lib/timezone'
import ConfirmForm from '../../../ui/confirm-form'
import Notice from '../../../ui/notice'
import StatusBadge from '../../../ui/status-badge'
import { deleteSeries } from '../actions'
import SeriesForm from '../series-form'

export const dynamic = 'force-dynamic'

export default async function SeriesDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/series/${id}`)
  const series = await prisma.series.findUnique({
    where: { id },
    include: { events: { orderBy: { date: 'asc' }, select: { id: true, title: true, date: true, timezone: true, status: true } } }
  })
  if (!series || !canManageSeries(user, series)) notFound()
  const { created } = await searchParams

  return (
    <main className="bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-4 text-gray-900 dark:text-gray-100">
        <p className="text-sm"><Link href="/admin/series" className="text-blue-700 dark:text-blue-300 hover:underline">Alle Reihen</Link></p>
        <h1 className="text-2xl font-bold">{series.title}</h1>
        {created === '1' && <Notice tone="success">Reihe angelegt. Ordne ihr in den Einstellungen deiner Events Events zu.</Notice>}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow space-y-2">
          <h2 className="font-bold">Events der Reihe</h2>
          {series.events.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">Noch keine Events zugeordnet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {series.events.map(event => (
                <li key={event.id} className="py-2">
                  <Link href={`/admin/events/${event.id}`} className="text-blue-700 dark:text-blue-300 hover:underline">{event.title}</Link>{' '}
                  <StatusBadge status={event.status} />
                  <div className="text-xs text-gray-600 dark:text-gray-400">{formatDate(event.date, event.timezone)}</div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Die Übersicht für Gäste unter <Link href={`/${series.slug}`} className="text-blue-700 dark:text-blue-300 hover:underline">{baseUrl()}/{series.slug}</Link>{' '}
            zeigt Titel, Datum und Link der veröffentlichten, laufenden und beendeten Events.
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow space-y-3">
          <h2 className="font-bold">Einstellungen</h2>
          <SeriesForm baseUrl={baseUrl()} seriesId={series.id} values={{ title: series.title, slug: series.slug }} />
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow space-y-2">
          <h2 className="font-bold">Reihe löschen</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400">Die Events bleiben erhalten, nur die gemeinsame Übersicht entfällt.</p>
          <ConfirmForm action={deleteSeries} message={`Reihe „${series.title}“ löschen?`}>
            <input type="hidden" name="seriesId" value={series.id} />
            <button type="submit" className="text-sm text-red-700 dark:text-red-300 hover:underline">Reihe löschen</button>
          </ConfirmForm>
        </div>
      </div>
    </main>
  )
}
