import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { baseUrl } from '../../lib/base-url'
import { canCreateEvents } from '../../lib/permissions'
import Notice from '../../ui/notice'
import SeriesForm from './series-form'

export const dynamic = 'force-dynamic'

/** Reihen: eigene (Admins: alle) mit Anzahl der Events, dazu "Neue Reihe". */
export default async function SeriesPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const user = await requireUser('/admin/series')
  if (!canCreateEvents(user)) redirect('/admin')
  const { deleted } = await searchParams
  const series = await prisma.series.findMany({
    where: user.role === 'ADMIN' ? {} : { ownerId: user.id },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, slug: true, _count: { select: { events: true } } }
  })

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-4 text-gray-900">
        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h1 className="text-2xl font-bold">Reihen</h1>
          <p className="text-sm text-gray-600">
            Mehrere Events – z. B. Polterabend, Hochzeit und Brunch – mit einer gemeinsamen Übersichtsseite. Die Zuordnung
            legst du in den Einstellungen eines Events fest.
          </p>
          {deleted === '1' && <Notice tone="success">Reihe gelöscht. Ihre Events bleiben erhalten.</Notice>}
          {series.length === 0 ? (
            <p className="text-sm text-gray-600">Noch keine Reihen.</p>
          ) : (
            <ul className="divide-y text-sm">
              {series.map(entry => (
                <li key={entry.id} className="py-2">
                  <Link href={`/admin/series/${entry.id}`} className="font-medium text-blue-700 hover:underline">{entry.title}</Link>
                  <div className="text-xs text-gray-600">/{entry.slug} · {entry._count.events === 1 ? '1 Event' : `${entry._count.events} Events`}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h2 className="font-bold">Neue Reihe</h2>
          <SeriesForm baseUrl={baseUrl()} />
        </div>
      </div>
    </main>
  )
}
