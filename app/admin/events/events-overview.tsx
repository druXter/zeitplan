// app/admin/events/events-overview.tsx
import Link from 'next/link'
import type { EventStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import type { CurrentUser } from '../../lib/auth'
import { canCreateEvents } from '../../lib/permissions'
import { formatDate, formatItemClock, utcToZonedDate } from '../../lib/timezone'
import { Badge, ButtonLink, EmptyState, Main, PageHeader, sectionTitleClass, Notice, InstallHint } from '../../ui/kit'
import StatusBadge from '../../ui/status-badge'

const CURRENT: EventStatus[] = ['DRAFT', 'PUBLISHED', 'LIVE']

type Row = {
  id: string; title: string; slug: string; status: EventStatus; timezone: string; date: Date
  items: number; tracks: number; first: Date | null; last: Date | null; series: string | null
  shared: boolean; owner: string | null; today: boolean
}

const MONTH = (timeZone: string) => new Intl.DateTimeFormat('de-DE', { timeZone, month: 'short' })
const DAY = (timeZone: string) => new Intl.DateTimeFormat('de-DE', { timeZone, day: '2-digit' })

/**
 * Übersicht „Events“ (docs/KONZEPT-OBERFLAECHE.md) unter /admin und /admin/events: Aktuell (Entwurf, veröffentlicht,
 * live) und eingeklappt Vergangen (beendet, archiviert). Pro Event Tag, Status, Reihe, Freigabe, Programmpunkte und
 * Zeitraum laut Plan. Ist ein Event live oder heute, hat die Karte den Knopf „Live-Steuerung“. Admins sehen alle
 * Events mit Besitz.
 */
export default async function EventsOverview({ user, deleted }: { user: CurrentUser; deleted: boolean }) {
  const now = new Date()
  // Admins sehen alle Events, alle anderen die eigenen und die ihnen freigegebenen -
  // dieselbe Regel wie eventLevel (app/lib/permissions.ts), hier nur als Abfrage.
  const events = await prisma.event.findMany({
    where: user.role === 'ADMIN' ? {} : { OR: [{ ownerId: user.id }, { shares: { some: { userId: user.id } } }] },
    orderBy: { date: 'asc' },
    select: {
      id: true, slug: true, title: true, status: true, date: true, timezone: true, ownerId: true,
      owner: { select: { email: true } },
      series: { select: { title: true } },
      shares: { where: { userId: user.id }, select: { id: true } },
      // Nur Zeit und Dauer - Titel (auch geheimer Punkte) braucht die Übersicht nicht.
      items: { where: { status: { not: 'CANCELLED' } }, select: { plannedStart: true, plannedDurationMin: true } },
      _count: { select: { items: true, tracks: true } }
    }
  })
  const rows: Row[] = events.map(event => {
    const starts = event.items.map(item => item.plannedStart.getTime())
    const ends = event.items.map(item => item.plannedStart.getTime() + item.plannedDurationMin * 60_000)
    return {
      id: event.id, title: event.title, slug: event.slug, status: event.status, timezone: event.timezone, date: event.date,
      items: event._count.items, tracks: event._count.tracks,
      first: starts.length ? new Date(Math.min(...starts)) : null,
      last: ends.length ? new Date(Math.max(...ends)) : null,
      series: event.series?.title ?? null,
      shared: event.ownerId !== user.id && event.shares.length > 0,
      owner: event.ownerId !== user.id && user.role === 'ADMIN' ? event.owner?.email ?? 'gelöschtes Konto' : null,
      today: utcToZonedDate(event.date, event.timezone) === utcToZonedDate(now, event.timezone)
    }
  })
  const current = rows.filter(row => CURRENT.includes(row.status))
  const past = rows.filter(row => !CURRENT.includes(row.status)).reverse()

  return (
    <Main>
      <PageHeader
        title="Events"
        subtitle={canCreateEvents(user) ? 'Ablauf planen, live steuern und Gästen die aktuelle Prognose zeigen.' : 'Die Events, die für dich freigegeben wurden.'}
        actions={canCreateEvents(user) ? <>
          <ButtonLink href="/admin/events/import">Importieren</ButtonLink>
          <ButtonLink href="/admin/events/new" variant="primary">Neues Event</ButtonLink>
        </> : undefined}
      />
      <div className="space-y-6">
        {deleted && <Notice tone="success">Event gelöscht.</Notice>}
        {rows.length === 0 && (
          <EmptyState>{canCreateEvents(user) ? 'Noch keine Events. Lege oben das erste an.' : 'Dir wurden noch keine Events freigegeben.'}</EmptyState>
        )}
        {current.length > 0 && (
          <section>
            <h2 className={sectionTitleClass}>Aktuell</h2>
            <ul className="space-y-3">{current.map(row => <EventRow key={row.id} row={row} />)}</ul>
          </section>
        )}
        {past.length > 0 && (
          <details className="group">
            <summary className={`${sectionTitleClass} cursor-pointer list-none`}>
              <span className="inline-block transition group-open:rotate-90" aria-hidden>▸</span> Vergangen ({past.length})
            </summary>
            <ul className="space-y-3">{past.map(row => <EventRow key={row.id} row={row} muted />)}</ul>
          </details>
        )}
        <InstallHint />
      </div>
    </Main>
  )
}

function EventRow({ row, muted = false }: { row: Row; muted?: boolean }) {
  const live = row.status === 'LIVE'
  const showLive = live || (row.status === 'PUBLISHED' && row.today)
  const clock = (date: Date) => formatItemClock(date, row.date, row.timezone)
  return (
    <li className={`rounded-xl border bg-white shadow-sm transition hover:shadow dark:bg-gray-800 ${live ? 'border-red-300 dark:border-red-800' : 'border-gray-200 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-700'} ${muted ? 'opacity-75' : ''}`} data-testid="event-row">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:gap-4">
        <Link href={`/admin/events/${row.id}`} className="group flex min-w-0 flex-1 gap-4">
          <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-gray-50 py-2 text-center dark:bg-gray-900">
            <span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{MONTH(row.timezone).format(row.date)}</span>
            <span className="text-xl font-semibold leading-tight">{DAY(row.timezone).format(row.date)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold group-hover:text-blue-700 dark:group-hover:text-blue-300">{row.title}</span>
              <StatusBadge status={row.status} />
              {row.shared && <Badge tone="teal">freigegeben</Badge>}
            </div>
            <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">
              {formatDate(row.date, row.timezone)}{row.series ? ` · ${row.series}` : ''}{row.owner ? ` · ${row.owner}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-300" data-testid="event-row-stats">
              <span><strong className="font-semibold">{row.items}</strong> {row.items === 1 ? 'Programmpunkt' : 'Programmpunkte'}</span>
              {row.tracks > 1 && <span><strong className="font-semibold">{row.tracks}</strong> Spuren</span>}
              {row.first && row.last && <span className="tabular-nums">{clock(row.first)}–{clock(row.last)} Uhr</span>}
            </div>
          </div>
        </Link>
        {showLive && (
          <div className="shrink-0 sm:self-center [&>a]:w-full">
            <ButtonLink href={`/admin/events/${row.id}/live`} variant="primary">Live-Steuerung</ButtonLink>
          </div>
        )}
      </div>
    </li>
  )
}
