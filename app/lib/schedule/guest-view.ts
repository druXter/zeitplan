// app/lib/schedule/guest-view.ts
import type { Projected, ScheduleItem, TrackVisibility, Visibility } from './types'

const MINUTE = 60_000

/**
 * Was ein Programmpunkt für die Gästeansicht mitbringt. internalNote darf dabei sein (die Server Action
 * lädt den Punkt vollständig) - toGuestView gibt sie nie aus.
 */
export type GuestSourceItem = ScheduleItem & {
  title: string
  location: string | null
  description: string | null
  internalNote?: string | null
  visibility: Visibility
  cancelReason: string | null
  /** Ort mit Adresse (Idee L22), vom Server über das Feld "Ort" zugeordnet - für Gäste nur an öffentlichen Punkten. */
  place?: { address: string; routeUrl: string } | null
  /** Gäste erinnern (Idee L12) - wirkt nur mit guestAlerts MARKED. */
  guestAlert?: boolean
}

/** Erinnerungen für Gäste (Idee L12): aus, nur markierte Punkte oder alle öffentlichen Punkte. */
export type GuestAlertMode = 'OFF' | 'MARKED' | 'ALL'

export type GuestTrack = { id: string; name: string; visibility: TrackVisibility; sortOrder: number }

export type GuestSettings = {
  /** Abweichende Zeiten auf so viele Minuten runden (Standard 5). */
  guestRoundingMin: number
  /** Schwankungen unter so vielen Minuten ändern die Anzeige nicht (Standard 3). */
  hysteresisMin: number
  /** "+10" zeigen statt nur der neuen Uhrzeit (Standard aus). */
  showDelayToGuests: boolean
  /** Abweichungen erst so viele Minuten vor dem geplanten Beginn zeigen (Standard 120). */
  guestHorizonMin: number
  /** Erinnerungen für Gäste (Idee L12), fehlt = aus. */
  guestAlerts?: GuestAlertMode
}

export const DEFAULT_GUEST_SETTINGS: GuestSettings = { guestRoundingMin: 5, hysteresisMin: 3, showDelayToGuests: false, guestHorizonMin: 120 }

export type GuestStatus = 'upcoming' | 'now' | 'past' | 'cancelled'

/** Ein Punkt, wie Gäste ihn sehen. Jedes Feld ist ausdrücklich freigegeben - hier kommt nichts per Spread hinein. */
export type GuestItem = {
  id: string
  title: string
  location: string | null
  /** Adresse und Link "Route öffnen" des Orts (Idee L22), nicht bei ausgefallenen Punkten. */
  address: string | null
  routeUrl: string | null
  description: string | null
  /** Name der Spur (nur öffentliche Spuren). */
  track: string
  status: GuestStatus
  /** Beginn laut aktuellem Plan. */
  plannedStart: Date
  /** Angezeigter Beginn: Planzeit oder gerundete Prognose ("ca."). */
  shownStart: Date
  /** Weicht von der Planzeit ab - mit "ca." anzeigen. */
  approximate: boolean
  /** Abweichung in Minuten ("+10"), nur mit showDelayToGuests, sonst null. */
  delayMin: number | null
  /** Nur bei ausgefallenen Punkten. */
  cancelReason: string | null
  /** Gäste mit Abo bekommen vor diesem Punkt eine Erinnerung (Idee L12) - nicht bei ausgefallenen Punkten. */
  reminder: boolean
}

export type GuestView = {
  /** Chronologisch, öffentliche Spuren zusammengeführt. */
  items: GuestItem[]
  /** Angezeigter Beginn je Punkt - der Server speichert ihn als guestShownStart für die nächste Hysterese. */
  shown: Record<string, Date>
}

/** Öffentliche Spur eines für Gäste sichtbaren Punkts, sonst null (TEAM/SECRET, Team-Spur, unbekannte Spur, zurückgestellt). */
function guestTrack(source: GuestSourceItem, publicTracks: Map<string, GuestTrack>): GuestTrack | null {
  const track = publicTracks.get(source.trackId)
  return track && source.visibility === 'PUBLIC' && source.status !== 'DEFERRED' ? track : null
}

function roundTo(ms: number, stepMin: number): number {
  const step = stepMin * MINUTE
  return Math.round(ms / step) * step
}

