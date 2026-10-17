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
import { deletePlace } from '../../place-actions'
import { prisma } from '../../../../lib/prisma'
import { placeIndex, type Place } from '../../../../lib/planning/places'
import PlaceForm from '../../place-form'
import ConfirmForm from '../../../../ui/confirm-form'
import PlaceLine from '../../../../ui/place-line'
import Notice from '../../../../ui/notice'
import Badge from '../../../../ui/badge'
import { ButtonLink, buttonClass, Card, EmptyState, hintClass, inputClass, labelClass, Segmented, SettingsSection } from '../../../../ui/kit'

export const dynamic = 'force-dynamic'

type Search = {
  track?: string; saved?: string; deleted?: string; moved?: string; moveError?: string; shifted?: string
  trackSaved?: string; trackDeleted?: string; trackError?: string; placeDeleted?: string
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
 * Planung (docs/KONZEPT.md Abschnitt 4): Umschalter "Alle" und je Spur, Liste mit Uhrzeit, Dauer und Ende, Puffer
 * und Überschneidungen als Zeilen dazwischen, Umsortieren per nach oben/unten (tauscht mit dem Nachbarn, siehe
 * moveItem). Alle Punkte kommen aus loadPlan - geheime Punkte ohne Eintrag nur mit Zeit und Dauer.
 */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/plan`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const [{ tracks, items }, places] = await Promise.all([
    loadPlan(event.id, user.id),
    prisma.place.findMany({ where: { eventId: event.id }, orderBy: { name: 'asc' }, select: { id: true, name: true, address: true, mapUrl: true } })
  ])
  const placeOf = placeIndex(places)

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

  const base = `/admin/events/${event.id}`

  return (
    <div className="space-y-4">
      {search.saved === '1' && <Notice tone="success">Punkt gespeichert.</Notice>}
      {search.deleted === '1' && <Notice tone="success">Punkt gelöscht.</Notice>}
      {search.moved === '1' && <Notice tone="success">Reihenfolge geändert.</Notice>}
      {search.shifted && /^\d+$/.test(search.shifted) && (
        <Notice tone="success">{search.shifted === '1' ? 'Punkt verschoben.' : `${search.shifted} Punkte verschoben.`}</Notice>
      )}
      {search.moveError && <Notice tone="error">{MOVE_ERRORS[search.moveError] ?? 'Das hat nicht geklappt.'}</Notice>}
      {search.trackSaved === '1' && <Notice tone="success">Spur gespeichert.</Notice>}
      {search.trackDeleted === '1' && <Notice tone="success">Spur gelöscht.</Notice>}
      {search.placeDeleted === '1' && <Notice tone="success">Ort gelöscht. Die Punkte behalten ihn als Text, ohne Adresse.</Notice>}
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {tracks.length > 0 ? (
          <Segmented label="Spuren" items={[
            { href: `${base}/plan`, label: 'Alle', active: !current },
            ...tracks.map(track => ({ href: `${base}/plan?track=${track.id}`, label: `${track.name}${track.visibility === 'TEAM' ? ' (Team)' : ''}`, active: current?.id === track.id }))
          ]} />
        ) : <span />}
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`${base}/was-waere-wenn`}>Was wäre wenn?</ButtonLink>
          {mayAdd && <ButtonLink href={`${base}/items/new${current ? `?track=${current.id}` : ''}`} variant="primary">Neuer Punkt</ButtonLink>}
        </div>
      </div>
      {!mayEdit && <p className="text-sm text-gray-600 dark:text-gray-400">Du kannst den Plan ansehen, aber nicht bearbeiten.</p>}
      {current && <p className="text-xs text-gray-500 dark:text-gray-400">Nur „{current.name}“, mit Puffern und Überschneidungen. Mit ↑ und ↓ tauschst du benachbarte Punkte.</p>}

      {rows.length === 0 ? (
        <EmptyState>{tracks.length === 0 ? 'Noch keine Spur – lege unten eine an.' : 'Noch keine Programmpunkte.'}</EmptyState>
      ) : (
        <Card padded={false}>
          <ol className="divide-y divide-gray-100 dark:divide-gray-700">
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
                place={placeOf(row.item.location)}
              />
            ))}
          </ol>
        </Card>
      )}

      <div className="space-y-3 pt-2">
        {isOwner && (
          <SettingsSection id="spuren" title="Spuren" summary={tracks.length === 1 ? '1 Spur' : `${tracks.length} Spuren`}
            open={tracks.length === 0 || search.trackSaved !== undefined || search.trackError !== undefined}
            description="Parallele Abläufe, z. B. „Brautpaar“ neben „Gäste“, jede mit eigener Kette. Punkte in Team-Spuren sehen Gäste nie. Ein Punkt kann auf Punkte anderer Spuren warten („wartet auf“).">
            {current && <TrackEditor eventId={event.id} track={current} />}
            <form action={createTrack} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <input type="hidden" name="eventId" value={event.id} />
              <div className="sm:flex-1">
                <label htmlFor="track-new-name" className={labelClass}>Neue Spur</label>
                <input id="track-new-name" name="name" required maxLength={60} placeholder="z. B. Brautpaar" className={inputClass} />
              </div>
              <div>
                <label htmlFor="track-new-visibility" className={labelClass}>Sichtbarkeit der Spur</label>
                <select id="track-new-visibility" name="visibility" defaultValue="PUBLIC" className={inputClass}>
                  {Object.entries(TRACK_VISIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <button type="submit" className={buttonClass('primary')}>Spur anlegen</button>
            </form>
            {!current && tracks.length > 0 && <p className={hintClass}>Name, Sichtbarkeit und Reihenfolge einer Spur änderst du, wenn du sie oben auswählst.</p>}
          </SettingsSection>
        )}
        <Places eventId={event.id} places={places} editable={mayEdit} open={search.placeDeleted !== undefined} />
      </div>
    </div>
  )
}

/** Orte mit Adresse (Idee L22): Punkte gehören über ihr Feld „Ort“ dazu, Gäste sehen Adresse und „Route öffnen“. */
function Places({ eventId, places, editable, open }: { eventId: string; places: Place[]; editable: boolean; open: boolean }) {
  if (!editable && places.length === 0) return null
  return (
    <SettingsSection id="orte" title="Orte" summary={places.length === 0 ? 'keine' : places.length === 1 ? '1 Ort' : `${places.length} Orte`} open={open}
      description="Orte mit Adresse, z. B. Kirche und Feier-Location. Steht ihr Name im Feld „Ort“ eines Punkts, sehen Gäste dort die Adresse und „Route öffnen“. Umbenennen ändert den Ort auch an den Punkten.">
      {places.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {places.map(place => (
            <li key={place.id} data-place={place.name} className="py-2 space-y-2">
              {editable ? (
                <details>
                  <summary className="cursor-pointer text-sm"><span className="font-medium">{place.name}</span> – {place.address}</summary>
                  <div className="mt-2 space-y-2">
                    <PlaceForm eventId={eventId} place={place} />
                    <ConfirmForm action={deletePlace} message={`Ort „${place.name}“ löschen? Die Punkte behalten ihn als Text, ohne Adresse.`}>
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="placeId" value={place.id} />
                      <button type="submit" className={buttonClass('danger', 'sm')}>Ort löschen</button>
                    </ConfirmForm>
                  </div>
                </details>
              ) : (
                <p className="text-sm"><span className="font-medium">{place.name}</span> – {place.address}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <details open={places.length === 0} className="border-t border-gray-100 pt-2 dark:border-gray-700">
          <summary className="cursor-pointer text-sm font-medium text-blue-700 dark:text-blue-300">Neuer Ort</summary>
          <div className="mt-2"><PlaceForm eventId={eventId} /></div>
        </details>
      )}
    </SettingsSection>
  )
}

function TrackEditor({ eventId, track }: { eventId: string; track: PlanTrack }) {
  return (
    <div className="space-y-2 border-b border-gray-100 pb-4 dark:border-gray-700">
      <form action={updateTrack} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="trackId" value={track.id} />
        <div className="sm:flex-1">
          <label htmlFor="track-name" className={labelClass}>Name dieser Spur</label>
          <input id="track-name" name="name" required maxLength={60} defaultValue={track.name} className={inputClass} />
        </div>
        <div>
          <label htmlFor="track-visibility" className={labelClass}>Sichtbarkeit dieser Spur</label>
          <select id="track-visibility" name="visibility" defaultValue={track.visibility} className={inputClass}>
            {Object.entries(TRACK_VISIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <button type="submit" className={buttonClass('secondary')}>Spur speichern</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {(['left', 'right'] as const).map(direction => (
          <form key={direction} action={moveTrack}>
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="trackId" value={track.id} />
            <input type="hidden" name="direction" value={direction} />
            <button type="submit" className={buttonClass('secondary', 'sm')}>{direction === 'left' ? '← Tab nach links' : 'Tab nach rechts →'}</button>
          </form>
        ))}
        <form action={deleteTrack}>
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="trackId" value={track.id} />
          <button type="submit" className={buttonClass('danger', 'sm')}>Spur löschen</button>
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
      <button type="submit" aria-label={label} title={label} className="h-10 w-10 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">{symbol}</button>
    </form>
  )
}

function Row({ row, eventId, track, showTrack, showGap, clock, waitsFor, editable, neighbourEditable, trackQuery, place }: {
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
  place: Place | null
}) {
  const { item } = row
  const inactive = item.status === 'DEFERRED' || item.status === 'CANCELLED'
  const up = !showTrack && row.previousId && neighbourEditable(row.previousId)
  const down = !showTrack && row.nextId && neighbourEditable(row.nextId)
  return (
    <li id={`item-${item.id}`} data-item={item.id} className="scroll-mt-20">
      {showGap && row.gapMin !== null && row.gapMin !== 0 && (
        <p className={`px-4 py-1 text-xs ${row.gapMin > 0 ? 'bg-green-50 dark:bg-green-950/50 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-200'}`}>
          {row.gapMin > 0 ? `Puffer ${minutes(row.gapMin)}` : `Überschneidung ${minutes(-row.gapMin)}`}
        </p>
      )}
      <div className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:gap-3 ${inactive ? 'opacity-60' : ''}`}>
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="w-16 shrink-0 text-sm tabular-nums sm:w-24">
            <div className="font-semibold">{clock(item.plannedStart)}</div>
            <div className="text-gray-600 dark:text-gray-400">bis {clock(row.end)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{minutes(item.plannedDurationMin)}</div>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1">
              <span className={`mr-1 font-medium ${inactive ? 'line-through' : ''}`}>{item.title}</span>
              {item.isAnchor && <Badge tone="blue">Anker</Badge>}
              {item.mayStartEarly && <Badge>darf früher beginnen</Badge>}
              {item.minDurationMin !== null && <Badge>kürzbar bis {minutes(item.minDurationMin)}</Badge>}
              {item.visibility !== 'PUBLIC' && <Badge tone={item.visibility === 'SECRET' ? 'purple' : 'amber'}>{ITEM_VISIBILITY_LABELS[item.visibility]}</Badge>}
              {track?.visibility === 'TEAM' && item.visibility === 'PUBLIC' && <Badge tone="amber">Team-Spur</Badge>}
              {item.status === 'DEFERRED' && <Badge>zurückgestellt</Badge>}
              {item.status === 'CANCELLED' && <Badge tone="red">fällt aus</Badge>}
              {showTrack && track && <Badge>{track.name}</Badge>}
            </div>
            {item.location && <PlaceLine location={item.location} place={place} />}
            {item.description && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{item.description}</p>}
            {item.internalNote && <p className="text-sm text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 rounded-lg px-2 py-1 whitespace-pre-line">Notiz: {item.internalNote}</p>}
            {waitsFor.length > 0 && <p className="text-xs text-gray-600 dark:text-gray-400">wartet auf: {waitsFor.map(other => other.title).join(', ')}</p>}
          </div>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center justify-end gap-1 sm:flex-col sm:items-end sm:justify-start">
            {(up || down) && (
              <div className="flex gap-1">
                {up && <MoveButton eventId={eventId} itemId={item.id} otherId={row.previousId!} trackQuery={trackQuery} label={`„${item.title}“ nach oben`} symbol="↑" />}
                {down && <MoveButton eventId={eventId} itemId={item.id} otherId={row.nextId!} trackQuery={trackQuery} label={`„${item.title}“ nach unten`} symbol="↓" />}
              </div>
            )}
            <Link href={`/admin/events/${eventId}/items/${item.id}`} className={buttonClass('secondary', 'sm')} aria-label={`„${item.title}“ bearbeiten`}>Bearbeiten</Link>
          </div>
        )}
      </div>
    </li>
  )
}
