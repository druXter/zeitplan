import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { loadPlan } from '../../../../lib/planning/store'
import type { PlanItem } from '../../../../lib/planning/items'
import { isActive, project, whatIf, LIVE_LIMITS, type WhatIfRefusal, type WhatIfRow } from '../../../../lib/schedule'
import { formatDuration, formatItemClock } from '../../../../lib/timezone'
import Badge from '../../../../ui/badge'
import Notice from '../../../../ui/notice'

export const dynamic = 'force-dynamic'

const REFUSALS: Record<WhatIfRefusal, string> = {
  'not-found': 'Den Punkt gibt es nicht mehr.',
  inactive: 'Zurückgestellte oder ausgefallene Punkte verbrauchen keine Zeit – da gibt es nichts zu simulieren.',
  done: 'Der Punkt ist schon vorbei.',
  range: `Bitte eine Verspätung von 1 bis ${LIVE_LIMITS.maxDelayMin} Minuten angeben.`,
  cycle: '„Wartet auf“ ergibt eine Schleife – bitte zuerst in der Planung korrigieren.'
}

const QUICK = [10, 20, 30, 45]

/**
 * "Was wäre wenn"-Vorschau (Idee L19): Ein Punkt verspätet sich um X Minuten mehr als jetzt erwartet - wie der Knopf
 * "+X" in der Live-Steuerung. Die Seite zeigt, welche Puffer das schlucken, wo kürzbare Punkte gekürzt werden und wo
 * Konflikte mit Ankern entstehen. Nur lesen: ein GET-Formular, nichts wird gespeichert (whatIf aus dem Kern). Punkte
 * kommen aus loadPlan - geheime ohne Eintrag nur als Platzhalter. Für alle Konten mit Zugriff aufs Event.
 */
