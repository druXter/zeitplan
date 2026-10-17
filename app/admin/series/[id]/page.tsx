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
import { ButtonLink, buttonClass, Card, EmptyState, Main, PageHeader, sectionTitleClass, SettingsSection } from '../../../ui/kit'
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
    <Main>
      <PageHeader
        back={{ href: '/admin/series', label: 'Alle Reihen' }}
        title={series.title}
        subtitle={`${series.events.length === 1 ? '1 Event' : `${series.events.length} Events`} · /${series.slug}`}
        actions={<ButtonLink href={`/${series.slug}`} external size="sm">Seite für Gäste ↗</ButtonLink>}
      />
      <div className="space-y-6">
        {created === '1' && <Notice tone="success">Reihe angelegt. Ordne ihr in den Einstellungen deiner Events Events zu.</Notice>}
        <section className="space-y-3">
          <h2 className={sectionTitleClass}>Events der Reihe</h2>
          {series.events.length === 0 ? (
            <EmptyState>Noch keine Events zugeordnet.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {series.events.map(event => (
                <li key={event.id}>
                  <Link href={`/admin/events/${event.id}`} className="group flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700">
                    <span className="font-semibold group-hover:text-blue-700 dark:group-hover:text-blue-300">{event.title}</span>
                    <StatusBadge status={event.status} />
                    <span className="w-full text-sm text-gray-500 dark:text-gray-400">{formatDate(event.date, event.timezone)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Die Übersicht für Gäste unter <Link href={`/${series.slug}`} className="text-blue-700 dark:text-blue-300 hover:underline">{baseUrl()}/{series.slug}</Link>{' '}
            zeigt Titel, Datum und Link der veröffentlichten, laufenden und beendeten Events.
          </p>
        </section>
        <div className="space-y-3">
          <SettingsSection id="einstellungen" title="Einstellungen" summary={`/${series.slug}`}>
            <SeriesForm baseUrl={baseUrl()} seriesId={series.id} values={{ title: series.title, slug: series.slug }} />
          </SettingsSection>
          <Card className="space-y-3">
            <h2 className="font-semibold">Reihe löschen</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400">Die Events bleiben erhalten, nur die gemeinsame Übersicht entfällt.</p>
            <ConfirmForm action={deleteSeries} message={`Reihe „${series.title}“ löschen?`}>
              <input type="hidden" name="seriesId" value={series.id} />
              <button type="submit" className={buttonClass('danger')}>Reihe löschen</button>
            </ConfirmForm>
          </Card>
        </div>
      </div>
    </Main>
  )
}
