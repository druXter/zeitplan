import Link from 'next/link'
import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { canAddRemoveItems } from '../../../../lib/permissions'
import {
  currentDelayMin, isActive, isRunning, isStarted, liveReference, nextInTrack, project, LIVE_LIMITS, type Projected
} from '../../../../lib/schedule'
import { loadPlan } from '../../../../lib/planning/store'
import type { PlanItem } from '../../../../lib/planning/items'
import { PLAN_LIMITS } from '../../../../lib/planning/rules'
import { describeAction, isUndoable, parseState, recordTitle } from '../../../../lib/live/history'
import { endIfOver } from '../../../../lib/live/store'
import { formatDuration, formatItemClock } from '../../../../lib/timezone'
import AutoRefresh from '../../../../ui/auto-refresh'
import Badge from '../../../../ui/badge'
import Notice from '../../../../ui/notice'
import PendingButton from '../../../../ui/pending-button'
import StatusBadge from '../../../../ui/status-badge'
import { liveCommand } from './actions'
import UndoBar from './undo-bar'

export const dynamic = 'force-dynamic'

type LiveItem = Projected<PlanItem>
type Search = { track?: string; done?: string; error?: string; undone?: string; live?: string; ended?: string }

const ERRORS: Record<string, string> = {
  already: 'Das ist schon passiert – vermutlich war jemand anderes schneller. Hier ist der aktuelle Stand.',
  'not-next': 'Der Ablauf hat sich inzwischen geändert – das ist nicht mehr der nächste Punkt. Hier ist der aktuelle Stand.',
  'not-running': 'Dieser Punkt läuft gerade nicht.',
  started: 'Begonnene oder beendete Punkte lassen sich so nicht mehr ändern.',
  inactive: 'Zurückgestellte oder ausgefallene Punkte zuerst wiederherstellen.',
  'too-early': 'So früh geht nicht: nie vor dem Beginn des Punkts bzw. eines früheren Punkts.',
  range: 'Bitte eine gültige Zahl von Minuten angeben.',
  'nothing-started': 'In dieser Spur hat noch nichts begonnen.',
  anchor: 'Anker haben eine feste Uhrzeit – stelle den Punkt stattdessen wieder her.',
  cycle: '„Wartet auf“ ergäbe eine Schleife.',
  unknown: '„Wartet auf“ verweist auf einen Punkt, den es nicht mehr gibt.',
  'not-found': 'Den Punkt gibt es nicht mehr.',
  duplicate: 'Den Punkt gibt es schon.',
  forbidden: 'Das darfst du hier nicht (geheimer Punkt oder fehlendes Recht).',
  stale: 'Der Plan wurde inzwischen geändert. Hier ist der aktuelle Stand – versuche es noch einmal.',
  changed: 'Rückgängig geht nicht mehr: Die Punkte wurden seitdem weiter verändert.',
  undone: 'Diese Aktion wurde schon rückgängig gemacht.',
  'not-live': 'Das Event ist nicht live – die Live-Steuerung ist gesperrt.',
  'not-published': 'Live schalten geht nur bei veröffentlichten Events.',
  invalid: `Einschub: Bitte Titel (höchstens ${PLAN_LIMITS.titleMax} Zeichen), Dauer (1–${LIVE_LIMITS.maxInsertMin} Min) und Sichtbarkeit angeben.`,
  'not-inserted': 'Entfernen lassen sich nur eingeschobene Punkte, die noch nicht begonnen haben.'
}

const PRIMARY = 'w-full min-h-14 rounded-lg bg-blue-600 text-white text-lg font-bold px-4 hover:bg-blue-700'
const SECONDARY = 'w-full min-h-12 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-medium px-3 hover:bg-gray-50 dark:hover:bg-gray-900'
const DANGER = 'w-full min-h-12 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-red-800 dark:text-red-200 font-medium px-3 hover:bg-red-50 dark:hover:bg-red-950/50'

type Ctx = { eventId: string; track: string }

