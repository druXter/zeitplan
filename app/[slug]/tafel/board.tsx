'use client'

import { useSyncExternalStore } from 'react'
import type { GuestPayload, GuestPayloadItem } from '../../lib/guest/payload'
import { timelineSections } from '../../lib/timeline'
import { formatClock, formatItemClock } from '../../lib/timezone'
import { ConnectionNote, formatDelay } from '../guest-timeline'
import { useGuestView } from '../use-guest-view'

/**
 * Anzeigetafel für Beamer/TV (docs/KONZEPT.md Abschnitt 5): große Schrift, jetzt und die nächsten 3-4 Punkte,
 * Uhr, lädt selbst nach. Füllt den ganzen Bildschirm ohne Scrollen - Schriftgrößen in vh, lange Titel gekürzt,
 * höchstens 5 Punkte. Dieselben Daten wie die Gästeansicht (GuestPayload aus toGuestView).
 */
export default function Board({ slug, initial, etag, remember }: { slug: string; initial: GuestPayload; etag: string; remember: boolean }) {
  const { payload, connection } = useGuestView(slug, initial, etag, remember)
  const { event } = payload
  const sections = timelineSections(payload.items, item => item.status, item => Date.parse(item.shownStart))
  const upcoming = [...sections.next, ...sections.later]
  const running = sections.now.length > 0
  const primary = running ? sections.now.slice(0, 2) : upcoming.slice(0, 1)
  const rest = (running ? upcoming : upcoming.slice(1)).slice(0, primary.length > 1 ? 3 : 4)
  const clock = (iso: string) => formatItemClock(new Date(iso), new Date(event.date), event.timezone)

  let message: string | null = null
  if (connection.gone) message = 'Dieser Ablauf ist gerade nicht verfügbar.'
  else if (payload.items.length === 0) message = 'Der Ablauf folgt.'
  else if (primary.length === 0) message = 'Der Ablauf ist beendet. Danke fürs Mitfeiern!'

  return (
    <div data-board className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col overflow-hidden px-[4vw] py-[3.5vh] gap-[2.5vh]">
      <header className="flex items-baseline justify-between gap-[3vw] shrink-0">
        <h1 className="text-[4.5vh] font-bold leading-tight truncate">{event.title}</h1>
        <Clock timezone={event.timezone} />
      </header>

      {message ? (
        <p className="grow flex items-center justify-center text-center text-[6vh] font-bold">{message}</p>
      ) : (
        <>
          <section aria-labelledby="board-primary" className="shrink-0 space-y-[1.5vh]">
            <h2 id="board-primary" className="text-[3vh] font-bold uppercase tracking-wide text-sky-300">{running ? 'Jetzt' : 'Als Nächstes'}</h2>
            <ul className="space-y-[2vh]">
              {primary.map(item => <PrimaryRow key={item.id} item={item} clock={clock} compact={primary.length > 1} showTrack={payload.showTracks} />)}
            </ul>
          </section>
          {rest.length > 0 && (
            <section aria-labelledby="board-rest" className="min-h-0 grow overflow-hidden space-y-[1vh]">
              <h2 id="board-rest" className="text-[3vh] font-bold uppercase tracking-wide text-sky-300">{running ? 'Als Nächstes' : 'Danach'}</h2>
              <ul className="divide-y divide-slate-800">
                {rest.map(item => <Row key={item.id} item={item} clock={clock} showTrack={payload.showTracks} />)}
              </ul>
            </section>
          )}
        </>
      )}

      <ConnectionNote connection={connection} timezone={event.timezone} className="shrink-0 self-start text-[2vh]" />
    </div>
  )
}

function Time({ item, clock }: { item: GuestPayloadItem; clock: (iso: string) => string }) {
  if (item.status === 'cancelled') return <span className="line-through text-slate-500">{clock(item.plannedStart)}</span>
  return (
    <>
      {item.approximate && <span className="text-[0.6em] font-normal text-slate-300">ca. </span>}
      {clock(item.shownStart)}
      {item.delayMin !== null && item.delayMin !== 0 && <span className="text-[0.6em] text-amber-300"> {formatDelay(item.delayMin)}</span>}
    </>
  )
}

function PrimaryRow({ item, clock, compact, showTrack }: { item: GuestPayloadItem; clock: (iso: string) => string; compact: boolean; showTrack: boolean }) {
  return (
    <li data-item-status={item.status} className={`flex items-baseline gap-[3vw] rounded-[1vh] bg-slate-900 px-[2vw] ${compact ? 'py-[1.5vh]' : 'py-[2vh]'}`}>
      <span className={`shrink-0 font-bold tabular-nums ${compact ? 'text-[5vh]' : 'text-[6vh]'}`}><Time item={item} clock={clock} /></span>
      <div className="min-w-0">
        <p className={`font-bold leading-tight ${compact ? 'text-[5vh] truncate' : 'text-[6vh] line-clamp-2'} ${item.status === 'cancelled' ? 'line-through text-slate-500' : ''}`}>
          {item.title}
        </p>
        {(item.location || showTrack) && (
          <p className="text-[3vh] text-slate-300 truncate">{[item.location, showTrack ? item.track : null].filter(Boolean).join(' · ')}</p>
        )}
      </div>
    </li>
  )
}

function Row({ item, clock, showTrack }: { item: GuestPayloadItem; clock: (iso: string) => string; showTrack: boolean }) {
  const cancelled = item.status === 'cancelled'
  const detail = cancelled ? ['fällt aus', item.cancelReason].filter(Boolean).join(': ') : [item.location, showTrack ? item.track : null].filter(Boolean).join(' · ')
  return (
    <li data-item-status={item.status} className="flex items-baseline gap-[2vw] py-[1vh]">
      <span className="shrink-0 w-[13vw] text-[3.8vh] font-bold tabular-nums"><Time item={item} clock={clock} /></span>
      <div className="min-w-0">
        <p className={`text-[3.8vh] leading-tight truncate ${cancelled ? 'line-through text-slate-500' : ''}`}>{item.title}</p>
        {detail && <p className="text-[2.4vh] text-slate-400 truncate">{detail}</p>}
      </div>
    </li>
  )
}

/** Uhr in der Zeitzone des Events. Erst im Browser (der Server kennt die Uhrzeit beim Anzeigen nicht). */
function subscribeClock(onChange: () => void) {
  const timer = setInterval(onChange, 1000)
  return () => clearInterval(timer)
}

function Clock({ timezone }: { timezone: string }) {
  const minute = useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / 60_000), () => null)
  return (
    <p aria-label="Uhrzeit" className="shrink-0 text-[7vh] font-bold tabular-nums leading-none">
      {minute === null ? '' : formatClock(new Date(minute * 60_000), timezone)}
    </p>
  )
}
