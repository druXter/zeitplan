import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { describeAction, historyTitle, parseState } from '../../../../lib/live/history'
import { PLAN_LIMITS } from '../../../../lib/planning/rules'
import { formatDeviation, OUTCOME_LABELS, placeByTime, type ReviewOutcome, type ReviewRow } from '../../../../lib/review/review'
import { decisionNames, describeProtocolEntry, loadProtocol, type ProtocolEntry } from '../../../../lib/rsvp/protocol'
import { loadReview, type ReviewItem } from '../../../../lib/review/store'
import { formatDate, formatDuration, formatItemClock } from '../../../../lib/timezone'
import Badge from '../../../../ui/badge'
import Notice from '../../../../ui/notice'
import { buttonClass } from '../../../../ui/kit'
import PrintButton from '../../../../ui/print-button'
import { saveResultNote } from '../../review-actions'

export const dynamic = 'force-dynamic'

const NOTE_ERRORS: Record<string, string> = {
  long: `Protokollnotiz: höchstens ${PLAN_LIMITS.noteMax} Zeichen.`,
  changed: 'Die Protokollnotiz wurde inzwischen von jemand anderem geändert. Hier ist der aktuelle Stand – bitte noch einmal eintragen.',
  forbidden: 'Diese Notiz darfst du nicht ändern.'
}

const OUTCOME_TONES: Record<ReviewOutcome, 'green' | 'blue' | 'red' | 'amber' | undefined> = {
  done: 'green', running: 'blue', cancelled: 'red', deferred: 'amber', skipped: undefined
}

/** Wie viele Aktionen der Verlauf höchstens zeigt - für einen Eventtag mehr als genug. */
const HISTORY_LIMIT = 2000

/**
 * Rückblick (Idee L24): Plan gegen Ist je Punkt, Zusammenfassung, Protokollnotizen und der vollständige Verlauf -
 * zum Auswerten nach dem Event und als Dokumentation einer Sitzung (Tagesordnungspunkte als Programmpunkte). Für
 * alle Konten mit Zugriff; geheime Punkte ohne Eintrag nur mit Platzhalter, ohne Notizen (loadPlan). Druckbar,
 * dazu CSV. Die Rechnung steht in app/lib/review/review.ts. Gibt der verknüpfte Termin in rsvp-app es frei (Idee L7),
 * stehen Kommen und Gehen und die Beschlüsse der Sitzung beim Punkt, der gerade lief (loadProtocol, nur angezeigt).
 */