/** Ein Formular für einen Live-Befehl - ohne JavaScript bedienbar, ein Tipp genügt. */
function Cmd({ ctx, command, fields = {}, children, className = '' }: {
  ctx: Ctx; command: string; fields?: Record<string, string>; children: React.ReactNode; className?: string
}) {
  return (
    <form action={liveCommand} className={className}>
      <input type="hidden" name="eventId" value={ctx.eventId} />
      <input type="hidden" name="track" value={ctx.track} />
      <input type="hidden" name="command" value={command} />
      {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {children}
    </form>
  )
}

/**
 * Live-Steuerung (docs/KONZEPT.md Abschnitt 3): einhändig am Handy - große Knöpfe, der häufigste ("Weiter")
 * ganz oben, Rückgängig als Leiste unten. Pro Spur ein Tab mit dem laufenden und dem nächsten Punkt, darunter
 * der Rest. Jede Aktion ist ein eigenes Formular (liveCommand), das den gemeinten Punkt nennt. Alle Punkte kommen
 * aus loadPlan (SECRET: ohne Eintrag nur "Geheimer Punkt" und keine Knöpfe).
 */
export default async function LivePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/live`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const now = new Date()
  const status = (await endIfOver(event, now)) ? 'ENDED' : event.status

  const [{ tracks, items }, actions] = await Promise.all([
    loadPlan(event.id, user.id),
    prisma.liveAction.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { actor: { select: { email: true, name: true } }, undoneBy: { select: { email: true, name: true } } }
    })
  ])
  let projection = project(items, now, event)
  if (!projection.ok) projection = project(items.map(item => ({ ...item, waitsFor: [] })), now, event)
  const projected: LiveItem[] = projection.ok ? projection.items : []
  const conflicts = projection.ok ? projection.conflicts : []
  const byId = new Map(projected.map(item => [item.id, item]))

  const defaultTrack = tracks.find(t => projected.some(i => i.trackId === t.id && isRunning(i))) ?? tracks[0]
  const current = tracks.find(t => t.id === search.track) ?? defaultTrack
  const ctx: Ctx = { eventId: event.id, track: current?.id ?? '' }
  const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)
  const mayAddRemove = canAddRemoveItems(event.level, event)
  const isLive = status === 'LIVE'

  // Verlauf: Titel nur, soweit das Konto sie sehen darf (loadPlan bzw. gespeicherte SECRET-Liste).
  const titleOf = (itemId: string | null, states: unknown[]) => {
    if (!itemId) return '?'
    const known = byId.get(itemId)
    if (known) return known.title
    for (const state of states) {
      const title = recordTitle(parseState(state)?.items[itemId], user.id)
      if (title) return title
    }
    return 'gelöschter Punkt'
  }
  const history = actions.map(action => ({
    id: action.id,
    at: action.createdAt,
    who: action.actor ? action.actor.name || action.actor.email : null,
    undoneBy: action.undoneAt ? (action.undoneBy?.name || action.undoneBy?.email || 'jemand') : null,
    undoable: isLive && !action.undoneAt && isUndoable(action.type),
    mine: action.actorId === user.id,
    text: describeAction(action.type, parseState(action.after), itemId => titleOf(itemId, [action.after, action.before]))
  }))
  const lastAction = history[0]
  const undo = search.done ? history.find(entry => entry.id === search.done && entry.mine && entry.undoable && now.getTime() - entry.at.getTime() < 120_000) : undefined

  // Die gewählte Spur.
  const trackItems = current ? projected.filter(item => item.trackId === current.id).sort((a, b) => a.sortOrder - b.sortOrder) : []
  const running = trackItems.filter(item => isActive(item) && isRunning(item))
  const reference = current ? liveReference(trackItems, current.id) : null
  const next = current ? nextInTrack(trackItems, current.id) : null
  const lastRunning = running[running.length - 1] ?? null
  const upcoming = trackItems.filter(item => isActive(item) && !isStarted(item) && item.id !== next?.id && (!reference || item.sortOrder > reference.sortOrder))
  const skipped = trackItems.filter(item => isActive(item) && !isStarted(item) && reference !== null && item.sortOrder < reference.sortOrder)
  const done = trackItems.filter(item => item.actualEnd).sort((a, b) => b.actualEnd!.getTime() - a.actualEnd!.getTime())
  const deferred = trackItems.filter(item => item.status === 'DEFERRED')
  const cancelled = trackItems.filter(item => item.status === 'CANCELLED')
  // Nachbarn unter den aktiven Punkten (wie swapAdjacent) - für "tauschen".
  const activeOrder = trackItems.filter(isActive)
  const neighbour = (item: LiveItem, offset: -1 | 1) => {
    const other = activeOrder[activeOrder.indexOf(item) + offset]
    return other && item.canSee && other.canSee && !isStarted(other) && !other.isAnchor && !item.isAnchor ? other : null
  }
  const nudges = projected.filter(item => item.needsCheck && item.canSee)

  return (
    <main className={`bg-gray-50 dark:bg-gray-900 py-4 px-3 ${undo ? 'pb-28' : ''}`}>
      <AutoRefresh intervalMs={15_000} />
      <div className="max-w-xl mx-auto space-y-4 text-gray-900 dark:text-gray-100">
        <div className="space-y-1">
          <p className="text-sm"><Link href={`/admin/events/${event.id}`} className="text-blue-700 dark:text-blue-300 hover:underline">{event.title}</Link></p>
          <h1 className="text-2xl font-bold">Live-Steuerung <StatusBadge status={status} /></h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {clock(now)} Uhr{lastAction ? ` · letzte Meldung vor ${formatDuration(Math.max(0, Math.round((now.getTime() - lastAction.at.getTime()) / 60_000)))}` : ''}
            {' · '}<Link href={`/admin/events/${event.id}/team`} className="text-blue-700 dark:text-blue-300 hover:underline">Team-Ansicht</Link>
          </p>
        </div>

        {search.error && <Notice tone="error">{ERRORS[search.error] ?? 'Das hat nicht geklappt.'}</Notice>}
        {search.undone === '1' && <Notice tone="success">Rückgängig gemacht.</Notice>}
        {search.live === '1' && <Notice tone="success">Live geschaltet – der Ursprungsplan ist eingefroren.</Notice>}
        {search.ended === '1' && <Notice tone="success">Event beendet. Gäste sehen den Ablauf als Rückblick.</Notice>}

        {status === 'PUBLISHED' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Noch nicht live. Beim Live-Schalten wird der jetzige Plan als Ursprungsplan eingefroren; danach meldest du hier
              Beginn, Ende, Verspätungen und Änderungen.
            </p>
            <Cmd ctx={ctx} command="golive"><PendingButton className={PRIMARY}>Live schalten</PendingButton></Cmd>
          </div>
        )}
        {status === 'DRAFT' && <Notice tone="info">Das Event ist noch ein Entwurf. Live schalten geht, sobald es veröffentlicht ist.</Notice>}
        {(status === 'ENDED' || status === 'ARCHIVED') && <Notice tone="info">Das Event ist beendet – die Live-Steuerung ist gesperrt. Der Verlauf bleibt unten sichtbar.</Notice>}

        {isLive && conflicts.length > 0 && (
          <Notice tone="warning">
            <ul className="list-disc list-inside">
              {conflicts.map(conflict => (
                <li key={`${conflict.anchorId}-${conflict.itemId}`}>
                  „{byId.get(conflict.itemId)?.title}“ überschneidet „{byId.get(conflict.anchorId)?.title}“ um {formatDuration(conflict.overlapMin)} – kürzen?
                </li>
              ))}
            </ul>
          </Notice>
        )}

        {isLive && nudges.map(item => (
          <div key={item.id} role="alert" className="rounded-lg border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/50 p-3 space-y-2">
            <p className="font-bold">„{item.title}“ läuft noch?</p>
            <div className="grid grid-cols-2 gap-2">
              <Cmd ctx={{ ...ctx, track: item.trackId }} command="delay" fields={{ itemId: item.id, baseDelay: String(currentDelayMin(item)), addMin: '5' }}>
                <PendingButton className={SECONDARY}>Ja, +5 Min</PendingButton>
              </Cmd>
              <Cmd ctx={{ ...ctx, track: item.trackId }} command="end" fields={{ itemId: item.id, minutesAgo: '0' }}>
                <PendingButton className={SECONDARY}>Beendet</PendingButton>
              </Cmd>
            </div>
          </div>
        ))}

        {tracks.length > 1 && (
          <nav aria-label="Spuren" className="flex flex-wrap gap-1">
            {tracks.map(track => (
              <Link
                key={track.id}
                href={`/admin/events/${event.id}/live?track=${track.id}`}
                aria-current={current?.id === track.id ? 'page' : undefined}
                className={`min-h-11 inline-flex items-center px-3 rounded-full text-sm ${current?.id === track.id ? 'bg-blue-600 text-white font-bold' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600'}`}
              >
                {track.name}{track.visibility === 'TEAM' && ' (Team)'}
              </Link>
            ))}
          </nav>
        )}

        {isLive && current && (
          <>
            <section aria-labelledby="live-now" className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
              <h2 id="live-now" className="text-sm font-bold uppercase text-gray-600 dark:text-gray-400">Jetzt</h2>
              {running.length === 0 && <p className="text-gray-700 dark:text-gray-300">Gerade läuft in „{current.name}“ nichts.</p>}
              {running.map(item => (
                <div key={item.id} data-live-item={item.id} className="space-y-3">
                  <ItemHeading item={item} clock={clock} />
                  {item.canSee ? (
                    <>
                      {item === lastRunning && next && (
                        next.canSee ? (
                          <Cmd ctx={ctx} command="advance" fields={{ fromId: item.id, toId: next.id }}>
                            <PendingButton className={PRIMARY}>Weiter: {next.title}</PendingButton>
                          </Cmd>
                        ) : <p className="text-sm text-gray-600 dark:text-gray-400">Als Nächstes kommt ein geheimer Punkt – starten kann ihn nur, wer eingetragen ist.</p>
                      )}
                      <EndButtons ctx={ctx} item={item} />
                      <DelayControls ctx={ctx} item={item} label="Dauert länger" />
                    </>
                  ) : <SecretHint />}
                </div>
              ))}
            </section>

            <section aria-labelledby="live-next" className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
              <h2 id="live-next" className="text-sm font-bold uppercase text-gray-600 dark:text-gray-400">Als Nächstes</h2>
              {!next && <p className="text-gray-700 dark:text-gray-300">In dieser Spur kommt nichts mehr.</p>}
              {next && (
                <div data-live-item={next.id} className="space-y-3">
                  <ItemHeading item={next} clock={clock} />
                  {next.canSee ? (
                    <>
                      {next.unconfirmed && <p className="text-sm text-amber-900 dark:text-amber-200">Sollte schon laufen – noch nicht bestätigt.</p>}
                      {running.length === 0 && (
                        <Cmd ctx={ctx} command="advance" fields={{ fromId: '', toId: next.id }}>
                          <PendingButton className={PRIMARY}>Start: {next.title}</PendingButton>
                        </Cmd>
                      )}
                      <StartedAgo ctx={ctx} item={next} />
                      <DelayControls ctx={ctx} item={next} label="Verspätung" />
                      <PlanChanges ctx={ctx} item={next} after={neighbour(next, 1)} before={null} mayRemove={mayAddRemove} />
                    </>
                  ) : <SecretHint />}
                </div>
              )}
            </section>

            {upcoming.length > 0 && (
              <section aria-labelledby="live-later" className="space-y-2">
                <h2 id="live-later" className="text-sm font-bold uppercase text-gray-600 dark:text-gray-400">Danach</h2>
                <ul className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-200 dark:divide-gray-700">
                  {upcoming.map(item => (
                    <li key={item.id} data-live-item={item.id} className="p-3 space-y-2">
                      <ItemHeading item={item} clock={clock} compact />
                      {item.canSee && (
                        <details>
                          <summary className="cursor-pointer text-sm text-blue-700 dark:text-blue-300 min-h-11 flex items-center">Aktionen</summary>
                          <div className="space-y-3 pt-2">
                            <DelayControls ctx={ctx} item={item} label="Verspätung" />
                            <PlanChanges ctx={ctx} item={item} before={neighbour(item, -1)} after={neighbour(item, 1)} mayRemove={mayAddRemove} />
                          </div>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {skipped.length > 0 && (
              <ItemList title="Übersprungen (nicht begonnen)" items={skipped} clock={clock}>
                {item => (
                  <div className="grid grid-cols-2 gap-2">
                    <Cmd ctx={ctx} command="start" fields={{ itemId: item.id, minutesAgo: '0' }}><PendingButton className={SECONDARY}>Gestartet</PendingButton></Cmd>
                    <Cmd ctx={ctx} command="cancel" fields={{ itemId: item.id }}><PendingButton className={SECONDARY}>Ausfall</PendingButton></Cmd>
                  </div>
                )}
              </ItemList>
            )}

            {deferred.length > 0 && (
              <ItemList title="Zurückgestellt" items={deferred} clock={clock}>
                {item => (
                  <div className="grid grid-cols-2 gap-2">
                    {!item.isAnchor && reference && (
                      <Cmd ctx={ctx} command="requeue" fields={{ itemId: item.id }}><PendingButton className={SECONDARY}>Als Nächstes</PendingButton></Cmd>
                    )}
                    <Cmd ctx={ctx} command="restore" fields={{ itemId: item.id }}><PendingButton className={SECONDARY}>Wiederherstellen</PendingButton></Cmd>
                  </div>
                )}
              </ItemList>
            )}

            {cancelled.length > 0 && (
              <ItemList title="Ausgefallen" items={cancelled} clock={clock}>
                {item => <Cmd ctx={ctx} command="restore" fields={{ itemId: item.id }}><PendingButton className={SECONDARY}>Wiederherstellen</PendingButton></Cmd>}
              </ItemList>
            )}

            {mayAddRemove && (
              <details className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                <summary className="cursor-pointer font-bold min-h-11 flex items-center">Einschub</summary>
                {reference ? (
                  <Cmd ctx={ctx} command="insert" fields={{ trackId: current.id }} className="space-y-3 pt-2">
                    <p className="text-sm text-gray-600 dark:text-gray-400">Kommt direkt nach „{reference.title}“; die folgenden Punkte rutschen nach.</p>
                    <div>
                      <label htmlFor="insert-title" className="block text-sm font-medium mb-1">Titel</label>
                      <input id="insert-title" name="title" required maxLength={PLAN_LIMITS.titleMax} className="w-full border border-gray-300 dark:border-gray-600 p-3 rounded text-base" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="insert-duration" className="block text-sm font-medium mb-1">Dauer (Min)</label>
                        <input id="insert-duration" name="durationMin" type="number" inputMode="numeric" min={1} max={LIVE_LIMITS.maxInsertMin} required defaultValue={10} className="w-full border border-gray-300 dark:border-gray-600 p-3 rounded text-base" />
                      </div>
                      <div>
                        <label htmlFor="insert-visibility" className="block text-sm font-medium mb-1">Sichtbarkeit</label>
                        <select id="insert-visibility" name="visibility" defaultValue="PUBLIC" className="w-full border border-gray-300 dark:border-gray-600 p-3 rounded text-base bg-white dark:bg-gray-800">
                          <option value="PUBLIC">Öffentlich</option>
                          <option value="TEAM">Nur Team</option>
                        </select>
                      </div>
                    </div>
                    <PendingButton className={PRIMARY}>Einschieben</PendingButton>
                  </Cmd>
                ) : <p className="text-sm text-gray-600 dark:text-gray-400 pt-2">Einschieben geht, sobald in dieser Spur etwas begonnen hat.</p>}
              </details>
            )}
          </>
        )}

        {done.length > 0 && (
          <details className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <summary className="cursor-pointer font-bold min-h-11 flex items-center">Vorbei ({done.length})</summary>
            <ul className="divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              {done.map(item => (
                <li key={item.id} className="py-2">
                  <span className="tabular-nums">{clock(item.actualStart ?? item.expectedStart)}–{clock(item.actualEnd!)}</span> {item.title}
                </li>
              ))}
            </ul>
          </details>
        )}

        <details className="bg-white dark:bg-gray-800 rounded-lg shadow p-4" open={history.length > 0 && !isLive ? true : undefined}>
          <summary className="cursor-pointer font-bold min-h-11 flex items-center">Verlauf</summary>
          {history.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-400">Noch keine Aktionen.</p> : (
            <ol className="divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              {history.map(entry => (
                <li key={entry.id} data-history={entry.id} className="py-2 flex items-center gap-2">
                  <div className="grow min-w-0">
                    <p className={entry.undoneBy ? 'line-through text-gray-500 dark:text-gray-400' : ''}>{entry.text}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {clock(entry.at)} · {entry.who ?? 'automatisch'}{entry.undoneBy ? ` · rückgängig gemacht von ${entry.undoneBy}` : ''}
                    </p>
                  </div>
                  {entry.undoable && (
                    <Cmd ctx={ctx} command="undo" fields={{ actionId: entry.id }}>
                      <PendingButton className="min-h-11 px-3 rounded border border-gray-300 dark:border-gray-600 text-sm">Rückgängig</PendingButton>
                    </Cmd>
                  )}
                </li>
              ))}
            </ol>
          )}
        </details>

        {isLive && (
          <details className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <summary className="cursor-pointer font-bold min-h-11 flex items-center">Event beenden</summary>
            <p className="text-sm text-gray-600 dark:text-gray-400 py-2">Sperrt die Live-Steuerung; Gäste sehen den Ablauf danach als Rückblick. Geschieht sonst automatisch einige Stunden nach dem letzten Punkt.</p>
            <Cmd ctx={ctx} command="endevent"><PendingButton className={DANGER}>Event jetzt beenden</PendingButton></Cmd>
          </details>
        )}
      </div>
      {undo && <UndoBar key={undo.id} eventId={event.id} track={ctx.track} actionId={undo.id} description={undo.text} />}
    </main>
  )
}

