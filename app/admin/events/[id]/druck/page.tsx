import QRCode from 'qrcode'
import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { baseUrl } from '../../../../lib/base-url'
import { loadEventOr404 } from '../../../../lib/events/store'
import { isGuestVisibleStatus } from '../../../../lib/guest/access'
import { toProgramme } from '../../../../lib/schedule'
import { allRows, trackRows, type PlanRow } from '../../../../lib/planning/order'
import { ITEM_VISIBILITY_LABELS } from '../../../../lib/planning/rules'
import { loadPlan, type PlanTrack } from '../../../../lib/planning/store'
import type { PlanItem } from '../../../../lib/planning/items'
import { placeIndex, type Place } from '../../../../lib/planning/places'
import { formatDate, formatDateTime, formatDuration, formatItemClock } from '../../../../lib/timezone'
import PrintButton from '../../../../ui/print-button'
import { Segmented } from '../../../../ui/kit'

export const dynamic = 'force-dynamic'

type Search = { art?: string; spur?: string }

/**
 * Drucken (Idee L21) für alle Konten mit Zugriff:
 * - Regieplan fürs Team (Standard): A4, Planzeiten mit Ende, Dauer und Puffern, Orte mit Adresse, Zuständige,
 *   Beschreibung und interne Notiz - als Rückfall, wenn Netz oder Akku ausfallen. Pro Spur (jede auf eigener Seite),
 *   alle Spuren zusammen (?spur=alle) oder eine Spur (?spur=<id>). Geheime Punkte nur mit Eintrag, sonst als
 *   Platzhalter mit Zeit und Dauer (loadPlan).
 * - Programmheft für Gäste (?art=programm): nur, was Gäste sehen dürfen (toProgramme), zur Planzeit, mit QR-Code
 *   zur Gästeansicht für den aktuellen Stand.
 */
