import type { GuestItem } from '../lib/schedule'
import { ITEM_VISIBILITY_LABELS } from '../lib/planning/rules'
import type { PlanTrack } from '../lib/planning/store'
import type { Place } from '../lib/planning/places'
import type { Announcement } from '../lib/guest/announcement'
import { myItems, type TeamItem, type TeamView } from '../lib/team/view'
import { timelineSections } from '../lib/timeline'
import { formatDuration, formatItemClock } from '../lib/timezone'
import Badge from './badge'
import Notice from './notice'
import PlaceLine from './place-line'

/**
 * Ablauf fürs Team (docs/KONZEPT.md Abschnitt 5) - gemeinsam für die Team-Ansicht (Konto) und den Team-Link für
 * Dienstleister (Idee L18): chronologisch, minutengenau mit Plan- und erwarteter Zeit, Abweichung, Konflikten,
 * internen Notizen, Orten mit Adresse, Zuständigen und zurückgestellten Punkten. Zu jedem öffentlichen Punkt steht,
 * welche Zeit Gäste gerade sehen, wenn sie abweicht, und der Ursprungsplan, wenn der Punkt verlegt wurde.
 *
 * meId: "Meine Punkte" (Idee L16) oben; mineOnly zeigt in der Liste nur die eigenen Punkte.
 */