function SecretHint() {
  return <p className="text-sm text-gray-600 dark:text-gray-400">Geheimer Punkt – steuern kann ihn nur, wer eingetragen ist.</p>
}

function ItemHeading({ item, clock, compact = false }: { item: LiveItem; clock: (date: Date) => string; compact?: boolean }) {
  const running = isRunning(item)
  const delay = currentDelayMin(item)
  return (
    <div className="flex gap-3">
      <div className="w-20 shrink-0 tabular-nums">
        <div className={`font-bold ${compact ? '' : 'text-lg'}`}>{clock(item.expectedStart)}</div>
        <div className="text-xs text-gray-600 dark:text-gray-400">bis {clock(item.expectedEnd)}</div>
      </div>
      <div className="grow min-w-0">
        <p className={`font-bold ${compact ? '' : 'text-lg'} leading-tight`}>{item.title}</p>
        <div className="flex flex-wrap gap-1 pt-1">
          {delay > 0 && <Badge tone="amber">+{delay} Min</Badge>}
          {item.reportedDelayMin !== null && <Badge tone="amber">gemeldet</Badge>}
          {running && <Badge tone="green">läuft seit {clock(item.actualStart!)}</Badge>}
          {item.capped ? <Badge tone="red">unklar</Badge> : item.overrun && <Badge tone="amber">überzogen</Badge>}
          {item.isAnchor && <Badge tone="blue">Anker {clock(item.plannedStart)}</Badge>}
          {item.visibility !== 'PUBLIC' && <Badge tone={item.visibility === 'SECRET' ? 'purple' : 'amber'}>{item.visibility === 'SECRET' ? 'Geheim' : 'Team'}</Badge>}
          {item.insertedLive && <Badge>Einschub</Badge>}
          <Badge>{formatDuration(item.plannedDurationMin)}</Badge>
        </div>
        {item.internalNote && !compact && <p className="text-sm text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 rounded px-2 py-1 mt-1 whitespace-pre-line">Notiz: {item.internalNote}</p>}
      </div>
    </div>
  )
}

