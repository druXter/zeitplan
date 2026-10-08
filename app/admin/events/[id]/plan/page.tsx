import Link from 'next/link'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { canAddRemoveItems, canEditItem, canEditPlan, canManageEvent } from '../../../../lib/permissions'
import { project } from '../../../../lib/schedule'
import { allRows, trackRows, type PlanRow } from '../../../../lib/planning/order'
import { ITEM_VISIBILITY_LABELS, TRACK_VISIBILITY_LABELS } from '../../../../lib/planning/rules'
import { loadPlan, type PlanTrack } from '../../../../lib/planning/store'
import type { PlanItem } from '../../../../lib/planning/items'
import { formatDuration as minutes, formatItemClock } from '../../../../lib/timezone'
import { createTrack, deleteTrack, moveItem, moveTrack, updateTrack } from '../../plan-actions'
import StatusBadge from '../../../../ui/status-badge'
import Notice from '../../../../ui/notice'
import Badge from '../../../../ui/badge'

export const dynamic = 'force-dynamic'

type Search = {
  track?: string; saved?: string; deleted?: string; moved?: string; moveError?: string
  trackSaved?: string; trackDeleted?: string; trackError?: string
}

const MOVE_ERRORS: Record<string, string> = {
  'not-adjacent': 'Die beiden Punkte sind nicht (mehr) direkt benachbart. Die Liste zeigt jetzt den aktuellen Stand.',
  anchor: 'Anker lassen sich nicht verschieben – ändere stattdessen ihre Uhrzeit.',
  started: 'Begonnene Punkte lassen sich nicht mehr tauschen.',
  inactive: 'Zurückgestellte oder ausgefallene Punkte lassen sich nicht tauschen.',
  cycle: 'Der Tausch würde bei „wartet auf“ eine Schleife ergeben.',
  'not-found': 'Den Punkt gibt es nicht mehr.',
  forbidden: 'Diesen Punkt darfst du nicht verschieben.'
}

const TRACK_ERRORS: Record<string, string> = {
  invalid: 'Spur: Bitte gib einen Namen (höchstens 60 Zeichen) und eine Sichtbarkeit an.',
  limit: 'Spur: Es sind höchstens 20 Spuren möglich.',
  notEmpty: 'Spur: Nur leere Spuren lassen sich löschen. Verschiebe oder lösche zuerst ihre Punkte.',
  last: 'Spur: Die letzte Spur lässt sich nicht löschen.',
  missing: 'Spur: Diese Spur gibt es nicht mehr.'
}