export default async function WhatIfPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ punkt?: string; plus?: string; schnell?: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/was-waere-wenn`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const { tracks, items } = await loadPlan(event.id, user.id)
  const now = new Date()
  const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)
  const trackName = new Map(tracks.map(track => [track.id, track.name]))

  // Auswahl: Punkte, die noch kommen oder laufen, nach erwartetem Beginn.
  const current = project(items, now, event)
  const choices = current.ok
    ? current.items.filter(item => isActive(item) && !item.actualEnd).sort((a, b) => a.expectedStart.getTime() - b.expectedStart.getTime())
    : []
  const itemId = typeof search.punkt === 'string' ? search.punkt : ''
  // Schnellwahl (+10 usw.) kommt als eigener Parameter, weil das Formular das Feld "plus" immer mitschickt.
  const minutesParam = typeof search.schnell === 'string' ? search.schnell : search.plus
  const plus = typeof minutesParam === 'string' && /^\d{1,4}$/.test(minutesParam) ? Number(minutesParam) : 20
  const asked = itemId !== ''
  const result = asked ? whatIf(items, { itemId, delayMin: plus }, now, event) : null
  const titleOf = new Map(items.map(item => [item.id, item.title]))
  const target = items.find(item => item.id === itemId)

  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Was wäre wenn?</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Simuliert eine Verspätung, ohne etwas zu speichern – eine Generalprobe für die Puffer. Gerechnet wird vom jetzigen
          Stand aus ({clock(now)} Uhr, mit allen Meldungen), so als würdest du in der Live-Steuerung „+X“ drücken.
        </p>
      </div>

      {!current.ok && <Notice tone="error">{REFUSALS.cycle}</Notice>}
      {current.ok && choices.length === 0 && <Notice tone="info">Es gibt keinen Punkt, der noch kommt oder läuft.</Notice>}

      {choices.length > 0 && (
        <form method="get" className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div>
              <label htmlFor="whatif-item" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Punkt</label>
              <select id="whatif-item" name="punkt" defaultValue={itemId || choices[0].id} className="w-full rounded-lg border border-gray-300 bg-white p-2 text-base sm:text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900">
                {choices.map(item => (
                  <option key={item.id} value={item.id}>
                    {clock(item.expectedStart)} {item.title}{tracks.length > 1 ? ` (${trackName.get(item.trackId)})` : ''}{item.actualStart ? ' – läuft' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="whatif-plus" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Minuten später</label>
              <input id="whatif-plus" name="plus" type="number" inputMode="numeric" min={1} max={LIVE_LIMITS.maxDelayMin} step={1} defaultValue={plus} className="w-full sm:w-28 rounded-lg border border-gray-300 bg-white p-2 text-base sm:text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-60 whitespace-nowrap px-3.5 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 border border-blue-600">Durchspielen</button>
            {QUICK.map(minutes => (
              <button key={minutes} type="submit" name="schnell" value={minutes} className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-60 whitespace-nowrap px-3.5 py-2 text-sm bg-white text-gray-800 hover:bg-gray-50 border border-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-700">+{minutes}</button>
            ))}
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">Bei einem laufenden Punkt heißt „+X“: Er dauert X Minuten länger.</p>
        </form>
      )}

      {result && !result.ok && <Notice tone="error">{REFUSALS[result.reason]}</Notice>}
      {result && result.ok && target && (
        <Outcome
          rows={result.rows}
          conflicts={result.conflicts}
          trackEnds={result.trackEnds}
          target={target}
          plus={plus}
          clock={clock}
          titleOf={titleOf}
          trackName={trackName}
          multipleTracks={tracks.length > 1}
        />
      )}
    </div>
  )
}

function Outcome({ rows, conflicts, trackEnds, target, plus, clock, titleOf, trackName, multipleTracks }: {
  rows: WhatIfRow<PlanItem>[]
  conflicts: { anchorId: string; itemId: string; overlapMin: number; previousOverlapMin: number }[]
  trackEnds: { trackId: string; endShiftMin: number }[]
  target: PlanItem
  plus: number
  clock: (date: Date) => string
  titleOf: Map<string, string>
  trackName: Map<string, string>
  multipleTracks: boolean
}) {
  // Gezeigt wird, was noch kommt oder läuft - nach dem simulierten Beginn.
  const shown = rows
    .filter(row => isActive(row.before) && !row.before.actualEnd && (row.before.phase !== 'past' || row.before.id === target.id))
    .sort((a, b) => a.after.expectedStart.getTime() - b.after.expectedStart.getTime())
  const moved = shown.filter(row => row.startShiftMin > 0 || row.endShiftMin > 0)

  return (
    <section data-whatif className="space-y-3">
      <h2 className="text-lg font-semibold">„{target.title}“ +{formatDuration(plus)}</h2>
      <ul className="text-sm space-y-1">
        <li>{moved.length === 1 ? 'Ein Punkt verschiebt sich.' : `${moved.length} Punkte verschieben sich.`}</li>
        {trackEnds.map(end => (
          <li key={end.trackId} data-track-end={end.trackId}>
            Ende {multipleTracks ? `der Spur „${trackName.get(end.trackId)}“` : 'des Ablaufs'}:{' '}
            {end.endShiftMin > 0 ? <span className="font-bold text-amber-800 dark:text-amber-200">{formatDuration(end.endShiftMin)} später</span> : 'unverändert'}
          </li>
        ))}
      </ul>
      {conflicts.length > 0 && (
        <Notice tone="warning">
          <ul className="list-disc list-inside">
            {conflicts.map(conflict => (
              <li key={`${conflict.anchorId}-${conflict.itemId}`}>
                „{titleOf.get(conflict.itemId)}“ überschneidet den Anker „{titleOf.get(conflict.anchorId)}“ um {formatDuration(conflict.overlapMin)}
                {conflict.previousOverlapMin > 0 ? ` (jetzt schon ${formatDuration(conflict.previousOverlapMin)})` : ''}.
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {conflicts.length === 0 && <Notice tone="success">Kein Konflikt mit einem Anker.</Notice>}

      <ol className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm divide-y divide-gray-200 dark:divide-gray-700">
        {shown.map(row => {
          const item = row.after
          const changed = row.startShiftMin > 0 || row.endShiftMin > 0
          return (
            <li key={item.id} data-item={item.id} className={`p-3 flex gap-3 ${item.id === target.id ? 'bg-amber-50 dark:bg-amber-950/50' : ''}`}>
              <div className="w-32 shrink-0 text-sm tabular-nums">
                <div className="font-bold">{clock(item.expectedStart)}–{clock(item.expectedEnd)}</div>
                {changed
                  ? <div className="text-xs text-gray-600 dark:text-gray-400">jetzt {clock(row.before.expectedStart)}–{clock(row.before.expectedEnd)}</div>
                  : <div className="text-xs text-gray-600 dark:text-gray-400">unverändert</div>}
              </div>
              <div className="grow min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-medium">{item.title}</span>
                  {multipleTracks && <Badge>{trackName.get(item.trackId)}</Badge>}
                  {item.isAnchor && <Badge tone="blue">Anker</Badge>}
                  {row.startShiftMin > 0 && <Badge tone="amber">+{row.startShiftMin} Min</Badge>}
                  {row.startShiftMin === 0 && row.endShiftMin > 0 && <Badge tone="amber">endet {row.endShiftMin} Min später</Badge>}
                </div>
                {row.absorbedByGapMin > 0 && <p className="text-xs text-green-800 dark:text-green-200">Puffer davor schluckt {formatDuration(row.absorbedByGapMin)}.</p>}
                {row.extraShortenedMin > 0 && <p className="text-xs text-green-800 dark:text-green-200">Wird um {formatDuration(row.extraShortenedMin)} gekürzt (kürzbar bis {formatDuration(item.minDurationMin ?? 0)}).</p>}
                {row.anchorHolds && <p className="text-xs text-red-800 dark:text-red-200">Anker – rutscht nicht mit, der Punkt davor überschneidet ihn.</p>}
              </div>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-gray-600 dark:text-gray-400">Nur eine Vorschau – gespeichert wurde nichts. Gäste und Team sehen weiter die echte Prognose.</p>
    </section>
  )
}
