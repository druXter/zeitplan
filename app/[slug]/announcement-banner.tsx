'use client'

import { useSyncExternalStore } from 'react'
import type { GuestPayload } from '../lib/guest/payload'
import { announcementVisible } from '../lib/guest/announcement'
import { formatClock } from '../lib/timezone'

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 15_000)
  return () => clearInterval(timer)
}

/**
 * Durchsage oben in Gästeansicht und Tafel (Idee L15). Der Server liefert nur gültige Durchsagen; im Browser
 * verschwindet sie trotzdem zur Ablaufzeit - wichtig für einen gemerkten Stand ohne Verbindung. Die Uhr des Geräts
 * zählt erst nach dem Hydrieren (Server-Snapshot null = zeigen), damit die Seite nicht abweicht.
 */
export default function AnnouncementBanner({ announcement, timezone, board = false }: {
  announcement: GuestPayload['announcement']; timezone: string; board?: boolean
}) {
  // Uhr auf 15 s gerastert (wie die Uhr der Tafel), damit der Snapshot zwischen zwei Abfragen gleich bleibt.
  const now = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 15_000) * 15_000, () => null)
  if (!announcement || (now !== null && !announcementVisible(announcement, now))) return null
  const at = formatClock(new Date(announcement.at), timezone)

  if (board) {
    return (
      <div data-announcement role="status" className="shrink-0 rounded-[1vh] bg-amber-300 text-slate-950 px-[2vw] py-[1.5vh] flex items-baseline gap-[2vw]">
        <span className="shrink-0 text-[2.6vh] font-bold uppercase tracking-wide">Durchsage</span>
        <p className="min-w-0 text-[4vh] font-bold leading-tight line-clamp-2">{announcement.text}</p>
      </div>
    )
  }
  return (
    <div data-announcement role="status" className="rounded-lg border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/50 p-3 space-y-1">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">Durchsage · {at} Uhr</p>
      <p className="font-medium whitespace-pre-line">{announcement.text}</p>
    </div>
  )
}
