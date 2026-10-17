'use client'

import type { GuestPayload, GuestPayloadItem } from '../lib/guest/payload'
import { timelineSections } from '../lib/timeline'
import { formatClock, formatItemClock } from '../lib/timezone'
import { useGuestView, type Connection } from './use-guest-view'
import AnnouncementBanner from './announcement-banner'
import { Badge } from '../ui/kit'

/**
 * Gästeansicht (docs/KONZEPT.md Abschnitt 5): laufender Punkt hervorgehoben, "Als Nächstes", danach der Rest,
 * Vergangenes eingeklappt, Ort je Punkt. Zeigt nur den GuestPayload (aus toGuestView) und hält ihn per Polling
 * aktuell; ohne Verbindung bleibt der letzte Stand mit Hinweis stehen.
 */
export default function GuestTimeline({ slug, initial, etag, remember }: { slug: string; initial: GuestPayload; etag: string; remember: boolean }) {
  const { payload, connection } = useGuestView(slug, initial, etag, remember)
  const { event } = payload

  if (connection.gone) {
    return <p role="status" className={`${CARD} p-4 text-gray-700 dark:text-gray-300`}>Dieser Ablauf ist gerade nicht verfügbar.</p>
  }

  const sections = timelineSections(payload.items, item => item.status, item => Date.parse(item.shownStart))
  const clock = (iso: string) => formatItemClock(new Date(iso), new Date(event.date), event.timezone)
  const nothingAhead = sections.now.length === 0 && sections.next.length === 0 && sections.later.length === 0
  const row = (item: GuestPayloadItem, highlight = false) => (
    <GuestRow key={item.id} item={item} clock={clock} showTracks={payload.showTracks} highlight={highlight} />
  )

  return (
    <div className="space-y-6">
      <ConnectionNote connection={connection} timezone={event.timezone} />
      <AnnouncementBanner announcement={payload.announcement} timezone={event.timezone} />

      {payload.items.length === 0 && (
        <p className={`${CARD} p-4 text-gray-700 dark:text-gray-300`}>Der Ablauf wird gerade noch geplant. Schau später wieder vorbei.</p>
      )}
      {event.status === 'ENDED' && payload.items.length > 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">Das Event ist vorbei – hier kannst du den Ablauf nachlesen.</p>
      )}

      {sections.now.length > 0 && (
        <Section title="Jetzt">
          <ul className="space-y-2">{sections.now.map(item => row(item, true))}</ul>
        </Section>
      )}
      {sections.next.length > 0 && (
        <Section title="Als Nächstes">
          <ul className={`${CARD} divide-y divide-gray-100 dark:divide-gray-700`}>{sections.next.map(item => row(item))}</ul>
        </Section>
      )}
      {sections.later.length > 0 && (
        <Section title="Danach">
          <ul className={`${CARD} divide-y divide-gray-100 dark:divide-gray-700`}>{sections.later.map(item => row(item))}</ul>
        </Section>
      )}
      {sections.past.length > 0 && (
        <details open={nothingAhead} className="group">
          <summary className={`${HEADING} flex min-h-11 cursor-pointer list-none items-center gap-1`}>
            <span aria-hidden className="inline-block transition group-open:rotate-90">▸</span> Vorbei ({sections.past.length})
          </summary>
          <ul className={`${CARD} mt-1 divide-y divide-gray-100 opacity-80 dark:divide-gray-700`}>{sections.past.map(item => row(item))}</ul>
        </details>
      )}
    </div>
  )
}

const CARD = 'rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800'
const HEADING = 'text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className={HEADING}>{title}</h2>
      {children}
    </section>
  )
}

/** "Stand: 15:32, keine Verbindung" - nur, wenn die letzte Aktualisierung gescheitert ist. */
export function ConnectionNote({ connection, timezone, className = '' }: { connection: Connection; timezone: string; className?: string }) {
  if (!connection.offline) return null
  return (
    <p role="status" className={`rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 p-2 text-sm ${className}`}>
      Stand: {formatClock(new Date(connection.lastOk), timezone)}, keine Verbindung
    </p>
  )
}

/** "+10" bzw. "−5" (nur mit showDelayToGuests). */
export function formatDelay(delayMin: number): string {
  return delayMin > 0 ? `+${delayMin}` : `−${Math.abs(delayMin)}`
}

function GuestRow({ item, clock, showTracks, highlight }: { item: GuestPayloadItem; clock: (iso: string) => string; showTracks: boolean; highlight: boolean }) {
  const cancelled = item.status === 'cancelled'
  return (
    <li
      data-item-status={item.status}
      className={`flex gap-3 p-4 ${highlight ? 'rounded-xl border-2 border-blue-500 bg-blue-50 shadow-sm dark:border-blue-600 dark:bg-blue-950/50' : ''}`}
    >
      <div className="w-20 shrink-0 tabular-nums">
        {cancelled ? (
          <span className="line-through text-gray-500 dark:text-gray-400">{clock(item.plannedStart)}</span>
        ) : item.approximate ? (
          <>
            {item.delayMin === null && <span className="block text-xs text-gray-600 dark:text-gray-400">neu:</span>}
            <span className={`font-semibold ${highlight ? 'text-lg' : ''}`}>ca. {clock(item.shownStart)}</span>
            {item.delayMin !== null && item.delayMin !== 0 && (
              <span className="block text-xs font-semibold text-amber-800 dark:text-amber-200">{formatDelay(item.delayMin)}</span>
            )}
          </>
        ) : (
          <span className={`font-semibold ${highlight ? 'text-lg' : ''}`}>{clock(item.shownStart)}</span>
        )}
      </div>
      <div className="min-w-0 grow space-y-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className={`${highlight ? 'text-lg font-semibold' : 'font-medium'} ${cancelled ? 'line-through text-gray-500 dark:text-gray-400' : ''}`}>{item.title}</span>
          {cancelled && <Badge tone="red">fällt aus</Badge>}
          {showTracks && <Badge>{item.track}</Badge>}
        </p>
        {item.location && <p className="text-sm text-gray-700 dark:text-gray-300">{item.location}</p>}
        {item.address && (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {item.address}
            {item.routeUrl && (
              <>
                {' · '}
                <a href={item.routeUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 dark:text-blue-300 underline">Route öffnen</a>
              </>
            )}
          </p>
        )}
        {!cancelled && item.description && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{item.description}</p>}
        {cancelled && item.cancelReason && <p className="text-sm text-gray-700 dark:text-gray-300">{item.cancelReason}</p>}
      </div>
    </li>
  )
}