export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/druck`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const [{ tracks, items }, places] = await Promise.all([
    loadPlan(event.id, user.id),
    prisma.place.findMany({ where: { eventId: event.id }, select: { id: true, name: true, address: true, mapUrl: true } })
  ])
  const placeOf = placeIndex(places)
  const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)
  const programme = search.art === 'programm'
  const base = `/admin/events/${event.id}/druck`
  return (
    <div className="max-w-4xl space-y-4 print:text-black">
      <div className="space-y-3 print:hidden">
        <h2 className="text-lg font-semibold">Drucken</h2>
        <Segmented label="Art des Ausdrucks" items={[
          { href: base, label: 'Regieplan pro Spur', active: !programme && !search.spur },
          ...(tracks.length > 1 ? [
            { href: `${base}?spur=alle`, label: 'Regieplan, alle Spuren zusammen', active: !programme && search.spur === 'alle' },
            ...tracks.map(track => ({ href: `${base}?spur=${track.id}`, label: `Nur ${track.name}`, active: !programme && search.spur === track.id }))
          ] : []),
          { href: `${base}?art=programm`, label: 'Programmheft für Gäste', active: programme }
        ]} />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <PrintButton />
          <span className="text-gray-600 dark:text-gray-400">
            {programme
              ? 'Nur öffentliche Punkte, zur Planzeit. Ausgefallene Punkte fehlen.'
              : 'Mit internen Notizen – nur fürs Team. Planzeiten (aktueller Plan), keine Prognose.'}
          </span>
        </div>
      </div>

      {programme
        ? <Programme event={event} items={items} tracks={tracks} placeOf={placeOf} clock={clock} />
        : <DirectorPlan event={event} items={items} tracks={tracks} selected={search.spur} placeOf={placeOf} clock={clock}
            names={await assigneeNames(event, items)} />}
    </div>
  )
}

/** Anzeigenamen der Zuständigen mit Zugriff aufs Event (wie in der Team-Ansicht). */
async function assigneeNames(event: { id: string; ownerId: string | null }, items: PlanItem[]): Promise<Map<string, string>> {
  const ids = [...new Set(items.flatMap(item => item.assigneeIds))]
  if (ids.length === 0) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, OR: [{ role: 'ADMIN' }, ...(event.ownerId ? [{ id: event.ownerId }] : []), { eventAccess: { some: { eventId: event.id } } }] },
    select: { id: true, name: true, email: true }
  })
  return new Map(users.map(user => [user.id, user.name || user.email]))
}

function DirectorPlan({ event, items, tracks, selected, placeOf, clock, names }: {
  event: { title: string; date: Date; timezone: string }
  items: PlanItem[]
  tracks: PlanTrack[]
  selected: string | undefined
  placeOf: (location: string | null) => Place | null
  clock: (date: Date) => string
  names: Map<string, string>
}) {
  const trackById = new Map(tracks.map(track => [track.id, track]))
  const single = tracks.find(track => track.id === selected)
  const groups: { title: string | null; rows: PlanRow<PlanItem>[]; showTrack: boolean }[] = selected === 'alle'
    ? [{ title: null, rows: allRows(items, tracks.map(t => t.id)), showTrack: true }]
    : (single ? [single] : tracks).map(track => ({ title: track.name, rows: trackRows(items.filter(item => item.trackId === track.id)), showTrack: false }))
  const waitsForTitle = new Map(items.map(item => [item.id, item.title]))

  return (
    <>
      {groups.map((group, index) => (
        <section key={group.title ?? 'alle'} className={`bg-white dark:bg-gray-800 print:bg-white rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm print:border-0 print:shadow-none p-4 print:p-0 space-y-2 ${index > 0 ? 'print:break-before-page' : ''}`}>
          <header>
            <h1 className="text-xl font-semibold">Regieplan: {event.title}{group.title && tracks.length > 1 ? ` – ${group.title}` : ''}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 print:text-gray-700">
              {formatDate(event.date, event.timezone)} · Stand {formatDateTime(new Date(), event.timezone)} · Planzeiten, aktuelle Zeiten in der Team-Ansicht
            </p>
          </header>
          {group.rows.length === 0 ? (
            <p className="text-sm">Keine Programmpunkte.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b-2 border-gray-400">
                  <th className="py-1 pr-2 w-24">Zeit</th>
                  <th className="py-1 pr-2">Punkt</th>
                  <th className="py-1 pr-2 w-1/4">Ort</th>
                  <th className="py-1 w-1/3">Notiz</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(row => {
                  const { item } = row
                  const place = placeOf(item.location)
                  const inactive = item.status === 'CANCELLED' || item.status === 'DEFERRED'
                  const assignees = item.assigneeIds.map(id => names.get(id)).filter((name): name is string => name !== undefined)
                  return (
                    <tr key={item.id} data-item={item.id} className="border-b border-gray-300 align-top break-inside-avoid">
                      <td className="py-1 pr-2 tabular-nums">
                        {!group.showTrack && row.gapMin !== null && row.gapMin > 0 && <div className="text-xs text-gray-600 dark:text-gray-400 print:text-gray-700">Puffer {formatDuration(row.gapMin)}</div>}
                        <div className={`font-bold ${inactive ? 'line-through' : ''}`}>{clock(item.plannedStart)}</div>
                        <div className="text-xs">bis {clock(row.end)}</div>
                        <div className="text-xs">{formatDuration(item.plannedDurationMin)}</div>
                      </td>
                      <td className="py-1 pr-2">
                        <div className={`font-medium ${inactive ? 'line-through' : ''}`}>{item.title}</div>
                        <div className="text-xs space-x-1">
                          {item.isAnchor && <span>[Anker]</span>}
                          {item.visibility !== 'PUBLIC' && <span>[{ITEM_VISIBILITY_LABELS[item.visibility]}]</span>}
                          {trackById.get(item.trackId)?.visibility === 'TEAM' && item.visibility === 'PUBLIC' && <span>[Team-Spur]</span>}
                          {group.showTrack && <span>[{trackById.get(item.trackId)?.name}]</span>}
                          {item.status === 'CANCELLED' && <span>[fällt aus{item.cancelReason ? `: ${item.cancelReason}` : ''}]</span>}
                          {item.status === 'DEFERRED' && <span>[zurückgestellt]</span>}
                        </div>
                        {assignees.length > 0 && <div className="text-xs">Zuständig: {assignees.join(', ')}</div>}
                        {item.waitsFor.length > 0 && <div className="text-xs">wartet auf: {item.waitsFor.map(other => waitsForTitle.get(other) ?? '?').join(', ')}</div>}
                      </td>
                      <td className="py-1 pr-2">
                        {item.location}
                        {place && <div className="text-xs">{place.address}</div>}
                      </td>
                      <td className="py-1 whitespace-pre-line">
                        {item.internalNote}
                        {item.description && <div className="text-xs text-gray-600 dark:text-gray-400 print:text-gray-700">{item.internalNote ? 'Für Gäste: ' : ''}{item.description}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </>
  )
}

async function Programme({ event, items, tracks, placeOf, clock }: {
  event: { slug: string; title: string; description: string; date: Date; timezone: string; status: string }
  items: PlanItem[]
  tracks: PlanTrack[]
  placeOf: (location: string | null) => Place | null
  clock: (date: Date) => string
}) {
  const entries = toProgramme(items.map(item => {
    const place = placeOf(item.location)
    return { ...item, place: place ? { address: place.address, routeUrl: '' } : null }
  }), tracks)
  const showTracks = tracks.filter(track => track.visibility === 'PUBLIC').length > 1
  const url = `${baseUrl()}/${event.slug}`
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })

  return (
    <section className="bg-white dark:bg-gray-800 print:bg-white rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm print:border-0 print:shadow-none p-6 print:p-0 space-y-4">
      {!isGuestVisibleStatus(event.status as Parameters<typeof isGuestVisibleStatus>[0]) && (
        <p className="text-sm text-amber-900 dark:text-amber-200 print:hidden">Hinweis: Das Event ist noch nicht veröffentlicht – der QR-Code führt Gäste erst danach zum Ablauf.</p>
      )}
      <header className="text-center space-y-1">
        <h1 className="text-3xl font-semibold">{event.title}</h1>
        <p>{formatDate(event.date, event.timezone)}</p>
        {event.description && <p className="text-sm whitespace-pre-line">{event.description}</p>}
      </header>
      {entries.length === 0 ? (
        <p className="text-center text-sm">Noch keine öffentlichen Programmpunkte.</p>
      ) : (
        <ol className="space-y-3">
          {entries.map(entry => (
            <li key={entry.id} data-item={entry.id} className="flex gap-4 break-inside-avoid">
              <span className="w-20 shrink-0 text-right font-bold tabular-nums">{clock(entry.start)}</span>
              <div className="min-w-0">
                <p className="font-bold">{entry.title}{showTracks && <span className="font-normal text-sm"> · {entry.track}</span>}</p>
                {entry.location && <p className="text-sm">{entry.location}{entry.address && `, ${entry.address}`}</p>}
                {entry.description && <p className="text-sm whitespace-pre-line">{entry.description}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <footer className="flex items-center justify-center gap-4 pt-4 border-t border-gray-300 break-inside-avoid">
        {/* eslint-disable-next-line @next/next/no-img-element -- data:-URL, next/image bringt hier nichts */}
        <img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`} alt={`QR-Code: ${url}`} className="w-24 h-24" />
        <p className="text-sm">Aktuelle Zeiten, falls sich etwas verschiebt:<br /><span className="break-all">{url}</span></p>
      </footer>
    </section>
  )
}
