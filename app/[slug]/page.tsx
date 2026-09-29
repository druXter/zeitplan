import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { APP_NAME } from '../lib/app'
import { STATUS_LABELS } from '../lib/events/settings'
import { loadGuestPayload, payloadEtag, resolveGuestEvent } from '../lib/guest/store'
import { loadPublicSeries } from '../lib/guest/series'
import { formatDate } from '../lib/timezone'
import Notice from '../ui/notice'
import GuestTimeline from './guest-timeline'

export const dynamic = 'force-dynamic'

/**
 * /<slug>: Gästeansicht eines Events oder Übersicht einer Reihe (beide teilen sich den Namensraum, siehe
 * app/lib/planning/slug-store.ts). Nicht indexiert; nicht einbettbar (next.config.ts).
 *
 * Gästeansicht: Sichtbarkeit nach app/lib/guest/access.ts. Der Ablauf kommt ausschließlich aus
 * loadGuestPayload (toGuestView) - dieselben Daten wie der Polling-Endpunkt, mit dem die Seite sich aktualisiert.
 */
async function resolve(slug: string) {
  const event = await resolveGuestEvent(slug)
  if (event) return { kind: 'event' as const, ...event }
  const series = await loadPublicSeries(slug)
  return series ? { kind: 'series' as const, series } : null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const resolved = await resolve((await params).slug)
  const title = resolved?.kind === 'event' ? resolved.event.title : resolved?.kind === 'series' ? resolved.series.title : null
  return { title: title ? `${title} – ${APP_NAME}` : APP_NAME, robots: { index: false, follow: false } }
}

export default async function GuestPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolved = await resolve((await params).slug)
  if (!resolved) notFound()

  if (resolved.kind === 'series') {
    const { series } = resolved
    return (
      <main className="bg-gray-50 py-6 px-4">
        <div className="max-w-2xl mx-auto space-y-4 text-gray-900">
          <h1 className="text-2xl font-bold">{series.title}</h1>
          {series.events.length === 0 ? (
            <p className="bg-white rounded-lg shadow p-4 text-gray-700">Hier erscheinen die Abläufe, sobald sie veröffentlicht sind.</p>
          ) : (
            <ul className="bg-white rounded-lg shadow divide-y divide-gray-200">
              {series.events.map(event => (
                <li key={event.slug}>
                  <Link href={`/${event.slug}`} className="block p-4 hover:bg-gray-50">
                    <span className="block font-medium text-blue-700">{event.title}</span>
                    <span className="block text-sm text-gray-600">{formatDate(event.date, event.timezone)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    )
  }

  const { event, visibility } = resolved
  if (visibility === 'protected') {
    // Zugang per Code, Konto oder rsvp-Link folgt mit Phase 5/7b - bis dahin kein Inhalt außer dem Titel.
    return (
      <main className="bg-gray-50 py-6 px-4">
        <div className="max-w-2xl mx-auto space-y-4 text-gray-900">
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <Notice tone="info">Dieser Ablauf ist nur mit Zugang sichtbar.</Notice>
        </div>
      </main>
    )
  }

  const payload = await loadGuestPayload(event, new Date())
  const preview = visibility === 'preview'
  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-4 text-gray-900">
        {preview && (
          <Notice tone="warning">
            Vorschau: {event.access !== 'PUBLIC' && event.status !== 'DRAFT' && event.status !== 'ARCHIVED'
              ? 'Gäste sehen diesen Ablauf nur mit Zugang.'
              : `Dieses Event ist „${STATUS_LABELS[event.status]}“ und für Gäste nicht sichtbar.`}{' '}
            <Link href={`/admin/events/${event.id}`} className="underline">Zur Verwaltung</Link>
          </Notice>
        )}
        <header className="space-y-1">
          {event.series && (
            <p className="text-sm"><Link href={`/${event.series.slug}`} className="text-blue-700 hover:underline">{event.series.title}</Link></p>
          )}
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-gray-700">{formatDate(event.date, event.timezone)}</p>
          {event.description && <p className="text-sm text-gray-700 whitespace-pre-line pt-1">{event.description}</p>}
        </header>
        <GuestTimeline slug={event.slug} initial={payload} etag={payloadEtag(payload)} remember={!preview} />
      </div>
    </main>
  )
}
