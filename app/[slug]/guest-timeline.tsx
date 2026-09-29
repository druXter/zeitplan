'use client'

import type { GuestPayload, GuestPayloadItem } from '../lib/guest/payload'
import { timelineSections } from '../lib/timeline'
import { formatClock, formatItemClock } from '../lib/timezone'
import { useGuestView, type Connection } from './use-guest-view'

/**
 * Gästeansicht (docs/KONZEPT.md Abschnitt 5): laufender Punkt hervorgehoben, "Als Nächstes", danach der Rest,
 * Vergangenes eingeklappt, Ort je Punkt. Zeigt nur den GuestPayload (aus toGuestView) und hält ihn per Polling
 * aktuell; ohne Verbindung bleibt der letzte Stand mit Hinweis stehen.
 */
export default function GuestTimeline({ slug, initial, etag, remember }: { slug: string; initial: GuestPayload; etag: string; remember: boolean }) {
  const { payload, connection } = useGuestView(slug, initial, etag, remember)
  const { event } = payload

  if (connection.gone) {
    return <p role="status" className="bg-white rounded-lg shadow p-4 text-gray-700">Dieser Ablauf ist gerade nicht verfügbar.</p>
  }

  const sections = timelineSections(payload.items, item => item.status, item => Date.parse(item.shownStart))
  const clock = (iso: string) => formatItemClock(new Date(iso), new Date(event.date), event.timezone)
  const nothingAhead = sections.now.length === 0 && sections.next.length === 0 && sections.later.length === 0
  const row = (item: GuestPayloadItem, highlight = false) => (
    <GuestRow key={item.id} item={item} clock={clock} showTracks={payload.showTracks} highlight={highlight} />
  )

  return (
    <div className="space-y-4">
      <ConnectionNote connection={connection} timezone={event.timezone} />

      {payload.items.length === 0 && (
        <p className="bg-white rounded-lg shadow p-4 text-gray-700">Der Ablauf wird gerade noch geplant. Schau später wieder vorbei.</p>
      )}
      {event.status === 'ENDED' && payload.items.length > 0 && (
        <p className="text-sm text-gray-600">Das Event ist vorbei – hier kannst du den Ablauf nachlesen.</p>
      )}

      {sections.now.length > 0 && (
        <Section title="Jetzt">
          <ul className="space-y-2">{sections.now.map(item => row(item, true))}</ul>
        </Section>
      )}
      {sections.next.length > 0 && (
        <Section title="Als Nächstes">
          <ul className="bg-white rounded-lg shadow divide-y divide-gray-200">{sections.next.map(item => row(item))}</ul>
        </Section>
      )}
      {sections.later.length > 0 && (
        <Section title="Danach">
          <ul className="bg-white rounded-lg shadow divide-y divide-gray-200">{sections.later.map(item => row(item))}</ul>
        </Section>
      )}
      {sections.past.length > 0 && (
        <details open={nothingAhead} className="group">
          <summary className="cursor-pointer text-lg font-bold py-1">Vorbei ({sections.past.length})</summary>
          <ul className="mt-2 bg-white rounded-lg shadow divide-y divide-gray-200 opacity-80">{sections.past.map(item => row(item))}</ul>
        </details>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  )
}

/** "Stand: 15:32, keine Verbindung" - nur, wenn die letzte Aktualisierung gescheitert ist. */
export function ConnectionNote({ connection, timezone, className = '' }: { connection: Connection; timezone: string; className?: string }) {
  if (!connection.offline) return null
  return (
    <p role="status" className={`rounded border border-amber-200 bg-amber-50 text-amber-900 p-2 text-sm ${className}`}>
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
      className={`p-3 flex gap-3 ${highlight ? 'bg-blue-50 border-2 border-blue-600 rounded-lg shadow' : ''}`}
    >
      <div className="w-24 shrink-0 tabular-nums">
        {cancelled ? (
          <span className="line-through text-gray-500">{clock(item.plannedStart)}</span>
        ) : item.approximate ? (
          <>
            {item.delayMin === null && <span className="block text-xs text-gray-600">neu:</span>}
            <span className="font-bold">ca. {clock(item.shownStart)}</span>
            {item.delayMin !== null && item.delayMin !== 0 && (
              <span className="block text-xs font-bold text-amber-800">{formatDelay(item.delayMin)}</span>
            )}
          </>
        ) : (
          <span className="font-bold">{clock(item.shownStart)}</span>
        )}
      </div>
      <div className="grow min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-1">
          <span className={`font-medium ${cancelled ? 'line-through text-gray-500' : ''}`}>{item.title}</span>
          {cancelled && <span className="text-xs rounded px-1.5 py-0.5 bg-red-100 text-red-900">fällt aus</span>}
          {showTracks && <span className="text-xs rounded px-1.5 py-0.5 bg-gray-100 text-gray-800">{item.track}</span>}
        </p>
        {item.location && <p className="text-sm text-gray-700">{item.location}</p>}
        {!cancelled && item.description && <p className="text-sm text-gray-700 whitespace-pre-line">{item.description}</p>}
        {cancelled && item.cancelReason && <p className="text-sm text-gray-700">{item.cancelReason}</p>}
      </div>
    </li>
  )
}