/**
 * Planung (docs/KONZEPT.md Abschnitt 4): Tabs "Alle" und je Spur, Liste mit Uhrzeit, Dauer und Ende, Puffer
 * und Überschneidungen als Zeilen dazwischen, Umsortieren per nach oben/unten (tauscht mit dem Nachbarn, siehe
 * moveItem). Alle Punkte kommen aus loadPlan - geheime Punkte ohne Eintrag nur mit Zeit und Dauer.
 */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/plan`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const { tracks, items } = await loadPlan(event.id, user.id)

  const current = tracks.find(track => track.id === search.track) ?? null
  const trackById = new Map(tracks.map(track => [track.id, track]))
  const rows = current ? trackRows(items.filter(item => item.trackId === current.id)) : allRows(items, tracks.map(t => t.id))
  const itemById = new Map(items.map(item => [item.id, item]))
  const mayEdit = canEditPlan(event.level, event)
  const mayAdd = canAddRemoveItems(event.level, event) && tracks.length > 0
  const isOwner = canManageEvent(event.level)

  // Vorschau aus dem Prognose-Kern: Konflikte mit Ankern und Kreise - dieselben Regeln wie live.
  const projection = project(items, new Date(), event)
  const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)
  const trackQuery = current ? current.id : 'all'

  return (
    <main className="bg-gray-50 dark:bg-gray-900 py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-4 text-gray-900 dark:text-gray-100">
        <div className="space-y-1">
          <p className="text-sm"><Link href={`/admin/events/${event.id}`} className="text-blue-700 dark:text-blue-300 hover:underline">{event.title}</Link></p>
          <h1 className="text-2xl font-bold">Ablauf <StatusBadge status={event.status} /></h1>
          {!mayEdit && <p className="text-sm text-gray-600 dark:text-gray-400">Du kannst den Plan ansehen, aber nicht bearbeiten.</p>}
        </div>

        {search.saved === '1' && <Notice tone="success">Punkt gespeichert.</Notice>}
        {search.deleted === '1' && <Notice tone="success">Punkt gelöscht.</Notice>}
        {search.moved === '1' && <Notice tone="success">Reihenfolge geändert.</Notice>}
        {search.moveError && <Notice tone="error">{MOVE_ERRORS[search.moveError] ?? 'Das hat nicht geklappt.'}</Notice>}
        {search.trackSaved === '1' && <Notice tone="success">Spur gespeichert.</Notice>}
        {search.trackDeleted === '1' && <Notice tone="success">Spur gelöscht.</Notice>}
        {search.trackError && <Notice tone="error">{TRACK_ERRORS[search.trackError] ?? 'Das hat nicht geklappt.'}</Notice>}

        {!projection.ok && (
          <Notice tone="error">„Wartet auf“ ergibt eine Schleife – bitte bei einem der betroffenen Punkte korrigieren.</Notice>
        )}
        {projection.ok && projection.conflicts.length > 0 && (
          <Notice tone="warning">
            <ul className="list-disc list-inside">
              {projection.conflicts.map(conflict => (
                <li key={`${conflict.anchorId}-${conflict.itemId}`}>
                  „{itemById.get(conflict.itemId)?.title}“ überschneidet den Anker „{itemById.get(conflict.anchorId)?.title}“ um {minutes(conflict.overlapMin)}.
                </li>
              ))}
            </ul>
          </Notice>
        )}

        <nav aria-label="Spuren" className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-700">
          <TabLink href={`/admin/events/${event.id}/plan`} active={!current}>Alle</TabLink>
          {tracks.map(track => (
            <TabLink key={track.id} href={`/admin/events/${event.id}/plan?track=${track.id}`} active={current?.id === track.id}>
              {track.name}{track.visibility === 'TEAM' && ' (Team)'}
            </TabLink>
          ))}
        </nav>

        {mayAdd && (
          <p>
            <Link href={`/admin/events/${event.id}/items/new${current ? `?track=${current.id}` : ''}`} className="inline-block bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700">
              Neuer Punkt
            </Link>
          </p>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-gray-600 dark:text-gray-400">{tracks.length === 0 ? 'Noch keine Spur – lege unten eine an.' : 'Noch keine Programmpunkte.'}</p>
          ) : (
            <ol className="divide-y">
              {rows.map(row => (
                <Row
                  key={row.item.id}
                  row={row}
                  eventId={event.id}
                  track={trackById.get(row.item.trackId)}
                  showTrack={!current}
                  showGap={current !== null}
                  clock={clock}
                  waitsFor={row.item.waitsFor.map(other => itemById.get(other)).filter((i): i is PlanItem => i !== undefined)}
                  editable={canEditItem(event.level, event, row.item, row.item.canSee)}
                  neighbourEditable={(other: string | null) => {
                    const neighbour = other ? itemById.get(other) : undefined
                    return neighbour !== undefined && canEditItem(event.level, event, neighbour, neighbour.canSee)
                  }}
                  trackQuery={trackQuery}
                />
              ))}
            </ol>
          )}
        </div>

        {isOwner && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-4">
            <h2 className="font-bold">Spuren</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Parallele Abläufe, z. B. „Brautpaar“ neben „Gäste“, jede mit eigener Kette. Punkte in Team-Spuren sehen Gäste
              nie. Ein Punkt kann auf Punkte anderer Spuren warten („wartet auf“).
            </p>
            {current && <TrackEditor eventId={event.id} track={current} />}
            <form action={createTrack} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="eventId" value={event.id} />
              <div className="grow min-w-40">
                <label htmlFor="track-new-name" className="block text-sm font-medium mb-1">Neue Spur</label>
                <input id="track-new-name" name="name" required maxLength={60} placeholder="z. B. Brautpaar" className="w-full border border-gray-300 dark:border-gray-600 p-2 rounded text-sm" />
              </div>
              <div>
                <label htmlFor="track-new-visibility" className="block text-sm font-medium mb-1">Sichtbarkeit der Spur</label>
                <select id="track-new-visibility" name="visibility" defaultValue="PUBLIC" className="border border-gray-300 dark:border-gray-600 p-2 rounded text-sm">
                  {Object.entries(TRACK_VISIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-3 rounded hover:bg-blue-700 text-sm">Spur anlegen</button>
            </form>
          </div>
        )}
      </div>
    </main>
  )
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`px-3 py-2 text-sm rounded-t ${active ? 'bg-white dark:bg-gray-800 border border-b-white dark:border-b-gray-800 border-gray-200 dark:border-gray-700 -mb-px font-bold' : 'text-blue-700 dark:text-blue-300 hover:underline'}`}
    >
      {children}
    </Link>
  )
}

function TrackEditor({ eventId, track }: { eventId: string; track: PlanTrack }) {
  return (
    <div className="space-y-2 border-b pb-4">
      <form action={updateTrack} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="trackId" value={track.id} />
        <div className="grow min-w-40">
          <label htmlFor="track-name" className="block text-sm font-medium mb-1">Name dieser Spur</label>
          <input id="track-name" name="name" required maxLength={60} defaultValue={track.name} className="w-full border border-gray-300 dark:border-gray-600 p-2 rounded text-sm" />
        </div>
        <div>
          <label htmlFor="track-visibility" className="block text-sm font-medium mb-1">Sichtbarkeit dieser Spur</label>
          <select id="track-visibility" name="visibility" defaultValue={track.visibility} className="border border-gray-300 dark:border-gray-600 p-2 rounded text-sm">
            {Object.entries(TRACK_VISIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <button type="submit" className="py-2 px-3 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900 text-sm">Spur speichern</button>
      </form>
      <div className="flex flex-wrap gap-2 text-sm">
        {(['left', 'right'] as const).map(direction => (
          <form key={direction} action={moveTrack}>
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="trackId" value={track.id} />
            <input type="hidden" name="direction" value={direction} />
            <button type="submit" className="py-1 px-2 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900">{direction === 'left' ? '← Tab nach links' : 'Tab nach rechts →'}</button>
          </form>
        ))}
        <form action={deleteTrack}>
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="trackId" value={track.id} />
          <button type="submit" className="py-1 px-2 text-red-700 dark:text-red-300 hover:underline">Spur löschen</button>
        </form>
      </div>
    </div>
  )
}

function MoveButton({ eventId, itemId, otherId, trackQuery, label, symbol }: { eventId: string; itemId: string; otherId: string; trackQuery: string; label: string; symbol: string }) {
  return (
    <form action={moveItem}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="otherId" value={otherId} />
      <input type="hidden" name="track" value={trackQuery} />
      <button type="submit" aria-label={label} title={label} className="w-9 h-9 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900">{symbol}</button>
    </form>
  )
}

function Row({ row, eventId, track, showTrack, showGap, clock, waitsFor, editable, neighbourEditable, trackQuery }: {
  row: PlanRow<PlanItem>
  eventId: string
  track: PlanTrack | undefined
  showTrack: boolean
  showGap: boolean
  clock: (date: Date) => string
  waitsFor: PlanItem[]
  editable: boolean
  neighbourEditable: (id: string | null) => boolean
  trackQuery: string
}) {
  const { item } = row
  const inactive = item.status === 'DEFERRED' || item.status === 'CANCELLED'
  return (
    <li id={`item-${item.id}`} data-item={item.id}>
      {showGap && row.gapMin !== null && row.gapMin !== 0 && (
        <p className={`px-4 py-1 text-xs ${row.gapMin > 0 ? 'bg-green-50 dark:bg-green-950/50 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-200'}`}>
          {row.gapMin > 0 ? `Puffer ${minutes(row.gapMin)}` : `Überschneidung ${minutes(-row.gapMin)}`}
        </p>
      )}
      <div className={`p-3 flex gap-3 ${inactive ? 'opacity-60' : ''}`}>
        <div className="w-28 shrink-0 text-sm tabular-nums">
          <div className="font-bold">{clock(item.plannedStart)}</div>
          <div className="text-gray-600 dark:text-gray-400">bis {clock(row.end)}</div>
          <div className="text-xs text-gray-600 dark:text-gray-400">{minutes(item.plannedDurationMin)}</div>
        </div>
        <div className="grow min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className={`font-medium ${inactive ? 'line-through' : ''}`}>{item.title}</span>
            {item.isAnchor && <Badge tone="blue">Anker</Badge>}
            {item.mayStartEarly && <Badge>darf früher beginnen</Badge>}
            {item.visibility !== 'PUBLIC' && <Badge tone={item.visibility === 'SECRET' ? 'purple' : 'amber'}>{ITEM_VISIBILITY_LABELS[item.visibility]}</Badge>}
            {track?.visibility === 'TEAM' && item.visibility === 'PUBLIC' && <Badge tone="amber">Team-Spur</Badge>}
            {item.status === 'DEFERRED' && <Badge>zurückgestellt</Badge>}
            {item.status === 'CANCELLED' && <Badge>fällt aus</Badge>}
            {showTrack && track && <Badge>{track.name}</Badge>}
          </div>
          {item.location && <p className="text-sm text-gray-700 dark:text-gray-300">{item.location}</p>}
          {item.description && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{item.description}</p>}
          {item.internalNote && <p className="text-sm text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 rounded px-2 py-1 whitespace-pre-line">Notiz: {item.internalNote}</p>}
          {waitsFor.length > 0 && <p className="text-xs text-gray-600 dark:text-gray-400">wartet auf: {waitsFor.map(other => other.title).join(', ')}</p>}
        </div>
        {editable && (
          <div className="shrink-0 flex flex-col items-end gap-1">
            <div className="flex gap-1">
              {!showTrack && row.previousId && neighbourEditable(row.previousId) && (
                <MoveButton eventId={eventId} itemId={item.id} otherId={row.previousId} trackQuery={trackQuery} label={`„${item.title}“ nach oben`} symbol="↑" />
              )}
              {!showTrack && row.nextId && neighbourEditable(row.nextId) && (
                <MoveButton eventId={eventId} itemId={item.id} otherId={row.nextId} trackQuery={trackQuery} label={`„${item.title}“ nach unten`} symbol="↓" />
              )}
            </div>
            <Link href={`/admin/events/${eventId}/items/${item.id}`} className="text-sm text-blue-700 dark:text-blue-300 hover:underline" aria-label={`„${item.title}“ bearbeiten`}>Bearbeiten</Link>
          </div>
        )}
      </div>
    </li>
  )
}