function EndButtons({ ctx, item }: { ctx: Ctx; item: LiveItem }) {
  return (
    <div className="space-y-2">
      <Cmd ctx={ctx} command="end" fields={{ itemId: item.id, minutesAgo: '0' }}>
        <PendingButton className={SECONDARY}>Beendet</PendingButton>
      </Cmd>
      <p className="text-sm font-medium">Vergessen zu drücken? Beendet vor …</p>
      <Cmd ctx={ctx} command="end" fields={{ itemId: item.id }} className="grid grid-cols-3 gap-2">
        {[5, 10, 15].map(minutes => (
          <PendingButton key={minutes} name="minutesAgo" value={String(minutes)} className={SECONDARY} ariaLabel={`Beendet vor ${minutes} Minuten`}>{minutes} Min</PendingButton>
        ))}
      </Cmd>
    </div>
  )
}

function StartedAgo({ ctx, item }: { ctx: Ctx; item: LiveItem }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Schon gestartet vor …</p>
      <Cmd ctx={ctx} command="start" fields={{ itemId: item.id }} className="grid grid-cols-3 gap-2">
        {[5, 10, 15].map(minutes => (
          <PendingButton key={minutes} name="minutesAgo" value={String(minutes)} className={SECONDARY} ariaLabel={`Gestartet vor ${minutes} Minuten`}>{minutes} Min</PendingButton>
        ))}
      </Cmd>
    </div>
  )
}