export default function TeamTimeline({ view, event, now, announcement, meId, mineOnly = false }: {
  view: TeamView
  event: { date: Date; timezone: string }
  now: Date
  announcement: Announcement | null
  meId?: string
  mineOnly?: boolean
}) {
  const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)
  const trackById = new Map(view.tracks.map(track => [track.id, track]))
  const itemById = new Map(view.items.map(item => [item.id, item]))
  const order = (item: TeamItem) => trackById.get(item.trackId)?.sortOrder ?? 0
  const listed = mineOnly && meId ? view.items.filter(item => item.assigneeIds.includes(meId)) : view.items
  const chronological = listed
    .filter(item => item.status !== 'DEFERRED')
    .sort((a, b) => a.expectedStart.getTime() - b.expectedStart.getTime() || order(a) - order(b) || a.sortOrder - b.sortOrder)
  const deferred = listed.filter(item => item.status === 'DEFERRED').sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime())
  const sections = timelineSections(
    chronological,
    item => (item.phase === 'cancelled' || item.phase === 'deferred' ? 'cancelled' : item.phase),
    item => item.expectedStart.getTime()
  )
  const mine = meId ? myItems(view.items, meId, now) : []
  const row = (item: TeamItem, highlight = false) => (
    <TeamRow
      key={item.id}
      item={item}
      track={trackById.get(item.trackId)}
      guest={view.guestItems.get(item.id)}
      original={view.originals.get(item.id) ?? null}
      place={view.placeOf(item.location)}
      assignees={item.assigneeIds.map(id => view.accountNames.get(id)).filter((name): name is string => name !== undefined)}
      mine={meId !== undefined && item.assigneeIds.includes(meId)}
      waitsFor={item.waitsFor.map(other => itemById.get(other)?.title).filter((t): t is string => t !== undefined)}
      clock={clock}
      highlight={highlight}
    />
  )

  return (
    <>
      {announcement && (
        <Notice tone="info">
          <span className="font-bold">Durchsage {announcement.until ? `bis ${clock(announcement.until)} Uhr` : 'ohne Ablauf'}:</span> {announcement.text}
        </Notice>
      )}
      {view.loop && <Notice tone="error">„Wartet auf“ ergibt eine Schleife – die Prognose rechnet vorerst ohne Zusammenführungen.</Notice>}
      {view.conflicts.length > 0 && (
        <Notice tone="warning">
          <ul className="list-disc list-inside">
            {view.conflicts.map(conflict => (
              <li key={`${conflict.anchorId}-${conflict.itemId}`}>
                „{itemById.get(conflict.itemId)?.title}“ überschneidet „{itemById.get(conflict.anchorId)?.title}“ um {formatDuration(conflict.overlapMin)} – kürzen?
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {mine.length > 0 && !mineOnly && (
        <section data-mine className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-2">
          <h2 className="text-lg font-bold">Meine Punkte</h2>
          <ul className="space-y-1">
            {mine.slice(0, 5).map(({ item, minutesUntil }) => (
              <li key={item.id} className="flex flex-wrap gap-x-2 text-sm">
                <a href={`#punkt-${item.id}`} className="font-medium text-blue-700 dark:text-blue-300 hover:underline">{item.title}</a>
                <span className="tabular-nums">
                  {item.phase === 'now' && item.confirmed
                    ? `läuft seit ${clock(item.expectedStart)}`
                    : `${item.delayMin !== 0 ? 'ca. ' : ''}${clock(item.expectedStart)}${minutesUntil <= 0 ? ', jetzt fällig' : minutesUntil <= 12 * 60 ? `, in ${formatDuration(minutesUntil)}` : ''}`}
                </span>
                {item.delayMin !== 0 && <span className="text-xs text-gray-600 dark:text-gray-400">(Plan {clock(item.plannedStart)})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {listed.length === 0 && (
        <p className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-sm text-gray-600 dark:text-gray-400">
          {mineOnly ? 'Für keinen Punkt als zuständig eingetragen.' : 'Noch keine Programmpunkte.'}
        </p>
      )}
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
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2"><h2 className="text-lg font-bold">{title}</h2>{children}</section>
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-200 dark:divide-gray-700">{children}</ul>
}

function TeamRow({ item, track, guest, original, place, assignees, mine, waitsFor, clock, highlight }: {
  item: TeamItem
  track: PlanTrack | undefined
  guest: GuestItem | undefined
  original: Date | null
  place: Place | null
  assignees: string[]
  mine: boolean
  waitsFor: string[]
  clock: (date: Date) => string
  highlight: boolean
}) {
  const inactive = item.status === 'DEFERRED' || item.status === 'CANCELLED'
  return (
    <li id={`punkt-${item.id}`} data-item={item.id} className={`p-3 flex gap-3 ${highlight ? 'bg-blue-50 dark:bg-blue-950/50 border-2 border-blue-600 rounded-lg shadow' : ''} ${inactive ? 'opacity-70' : ''}`}>
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
          {mine && <Badge tone="green">deins</Badge>}
          {item.isAnchor && <Badge tone="blue">Anker</Badge>}
          {item.visibility !== 'PUBLIC' && <Badge tone={item.visibility === 'SECRET' ? 'purple' : 'amber'}>{ITEM_VISIBILITY_LABELS[item.visibility]}</Badge>}
          {track?.visibility === 'TEAM' && item.visibility === 'PUBLIC' && <Badge tone="amber">Team-Spur</Badge>}
          {track && <Badge>{track.name}</Badge>}
          {item.insertedLive && <Badge>Einschub</Badge>}
          {item.phase === 'now' && item.confirmed && <Badge tone="green">läuft</Badge>}
          {item.unconfirmed && item.phase !== 'past' && <Badge tone="amber">nicht bestätigt</Badge>}
          {item.capped ? <Badge tone="red">unklar</Badge> : item.overrun && <Badge tone="amber">überzogen</Badge>}
          {item.needsCheck && !item.capped && <Badge tone="amber">läuft noch?</Badge>}
          {item.shortenedMin > 0 && <Badge tone="amber">gekürzt um {formatDuration(item.shortenedMin)}</Badge>}
          {item.status === 'DEFERRED' && <Badge>zurückgestellt</Badge>}
          {item.status === 'CANCELLED' && <Badge tone="red">fällt aus</Badge>}
        </div>
        {item.status === 'CANCELLED' && item.cancelReason && <p className="text-sm text-gray-700 dark:text-gray-300">Grund: {item.cancelReason}</p>}
        {guest?.approximate && <p className="text-xs text-gray-600 dark:text-gray-400">Gäste sehen: ca. {clock(guest.shownStart)}</p>}
        {original && original.getTime() !== item.plannedStart.getTime() && (
          <p className="text-xs text-gray-600 dark:text-gray-400">Ursprünglich geplant: {clock(original)} (Fahrplanänderung)</p>
        )}
        {item.location && <PlaceLine location={item.location} place={place} />}
        {assignees.length > 0 && <p className="text-sm text-gray-700 dark:text-gray-300">Zuständig: {assignees.join(', ')}</p>}
        {item.description && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{item.description}</p>}
        {item.internalNote && <p className="text-sm text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 rounded px-2 py-1 whitespace-pre-line">Notiz: {item.internalNote}</p>}
        {waitsFor.length > 0 && <p className="text-xs text-gray-600 dark:text-gray-400">wartet auf: {waitsFor.join(', ')}</p>}
      </div>
    </li>
  )
}
