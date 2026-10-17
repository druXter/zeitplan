import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { baseUrl } from '../../lib/base-url'
import { canCreateEvents } from '../../lib/permissions'
import Notice from '../../ui/notice'
import { Card, EmptyState, Main, PageHeader } from '../../ui/kit'
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
    <Main>
      <PageHeader
        title="Reihen"
        subtitle="Mehrere Events – z. B. Polterabend, Hochzeit und Brunch – mit einer gemeinsamen Übersichtsseite. Die Zuordnung legst du in den Einstellungen eines Events fest."
      />
      <div className="space-y-6">
        {deleted === '1' && <Notice tone="success">Reihe gelöscht. Ihre Events bleiben erhalten.</Notice>}
        {series.length === 0 ? (
          <EmptyState>Noch keine Reihen. Lege unten die erste an.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {series.map(entry => (
              <li key={entry.id}>
                <Link href={`/admin/series/${entry.id}`} className="group flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700">
                  <span className="min-w-0">
                    <span className="block font-semibold group-hover:text-blue-700 dark:group-hover:text-blue-300">{entry.title}</span>
                    <span className="block text-sm text-gray-500 dark:text-gray-400">/{entry.slug} · {entry._count.events === 1 ? '1 Event' : `${entry._count.events} Events`}</span>
                  </span>
                  <span aria-hidden className="text-gray-400">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Card className="space-y-4">
          <h2 className="font-semibold">Neue Reihe</h2>
          <SeriesForm baseUrl={baseUrl()} />
        </Card>
      </div>
    </Main>
  )
}
