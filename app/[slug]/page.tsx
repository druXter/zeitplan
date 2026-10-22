import { Notice } from '../ui/kit'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { APP_NAME } from '../lib/app'
import { STATUS_LABELS } from '../lib/events/settings'
import { loadGuestPayload, payloadEtag, resolveGuestEvent } from '../lib/guest/store'
import { loadPublicSeries } from '../lib/guest/series'
import { formatDate } from '../lib/timezone'
import { accessCodeConfigured } from '../lib/guest/tokens'
import { reminderSummary } from '../lib/guest/payload'
import { vapidPublicKey } from '../lib/push'
import GuestTimeline from './guest-timeline'
import AccessGate from './access-gate'
import ReminderToggle from './reminder-toggle'

export const dynamic = 'force-dynamic'

/**
 * /<slug>: Gästeansicht eines Events oder Übersicht einer Reihe (beide teilen sich den Namensraum, siehe
 * app/lib/planning/slug-store.ts). Nicht indexiert; nicht einbettbar (next.config.ts).
 *
 * Gästeansicht: Sichtbarkeit nach app/lib/guest/access.ts. Der Ablauf kommt ausschließlich aus
 * loadGuestPayload (toGuestView) - dieselben Daten wie der Polling-Endpunkt, mit dem die Seite sich aktualisiert.
 * Geschützte Events ohne gültigen Zugang zeigen nur Titel und den Weg hinein (AccessGate) - nie den Ablauf.
 * Bietet das Event Erinnerungen an (Idee L12), steht unter dem Kopf der Schalter dafür (ReminderToggle).
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
      <GuestMain>
        <header className={`${CARD} p-6`}>
          <p className="text-xs font-medium uppercase tracking-wide text-purple-700 dark:text-purple-300">Reihe</p>
          <h1 className="text-2xl font-semibold break-words sm:text-3xl">{series.title}</h1>
        </header>
        {series.events.length === 0 ? (
          <p className={`${CARD} p-4 text-gray-700 dark:text-gray-300`}>Hier erscheinen die Abläufe, sobald sie veröffentlicht sind.</p>
        ) : (
          <ul className="space-y-3">
            {series.events.map(event => (
              <li key={event.slug}>
                <Link href={`/${event.slug}`} className={`${CARD} flex items-center justify-between gap-3 p-4 transition hover:border-blue-300 hover:shadow dark:hover:border-blue-700`}>
                  <span className="min-w-0">
                    <span className="block font-semibold">{event.title}</span>
                    <span className="block text-sm text-gray-600 dark:text-gray-400">{formatDate(event.date, event.timezone)}</span>
                  </span>
                  <span aria-hidden className="text-gray-400">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </GuestMain>
    )
  }

  const { event, visibility } = resolved
  if (visibility === 'protected') {
    return (
      <GuestMain>
        <header className={`${CARD} p-6`}>
          <h1 className="text-2xl font-semibold break-words sm:text-3xl">{event.title}</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Dieser Ablauf ist nur mit Zugang sichtbar.</p>
        </header>
        <AccessGate slug={event.slug} access={event.access} codeAvailable={event.access === 'CODE' && event.hasAccessCode && accessCodeConfigured()} />
      </GuestMain>
    )
  }

  const payload = await loadGuestPayload(event, new Date())
  const preview = visibility === 'preview'
  const publicKey = vapidPublicKey()
  return (
    <GuestMain>
      {preview && (
        <Notice tone="warning">
          Vorschau: {event.access !== 'PUBLIC' && event.status !== 'DRAFT' && event.status !== 'ARCHIVED'
            ? 'Gäste sehen diesen Ablauf nur mit Zugang.'
            : `Dieses Event ist „${STATUS_LABELS[event.status]}“ und für Gäste nicht sichtbar.`}{' '}
          <Link href={`/admin/events/${event.id}`} className="underline">Zur Verwaltung</Link>
        </Notice>
      )}
      <header className={`${CARD} p-6`} data-testid="event-header">
        {event.series && (
          <p className="text-xs font-medium uppercase tracking-wide"><Link href={`/${event.series.slug}`} className="text-purple-700 hover:underline dark:text-purple-300">{event.series.title}</Link></p>
        )}
        <h1 className="text-2xl font-semibold break-words sm:text-3xl">{event.title}</h1>
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300"><span aria-hidden>📅 </span>{formatDate(event.date, event.timezone)}</p>
        {event.description && <p className="mt-4 whitespace-pre-line text-gray-700 dark:text-gray-300">{event.description}</p>}
      </header>
      {payload.reminders && publicKey && <ReminderToggle slug={event.slug} publicKey={publicKey} summary={reminderSummary(payload.reminders)} />}
      <GuestTimeline slug={event.slug} initial={payload} etag={payloadEtag(payload)} remember={!preview} />
    </GuestMain>
  )
}

const CARD = 'rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800'

/** Rahmen der Gästeseiten: schmal wie in rsvp-app, auf dem Handy mit wenig Rand. */
function GuestMain({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 text-gray-900 sm:py-8 dark:text-gray-100">{children}</main>
}
