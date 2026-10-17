import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { APP_NAME } from '../../lib/app'
import { formatDate, formatItemClock } from '../../lib/timezone'
import { currentAnnouncement } from '../../lib/guest/announcement'
import { loadTeamView, resolveCrewEvent } from '../../lib/team/view'
import AutoRefresh from '../../ui/auto-refresh'
import TeamTimeline from '../../ui/team-timeline'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string | string[] }> }

async function crewKeyOf(searchParams: Props['searchParams']): Promise<string | undefined> {
  const { k } = await searchParams
  return typeof k === 'string' ? k : undefined
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const event = await resolveCrewEvent((await params).slug, await crewKeyOf(searchParams))
  return { title: event ? `${event.title} – Ablauf fürs Team – ${APP_NAME}` : APP_NAME, robots: { index: false, follow: false } }
}

/**
 * Team-Link für Dienstleister (Idee L18): Team-Ansicht nur lesen, ohne Konto - für DJ, Fotograf*in oder Catering.
 * Zeigt Team-Punkte und interne Notizen, geheime Punkte nur als Platzhalter mit Zeit und Dauer, Zuständige nur mit
 * Namen. Keine Links in die Verwaltung, keine Aktionen. Lädt sich alle 30 s neu.
 */
export default async function CrewPage({ params, searchParams }: Props) {
  const event = await resolveCrewEvent((await params).slug, await crewKeyOf(searchParams))
  if (!event) notFound()
  const now = new Date()
  const view = await loadTeamView(event, { kind: 'crew' }, now)
  return (
    <main className="py-6 px-4">
      <AutoRefresh />
      <div className="max-w-3xl mx-auto space-y-4 text-gray-900 dark:text-gray-100">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{event.title}</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Ablauf fürs Team, {formatDate(event.date, event.timezone)}. Stand {formatItemClock(now, event.date, event.timezone)} Uhr,
            minutengenau mit Verspätungen; aktualisiert sich alle 30 Sekunden. Bitte nicht an Gäste weitergeben.
          </p>
        </div>
        <TeamTimeline view={view} event={event} now={now} announcement={currentAnnouncement(event, now)} />
      </div>
    </main>
  )
}
