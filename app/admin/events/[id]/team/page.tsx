import Link from 'next/link'
import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { project, toGuestView, type GuestItem, type Projected } from '../../../../lib/schedule'
import { ITEM_VISIBILITY_LABELS } from '../../../../lib/planning/rules'
import { loadPlan, type PlanTrack } from '../../../../lib/planning/store'
import type { PlanItem } from '../../../../lib/planning/items'
import { timelineSections } from '../../../../lib/timeline'
import { formatDuration, formatItemClock } from '../../../../lib/timezone'
import AutoRefresh from '../../../../ui/auto-refresh'
import Badge from '../../../../ui/badge'
import Notice from '../../../../ui/notice'
import StatusBadge from '../../../../ui/status-badge'

export const dynamic = 'force-dynamic'

type TeamItem = Projected<PlanItem>

/**
 * Team-Ansicht (docs/KONZEPT.md Abschnitt 5), nur lesen: wie die Gästeansicht, aber mit Team-Punkten, geheimen
 * Punkten (Inhalt nur mit Eintrag, sonst "Geheimer Punkt" mit Zeit und Dauer), internen Notizen, Konflikten und
 * minutengenauer Prognose. Alle Punkte kommen aus loadPlan (SECRET-Regel), die Prognose aus dem Kern. Lädt sich
 * alle 30 s selbst neu. Zu jedem öffentlichen Punkt steht, welche Zeit Gäste gerade sehen, wenn sie abweicht, und
 * der Ursprungsplan (beim Live-Schalten eingefroren), wenn der Punkt seitdem verlegt wurde.
 */