export default async function ReviewPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ noted?: string; noteError?: string }>
}) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/rueckblick`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const [{ tracks, rows, summary }, actions, protocol] = await Promise.all([
    loadReview(event.id, user.id),
    prisma.liveAction.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'asc' },
      take: HISTORY_LIMIT,
      include: { actor: { select: { email: true, name: true } }, undoneBy: { select: { email: true, name: true } } }
    }),
    loadProtocol(event)
  ])
  const placed = protocol.state === 'ok' ? placeByTime(rows, protocol.entries) : null

  const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)
  const trackNames = new Map(tracks.map(track => [track.id, track.name]))
  const titles = new Map(rows.map(row => [row.item.id, row.item.title]))
  const history = actions.map(action => ({
    id: action.id,
    at: action.createdAt,
    who: action.actor ? action.actor.name || action.actor.email : null,
    undoneBy: action.undoneAt ? (action.undoneBy?.name || action.undoneBy?.email || 'jemand') : null,
    text: describeAction(action.type, parseState(action.after), itemId => historyTitle(itemId, titles, [action.after, action.before], user.id))
  }))
  const { counts } = summary
  const countText = [
    `${counts.done} stattgefunden`,
    counts.running > 0 && `${counts.running} läuft noch`,
    counts.cancelled > 0 && `${counts.cancelled} ausgefallen`,
    counts.deferred > 0 && `${counts.deferred} zurückgestellt, nicht nachgeholt`,
    counts.skipped > 0 && `${counts.skipped} nicht begonnen`,
    counts.inserted > 0 && `davon ${counts.inserted} ${counts.inserted === 1 ? 'Einschub' : 'Einschübe'}`
  ].filter(Boolean).join(' · ')

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          {/* Beim Drucken fehlt der Kopf des Events - dann steht der Titel hier. */}
          <h2 className="text-lg font-semibold print:text-2xl">Rückblick<span className="hidden print:inline">: {event.title}</span></h2>
          <p className="hidden text-sm text-gray-600 print:block">{formatDate(event.date, event.timezone)}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          <a href={`/admin/events/${event.id}/rueckblick/csv`} className={buttonClass('secondary')}>Als CSV herunterladen</a>
        </div>
      </div>

      {search.noted === '1' && <div className="print:hidden"><Notice tone="success">Protokollnotiz gespeichert.</Notice></div>}
      {search.noteError && <Notice tone="error">{NOTE_ERRORS[search.noteError] ?? 'Das hat nicht geklappt.'}</Notice>}
      {!summary.frozen && (
        <Notice tone="info">Das Event war noch nicht live – verglichen wird mit dem aktuellen Plan statt mit einem eingefrorenen Ursprungsplan.</Notice>
      )}
      {event.status === 'LIVE' && <Notice tone="info">Das Event läuft noch – der Rückblick zeigt den Stand von jetzt.</Notice>}
      {protocol.state === 'unreachable' && <Notice tone="warning">Anwesenheit und Beschlüsse ließen sich gerade nicht aus rsvp-app laden – bitte später neu laden.</Notice>}
      {protocol.state === 'ok' && protocol.decisions === 'unreachable' && <Notice tone="warning">Die Beschlüsse ließen sich gerade nicht aus dem Abstimmungstool laden – bitte später neu laden.</Notice>}

      {rows.length === 0 ? (
        <p className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 text-sm text-gray-600 dark:text-gray-400">Noch keine Programmpunkte.</p>
      ) : (
        <>
          <section aria-labelledby="review-summary" className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm print:shadow-none print:border p-4 space-y-2">
            <h2 id="review-summary" className="font-semibold">Zusammenfassung</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-600 dark:text-gray-400">Geplant</dt>
              <dd className="tabular-nums">{summary.plannedStart && summary.plannedEnd ? `${clock(summary.plannedStart)}–${clock(summary.plannedEnd)} Uhr` : '–'}</dd>
              <dt className="text-gray-600 dark:text-gray-400">Tatsächlich</dt>
              <dd className="tabular-nums">
                {summary.actualStart ? `${clock(summary.actualStart)}–${summary.actualEnd ? `${clock(summary.actualEnd)} Uhr` : '…'}` : 'noch nichts begonnen'}
                {summary.endDeviationMin !== null && ` (Ende ${formatDeviation(summary.endDeviationMin)} Min)`}
              </dd>
              <dt className="text-gray-600 dark:text-gray-400">Punkte</dt>
              <dd>{countText}</dd>
              {protocol.state === 'ok' && (
                <>
                  <dt className="text-gray-600 dark:text-gray-400">Protokoll</dt>
                  <dd data-protocol-summary>{protocolSummary(protocol.entries, protocol.presence, protocol.decisions === 'ok')}</dd>
                </>
              )}
              {summary.overruns.length > 0 && (
                <>
                  <dt className="text-gray-600 dark:text-gray-400">Überzogen</dt>
                  <dd>{summary.overruns.map(overrun => `„${titles.get(overrun.id)}“ ${formatDeviation(overrun.minutes)} Min`).join(', ')}</dd>
                </>
              )}
            </dl>
          </section>

          <section aria-labelledby="review-items" className="space-y-2">
            <h2 id="review-items" className="font-semibold">Punkte</h2>
            <ol className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm print:shadow-none print:border divide-y divide-gray-200 dark:divide-gray-700">
              {rows.map(row => (
                <ReviewEntry key={row.item.id} row={row} eventId={event.id} clock={clock} trackName={tracks.length > 1 ? trackNames.get(row.item.trackId) ?? null : null}
                  protocol={placed?.byItem.get(row.item.id) ?? []} />
              ))}
            </ol>
          </section>
        </>
      )}

      {placed && placed.outside.length > 0 && (
        <section aria-labelledby="review-outside" className="space-y-2">
          <h2 id="review-outside" className="font-semibold">Außerhalb der Punkte</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">Kommen, Gehen und Beschlüsse vor dem ersten Punkt, in Pausen oder danach.</p>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm print:shadow-none print:border p-3">
            <ProtocolList entries={placed.outside} clock={clock} testId="protocol-outside" />
          </div>
        </section>
      )}

      <section aria-labelledby="review-history" className="space-y-2 print:break-before-page">
        <h2 id="review-history" className="font-semibold">Verlauf</h2>
        {history.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-400">Keine Meldungen.</p> : (
          <ol className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm print:shadow-none print:border divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            {history.map(entry => (
              <li key={entry.id} data-history={entry.id} className="px-3 py-1.5 flex gap-3">
                <span className="w-16 shrink-0 tabular-nums text-gray-600 dark:text-gray-400">{clock(entry.at)}</span>
                <span className="grow min-w-0">
                  <span className={entry.undoneBy ? 'line-through text-gray-500 dark:text-gray-400' : ''}>{entry.text}</span>
                  <span className="text-xs text-gray-600 dark:text-gray-400"> · {entry.who ?? 'automatisch'}{entry.undoneBy ? ` · rückgängig gemacht von ${entry.undoneBy}` : ''}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

/** "12× Kommen oder Gehen · 3 Beschlüsse" - was aus rsvp-app freigegeben ist. */
function protocolSummary(entries: ProtocolEntry[], presence: boolean, decisions: boolean): string {
  const moves = entries.filter(entry => entry.kind === 'presence').length
  const resolutions = entries.length - moves
  return [
    presence && `${moves}× Kommen oder Gehen`,
    decisions && `${resolutions} ${resolutions === 1 ? 'Beschluss' : 'Beschlüsse'}`
  ].filter(Boolean).join(' · ')
}

/** Kommen, Gehen und Beschlüsse mit Uhrzeit (aus rsvp-app, nur angezeigt). */
function ProtocolList({ entries, clock, testId }: { entries: ProtocolEntry[]; clock: (date: Date) => string; testId: string }) {
  return (
    <ol data-testid={testId} className="text-sm space-y-0.5">
      {entries.map((entry, index) => {
        const names = decisionNames(entry)
        return (
          <li key={index} className={`flex gap-2 ${entry.kind === 'decision' ? 'font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
            <span className="w-12 shrink-0 tabular-nums text-gray-600 dark:text-gray-400">{clock(entry.at)}</span>
            <span className="min-w-0">
              {entry.kind === 'decision' ? '🗳️ ' : entry.change === 'OUT' ? '← ' : '→ '}{describeProtocolEntry(entry)}
              {names && <span className="block text-xs font-normal text-gray-600 dark:text-gray-400">{names}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function ReviewEntry({ row, eventId, clock, trackName, protocol }: {
  row: ReviewRow<ReviewItem>; eventId: string; clock: (date: Date) => string; trackName: string | null; protocol: ProtocolEntry[]
}) {
  const { item } = row
  const range = (start: Date | null, end: Date | null) => (start ? `${clock(start)}–${end ? clock(end) : '…'}` : '–')
  const deviations = [
    row.startDeviationMin !== null && `Beginn ${formatDeviation(row.startDeviationMin)} Min`,
    row.durationDeviationMin !== null && `Dauer ${formatDeviation(row.durationDeviationMin)} Min`
  ].filter(Boolean).join(' · ')
  return (
    <li id={`item-${item.id}`} data-review-item={item.id} className="p-3 flex gap-3 break-inside-avoid">
      <dl className="w-32 shrink-0 text-sm tabular-nums">
        <dt className="text-xs text-gray-600 dark:text-gray-400">Plan</dt>
        <dd>{row.baseStart ? range(row.baseStart, row.baseEnd) : 'Einschub'}</dd>
        <dt className="text-xs text-gray-600 dark:text-gray-400">Ist</dt>
        <dd className="font-bold">{range(item.actualStart, item.actualEnd)}</dd>
      </dl>
      <div className="grow min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className={`font-medium ${row.outcome === 'cancelled' ? 'line-through' : ''}`}>{item.title}</span>
          <Badge tone={OUTCOME_TONES[row.outcome]}>{OUTCOME_LABELS[row.outcome]}</Badge>
          {item.visibility !== 'PUBLIC' && <Badge tone={item.visibility === 'SECRET' ? 'purple' : 'amber'}>{item.visibility === 'SECRET' ? 'Geheim' : 'Team'}</Badge>}
          {row.baseStart === null && <Badge>Einschub</Badge>}
          {row.moved && <Badge>verlegt</Badge>}
          {trackName && <Badge>{trackName}</Badge>}
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {row.baseDurationMin !== null && `geplant ${formatDuration(row.baseDurationMin)}`}
          {row.actualDurationMin !== null && `${row.baseDurationMin !== null ? ', ' : ''}tatsächlich ${formatDuration(row.actualDurationMin)}`}
          {deviations && <span className="text-gray-600 dark:text-gray-400"> · {deviations}</span>}
        </p>
        {row.outcome === 'cancelled' && item.cancelReason && <p className="text-sm text-gray-700 dark:text-gray-300">Grund: {item.cancelReason}</p>}
        {protocol.length > 0 && <ProtocolList entries={protocol} clock={clock} testId="protocol-item" />}
        {item.resultNote && <p data-result-note className="text-sm bg-gray-50 dark:bg-gray-900 print:bg-white rounded-lg px-2 py-1 whitespace-pre-line">{item.resultNote}</p>}
        {item.canSee && (
          <details className="print:hidden">
            <summary className="cursor-pointer text-sm text-blue-700 dark:text-blue-300 min-h-9 flex items-center">Protokollnotiz {item.resultNote ? 'bearbeiten' : 'hinzufügen'}</summary>
            <form action={saveResultNote} className="space-y-2 pt-1">
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="previous" value={item.resultNote ?? ''} />
              <label htmlFor={`note-${item.id}`} className="sr-only">Protokollnotiz zu „{item.title}“</label>
              <textarea id={`note-${item.id}`} name="note" defaultValue={item.resultNote ?? ''} maxLength={PLAN_LIMITS.noteMax} rows={3} placeholder="z. B. Ergebnis, Beschluss" className="w-full rounded-lg border border-gray-300 bg-white p-2 text-base sm:text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900" />
              <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-60 whitespace-nowrap px-3.5 py-2 text-sm bg-white text-gray-800 hover:bg-gray-50 border border-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-700">Notiz speichern</button>
            </form>
          </details>
        )}
      </div>
    </li>
  )
}