/**
 * Die EINZIGE Stelle, an der Daten für Gäste entstehen (CLAUDE.md): Gästeansicht, Tafel und
 * Polling-Endpunkt geben nur das Ergebnis dieser Funktion aus. Reine Funktion, `now` kommt von außen.
 *
 * Sichtbar sind nur öffentliche Punkte in öffentlichen Spuren; TEAM- und SECRET-Punkte, Punkte in
 * Team-Spuren oder unbekannten Spuren und zurückgestellte Punkte fehlen vollständig. Ihre Zeit wirkt über
 * die Prognose trotzdem auf die sichtbaren Punkte. Ausgefallene Punkte bleiben mit Planzeit und Grund.
 *
 * Angezeigter Beginn (docs/KONZEPT.md Abschnitt 2, "Anzeige für Gäste"):
 *   1. Horizont: Ist der geplante Beginn weiter als guestHorizonMin entfernt (und der Punkt nicht schon
 *      im Gange), zählt die Planzeit statt der Prognose.
 *   2. Entspricht das der Planzeit genau, wird sie minutengenau gezeigt.
 *   3. Hysterese: Liegt es weniger als hysteresisMin neben dem zuletzt gezeigten Wert, bleibt dieser.
 *   4. Sonst auf guestRoundingMin gerundet.
 * "ca." (approximate), sobald der gezeigte Beginn von der Planzeit abweicht.
 *
 * reminder (Idee L12): mit guestAlerts ALL jeder sichtbare Punkt, mit MARKED die markierten (guestAlert), nie
 * ausgefallene. Die Erinnerungen selbst entstehen aus diesem Ergebnis (app/lib/guest-alerts) - so erfahren Gäste
 * per Push nichts, was sie nicht auch in der Gästeansicht sähen.
 */
export function toGuestView(
  projection: { items: Projected<GuestSourceItem>[]; tracks: GuestTrack[] },
  previouslyShown: Record<string, Date | null | undefined>,
  now: Date,
  settings: GuestSettings
): GuestView {
  const publicTracks = new Map(projection.tracks.filter(t => t.visibility === 'PUBLIC').map(t => [t.id, t]))
  const nowMs = now.getTime()
  const shown: Record<string, Date> = {}
  const rows: { item: GuestItem; trackOrder: number; sortOrder: number }[] = []

  for (const source of projection.items) {
    const track = guestTrack(source, publicTracks)
    if (!track) continue

    const planned = source.plannedStart.getTime()
    const cancelled = source.status === 'CANCELLED'
    let shownStart = planned
    if (!cancelled) {
      const withinHorizon = source.phase !== 'upcoming' || planned - nowMs <= settings.guestHorizonMin * MINUTE
      const target = withinHorizon ? source.expectedStart.getTime() : planned
      const previous = previouslyShown[source.id]?.getTime()
      if (target === planned) shownStart = planned
      else if (previous !== undefined && Math.abs(target - previous) < settings.hysteresisMin * MINUTE) shownStart = previous
      else shownStart = roundTo(target, settings.guestRoundingMin)
      shown[source.id] = new Date(shownStart)
    }

    rows.push({
      trackOrder: track.sortOrder,
      sortOrder: source.sortOrder,
      item: {
        id: source.id,
        title: source.title,
        location: source.location,
        address: cancelled ? null : source.place?.address ?? null,
        routeUrl: cancelled ? null : source.place?.routeUrl ?? null,
        description: source.description,
        track: track.name,
        status: cancelled ? 'cancelled' : source.phase === 'now' || source.phase === 'past' ? source.phase : 'upcoming',
        plannedStart: source.plannedStart,
        shownStart: new Date(shownStart),
        approximate: shownStart !== planned,
        delayMin: settings.showDelayToGuests ? Math.round((shownStart - planned) / MINUTE) : null,
        cancelReason: cancelled ? source.cancelReason : null,
        reminder: !cancelled && (settings.guestAlerts === 'ALL' || (settings.guestAlerts === 'MARKED' && source.guestAlert === true))
      }
    })
  }

  rows.sort((a, b) =>
    a.item.shownStart.getTime() - b.item.shownStart.getTime() || a.trackOrder - b.trackOrder || a.sortOrder - b.sortOrder
  )
  return { items: rows.map(row => row.item), shown }
}

/** Ein Punkt im gedruckten Programmheft (Idee L21) - wie GuestItem, aber zur Planzeit, ohne Prognose. */
export type ProgrammeItem = {
  id: string
  title: string
  location: string | null
  address: string | null
  description: string | null
  track: string
  start: Date
}

/**
 * Programmheft für Gäste zum Drucken (Idee L21): dieselben Punkte wie in toGuestView, aber mit der Planzeit (aktueller
 * Plan) statt der Prognose - Papier veraltet nicht minütlich - und ohne ausgefallene Punkte. Chronologisch, öffentliche
 * Spuren zusammengeführt. Auch hier ist jedes Feld ausdrücklich freigegeben.
 */
export function toProgramme(items: GuestSourceItem[], tracks: GuestTrack[]): ProgrammeItem[] {
  const publicTracks = new Map(tracks.filter(t => t.visibility === 'PUBLIC').map(t => [t.id, t]))
  const rows: { item: ProgrammeItem; trackOrder: number; sortOrder: number }[] = []
  for (const source of items) {
    const track = guestTrack(source, publicTracks)
    if (!track || source.status === 'CANCELLED') continue
    rows.push({
      trackOrder: track.sortOrder,
      sortOrder: source.sortOrder,
      item: {
        id: source.id,
        title: source.title,
        location: source.location,
        address: source.place?.address ?? null,
        description: source.description,
        track: track.name,
        start: source.plannedStart
      }
    })
  }
  rows.sort((a, b) => a.item.start.getTime() - b.item.start.getTime() || a.trackOrder - b.trackOrder || a.sortOrder - b.sortOrder)
  return rows.map(row => row.item)
}