export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/team`)
  const event = await loadEventOr404(id, user)
  const now = new Date()
  const [{ tracks, items }, shownRows, lastAction] = await Promise.all([
    loadPlan(event.id, user.id),
    prisma.item.findMany({ where: { eventId: event.id }, select: { id: true, guestShownStart: true, originalStart: true } }),
    prisma.liveAction.findFirst({ where: { eventId: event.id, actorId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
  ])
  const originals = new Map(shownRows.map(row => [row.id, row.originalStart]))

  let projection = project(items, now, event)
  const loop = !projection.ok
  if (!projection.ok) projection = project(items.map(item => ({ ...item, waitsFor: [] })), now, event)
  const projected: TeamItem[] = projection.ok ? projection.items : []
  const conflicts = projection.ok ? projection.conflicts : []

  // Was Gäste sehen - ohne zu speichern (das tun nur Gästeansicht, Tafel und Polling-Endpunkt).
  const previous = Object.fromEntries(shownRows.map(row => [row.id, row.guestShownStart]))
  const guestItems = new Map(toGuestView({ items: projected, tracks }, previous, now, event).items.map(item => [item.id, item]))

  const trackById = new Map(tracks.map(track => [track.id, track]))
  const itemById = new Map(projected.map(item => [item.id, item]))
  const order = (item: TeamItem) => trackById.get(item.trackId)?.sortOrder ?? 0
  const chronological = projected
    .filter(item => item.status !== 'DEFERRED')
    .sort((a, b) => a.expectedStart.getTime() - b.expectedStart.getTime() || order(a) - order(b) || a.sortOrder - b.sortOrder)
  const deferred = projected.filter(item => item.status === 'DEFERRED').sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime())
  const sections = timelineSections(
    chronological,
    item => (item.phase === 'cancelled' || item.phase === 'deferred' ? 'cancelled' : item.phase),
    item => item.expectedStart.getTime()
  )
  const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)
  const row = (item: TeamItem, highlight = false) => (
    <TeamRow
      key={item.id}
      item={item}
      track={trackById.get(item.trackId)}
      guest={guestItems.get(item.id)}
      original={originals.get(item.id) ?? null}
      waitsFor={item.waitsFor.map(other => itemById.get(other)?.title).filter((t): t is string => t !== undefined)}
      clock={clock}
      highlight={highlight}
    />
  )

  return (
    <main className="bg-gray-50 dark:bg-gray-900 py-6 px-4">
      <AutoRefresh />
      <div className="max-w-3xl mx-auto space-y-4 text-gray-900 dark:text-gray-100">
        <div className="space-y-1">
          <p className="text-sm"><Link href={`/admin/events/${event.id}`} className="text-blue-700 dark:text-blue-300 hover:underline">{event.title}</Link></p>
          <h1 className="text-2xl font-bold">Team-Ansicht <StatusBadge status={event.status} /></h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Stand {clock(now)} Uhr, minutengenau{lastAction ? `, letzte Meldung vor ${formatDuration(Math.max(0, Math.round((now.getTime() - lastAction.createdAt.getTime()) / 60_000)))}` : ''}.
            Aktualisiert sich alle 30 Sekunden.{' '}
            <Link href={`/admin/events/${event.id}/live`} className="text-blue-700 dark:text-blue-300 hover:underline">Live-Steuerung</Link>{' · '}
            <Link href={`/admin/events/${event.id}/plan`} className="text-blue-700 dark:text-blue-300 hover:underline">Planung</Link>{' · '}
            <Link href={`/${event.slug}`} className="text-blue-700 dark:text-blue-300 hover:underline">Gästeansicht</Link>{' · '}
            <Link href={`/${event.slug}/tafel`} className="text-blue-700 dark:text-blue-300 hover:underline">Tafel</Link>
          </p>
        </div>

        {loop && <Notice tone="error">„Wartet auf“ ergibt eine Schleife – die Prognose rechnet vorerst ohne Zusammenführungen.</Notice>}
        {conflicts.length > 0 && (
          <Notice tone="warning">
            <ul className="list-disc list-inside">
              {conflicts.map(conflict => (
                <li key={`${conflict.anchorId}-${conflict.itemId}`}>
                  „{itemById.get(conflict.itemId)?.title}“ überschneidet „{itemById.get(conflict.anchorId)?.title}“ um {formatDuration(conflict.overlapMin)} – kürzen?
                </li>
              ))}
            </ul>
          </Notice>
        )}

        {projected.length === 0 && <p className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-sm text-gray-600 dark:text-gray-400">Noch keine Programmpunkte.</p>}
        {sections.now.length > 0 && <Section title="Jetzt"><ul className="space-y-2">{sections.now.map(item => row(item, true))}</ul></Section>}
        {sections.next.length > 0 && <Section title="Als Nächstes"><List>{sections.next.map(item => row(item))}</List></Section>}
        {sections.later.length > 0 && <Section title="Danach"><List>{sections.later.map(item => row(item))}</List></Section>}
        {deferred.length > 0 && <Section title="Zurückgestellt"><List>{deferred.map(item => row(item))}</List></Section>}
        {sections.past.length > 0 && (
          <details open={sections.now.length + sections.next.length + sections.later.length === 0}>
            <summary className="cursor-pointer text-lg font-bold py-1">Vorbei ({sections.past.length})</summary>
            <div className="mt-2"><List>{sections.past.map(item => row(item))}</List></div>
          </details>
        )}
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2"><h2 className="text-lg font-bold">{title}</h2>{children}</section>
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-200 dark:divide-gray-700">{children}</ul>
}

function TeamRow({ item, track, guest, original, waitsFor, clock, highlight }: {
  item: TeamItem
  track: PlanTrack | undefined
  guest: GuestItem | undefined
  original: Date | null
  waitsFor: string[]
  clock: (date: Date) => string
  highlight: boolean
}) {
  const inactive = item.status === 'DEFERRED' || item.status === 'CANCELLED'
  return (
    <li data-item={item.id} className={`p-3 flex gap-3 ${highlight ? 'bg-blue-50 dark:bg-blue-950/50 border-2 border-blue-600 rounded-lg shadow' : ''} ${inactive ? 'opacity-70' : ''}`}>
      <div className="w-28 shrink-0 text-sm tabular-nums">
        <div className="font-bold">{clock(item.expectedStart)}</div>
        <div className="text-gray-600 dark:text-gray-400">bis {clock(item.expectedEnd)}</div>
        {item.delayMin !== 0 && (
          <div className="text-xs">
            <span className={`font-bold ${item.delayMin > 0 ? 'text-amber-800 dark:text-amber-200' : 'text-green-800 dark:text-green-200'}`}>{item.delayMin > 0 ? `+${item.delayMin}` : `−${-item.delayMin}`}</span>{' '}
            <span className="text-gray-600 dark:text-gray-400">Plan {clock(item.plannedStart)}</span>
          </div>
        )}
        <div className="text-xs text-gray-600 dark:text-gray-400">{formatDuration(item.plannedDurationMin)}</div>
      </div>
      <div className="grow min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className={`font-medium ${inactive ? 'line-through' : ''}`}>{item.title}</span>
          {item.isAnchor && <Badge tone="blue">Anker</Badge>}
          {item.visibility !== 'PUBLIC' && <Badge tone={item.visibility === 'SECRET' ? 'purple' : 'amber'}>{ITEM_VISIBILITY_LABELS[item.visibility]}</Badge>}
          {track?.visibility === 'TEAM' && item.visibility === 'PUBLIC' && <Badge tone="amber">Team-Spur</Badge>}
          {track && <Badge>{track.name}</Badge>}
          {item.insertedLive && <Badge>Einschub</Badge>}
          {item.phase === 'now' && item.confirmed && <Badge tone="green">läuft</Badge>}
          {item.unconfirmed && item.phase !== 'past' && <Badge tone="amber">nicht bestätigt</Badge>}
          {item.capped ? <Badge tone="red">unklar</Badge> : item.overrun && <Badge tone="amber">überzogen</Badge>}
          {item.needsCheck && !item.capped && <Badge tone="amber">läuft noch?</Badge>}
          {item.status === 'DEFERRED' && <Badge>zurückgestellt</Badge>}
          {item.status === 'CANCELLED' && <Badge tone="red">fällt aus</Badge>}
        </div>
        {item.status === 'CANCELLED' && item.cancelReason && <p className="text-sm text-gray-700 dark:text-gray-300">Grund: {item.cancelReason}</p>}
        {guest?.approximate && <p className="text-xs text-gray-600 dark:text-gray-400">Gäste sehen: ca. {clock(guest.shownStart)}</p>}
        {original && original.getTime() !== item.plannedStart.getTime() && (
          <p className="text-xs text-gray-600 dark:text-gray-400">Ursprünglich geplant: {clock(original)} (Fahrplanänderung)</p>
        )}
        {item.location && <p className="text-sm text-gray-700 dark:text-gray-300">{item.location}</p>}
        {item.description && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{item.description}</p>}
        {item.internalNote && <p className="text-sm text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 rounded px-2 py-1 whitespace-pre-line">Notiz: {item.internalNote}</p>}
        {waitsFor.length > 0 && <p className="text-xs text-gray-600 dark:text-gray-400">wartet auf: {waitsFor.join(', ')}</p>}
      </div>
    </li>
  )
}