/** +5/+10/+15 und eigene Zahl - Zielwert = bisherige Abweichung (baseDelay) + Minuten, "Im Plan" setzt zurück. */
function DelayControls({ ctx, item, label }: { ctx: Ctx; item: LiveItem; label: string }) {
  const base = String(currentDelayMin(item))
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <Cmd ctx={ctx} command="delay" fields={{ itemId: item.id, baseDelay: base }} className="grid grid-cols-3 gap-2">
        {[5, 10, 15].map(minutes => (
          <PendingButton key={minutes} name="addMin" value={String(minutes)} className={SECONDARY} ariaLabel={`${label} +${minutes} Minuten`}>+{minutes}</PendingButton>
        ))}
      </Cmd>
      <Cmd ctx={ctx} command="delay" fields={{ itemId: item.id, baseDelay: base }} className="flex gap-2">
        <label htmlFor={`add-${item.id}`} className="sr-only">Eigene Minuten</label>
        <input id={`add-${item.id}`} name="addMin" type="number" inputMode="numeric" min={1} max={LIVE_LIMITS.maxDelayMin} placeholder="eigene Minuten" required className="grow min-w-0 min-h-12 border border-gray-300 dark:border-gray-600 rounded px-2 text-base" />
        <PendingButton className="shrink-0 min-h-12 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-medium px-4 hover:bg-gray-50 dark:hover:bg-gray-900">+ Melden</PendingButton>
      </Cmd>
      {item.reportedDelayMin !== null && (
        <Cmd ctx={ctx} command="ontime" fields={{ itemId: item.id }}><PendingButton className={SECONDARY}>Im Plan (Meldung zurücknehmen)</PendingButton></Cmd>
      )}
    </div>
  )
}

/** Tauschen, Zurückstellen, Ausfall (mit optionalem Grund), Entfernen eines Einschubs. */
function PlanChanges({ ctx, item, before, after, mayRemove }: { ctx: Ctx; item: LiveItem; before: LiveItem | null; after: LiveItem | null; mayRemove: boolean }) {
  const swap = (other: LiveItem, label: string) => (
    <Cmd ctx={ctx} command="swap" fields={{ itemId: item.id, otherId: other.id, version: String(item.version), otherVersion: String(other.version) }}>
      <PendingButton className={SECONDARY}>{label}</PendingButton>
    </Cmd>
  )
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {before && swap(before, `↑ vor „${before.title}“`)}
        {after && swap(after, `↓ nach „${after.title}“`)}
        <Cmd ctx={ctx} command="defer" fields={{ itemId: item.id }}><PendingButton className={SECONDARY}>Zurückstellen</PendingButton></Cmd>
        {mayRemove && item.insertedLive && (
          <Cmd ctx={ctx} command="remove" fields={{ itemId: item.id }}><PendingButton className={DANGER}>Einschub entfernen</PendingButton></Cmd>
        )}
      </div>
      <Cmd ctx={ctx} command="cancel" fields={{ itemId: item.id }} className="flex gap-2">
        <label htmlFor={`reason-${item.id}`} className="sr-only">Grund für den Ausfall (optional)</label>
        <input id={`reason-${item.id}`} name="reason" maxLength={LIVE_LIMITS.cancelReasonMax} placeholder="Grund (optional)" className="grow min-w-0 min-h-12 border border-gray-300 dark:border-gray-600 rounded px-2 text-base" />
        <PendingButton className="shrink-0 min-h-12 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-red-800 dark:text-red-200 font-medium px-3 hover:bg-red-50 dark:hover:bg-red-950/50">Ausfall</PendingButton>
      </Cmd>
    </div>
  )
}

function ItemList({ title, items, clock, children }: { title: string; items: LiveItem[]; clock: (date: Date) => string; children: (item: LiveItem) => React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase text-gray-600 dark:text-gray-400">{title}</h2>
      <ul className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-200 dark:divide-gray-700">
        {items.map(item => (
          <li key={item.id} data-live-item={item.id} className="p-3 space-y-2">
            <ItemHeading item={item} clock={clock} compact />
            {item.canSee ? children(item) : <SecretHint />}
          </li>
        ))}
      </ul>
    </section>
  )
}

