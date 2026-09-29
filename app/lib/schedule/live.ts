// app/lib/schedule/live.ts
import { byTrack, checkDependencies } from './dependencies'
import { applyChanges } from './plan-changes'
import { isActive, project } from './project'
import type { ItemStatus, Projected, ProjectSettings, ScheduleItem } from './types'

const MINUTE = 60_000

/**
 * Live-Steuerung (docs/KONZEPT.md Abschnitt 3) als reine Funktionen: Aus dem aktuellen Stand, einem Befehl und
 * der Serverzeit `now` entstehen Änderungen an Punkten (LivePatch) - oder eine begründete Ablehnung. Keine
 * Datenbank, keine Uhr, keine Rechte (die prüft die Server Action). Tauschen und Einschub kommen aus
 * plan-changes.ts (swapAdjacent, insertAfter).
 *
 * Absichtsbasiert und idempotent: Jeder Befehl nennt die Punkte, die er meint ("beende A, starte B"). Ist das
 * schon passiert, lautet die Antwort 'already' und es ändert sich nichts - zwei gleichzeitige "Weiter"
 * überspringen so nie zwei Punkte.
 */

export const LIVE_LIMITS = {
  /** "Gestartet/Beendet vor ...": höchstens so viele Minuten zurück. */
  maxMinutesAgo: 180,
  /** Gemeldete Verspätung in Minuten. */
  maxDelayMin: 600,
  cancelReasonMax: 200,
  /** Einschub: Dauer in Minuten. */
  maxInsertMin: 600,
  /** So lange nach dem letzten Punkt endet ein Event automatisch (Stunden). */
  autoEndGraceHours: 6
} as const

export type LivePatch = {
  id: string
  status?: ItemStatus
  actualStart?: Date | null
  actualEnd?: Date | null
  reportedDelayMin?: number | null
  reportedAt?: Date | null
  cancelReason?: string | null
  plannedStart?: Date
  sortOrder?: number
}

export type LiveCommand =
  /** "Weiter": beendet fromId (null = nichts läuft) und startet toId - den nächsten Punkt der Spur. */
  | { kind: 'advance'; fromId: string | null; toId: string }
  | { kind: 'start'; id: string; minutesAgo: number }
  | { kind: 'end'; id: string; minutesAgo: number }
  /** Verspätung melden - der Zielwert (bisherige Abweichung + 5 usw.), den die Moderator*in gesehen hat. */
  | { kind: 'delay'; id: string; delayMin: number }
  | { kind: 'ontime'; id: string }
  | { kind: 'defer'; id: string }
  | { kind: 'cancel'; id: string; reason: string | null }
  | { kind: 'restore'; id: string }
  /** Zurückgestellten Punkt als Nächstes einreihen (nach dem laufenden bzw. zuletzt begonnenen). */
  | { kind: 'requeue'; id: string }

export type LiveRefusal =
  | 'not-found'
  /** Ist schon passiert (z. B. zweites "Weiter") - nichts zu tun. */
  | 'already'
  | 'not-running'
  /** toId ist nicht (mehr) der nächste Punkt der Spur. */
  | 'not-next'
  | 'started'
  | 'inactive'
  /** Zeitpunkt vor dem Beginn des Punkts bzw. des vorherigen Punkts. */
  | 'too-early'
  | 'range'
  /** In der Spur hat noch nichts begonnen - es gibt kein "danach". */
  | 'nothing-started'
  | 'anchor'
  | 'cycle'

export type LiveResult = { ok: true; patches: LivePatch[] } | { ok: false; reason: LiveRefusal }

export function isRunning(item: Pick<ScheduleItem, 'actualStart' | 'actualEnd'>): boolean {
  return item.actualStart !== null && item.actualEnd === null
}

export function isStarted(item: Pick<ScheduleItem, 'actualStart' | 'actualEnd'>): boolean {
  return item.actualStart !== null || item.actualEnd !== null
}

/**
 * Bezugspunkt einer Spur: der laufende Punkt (bei mehreren der letzte in der Reihenfolge), sonst der zuletzt
 * begonnene. Nach ihm kommen Einschub und "als Nächstes". null: In der Spur hat noch nichts begonnen.
 */
export function liveReference<T extends ScheduleItem>(items: T[], trackId: string): T | null {
  const track = (byTrack(items.filter(isActive)).get(trackId) ?? []).filter(isStarted)
  const running = track.filter(isRunning)
  const pool = running.length > 0 ? running : track
  return pool.length > 0 ? pool[pool.length - 1] : null
}

/** Der nächste Punkt einer Spur: der erste nicht begonnene aktive Punkt nach dem Bezugspunkt (bzw. von vorn). */
export function nextInTrack<T extends ScheduleItem>(items: T[], trackId: string, afterId?: string | null): T | null {
  const track = byTrack(items.filter(isActive)).get(trackId) ?? []
  const reference = afterId !== undefined ? (afterId === null ? null : items.find(i => i.id === afterId) ?? null) : liveReference(items, trackId)
  return track.find(item => !isStarted(item) && (!reference || item.sortOrder > reference.sortOrder)) ?? null
}

/**
 * Bisherige Abweichung in Minuten, auf die "+5" aufsetzt: bei einem laufenden Punkt die seines Endes (so
 * verlängert "+5" ihn, docs/KONZEPT.md "Entschieden"), sonst die seines Beginns - nie negativ.
 */
export function currentDelayMin(item: Projected): number {
  if (isRunning(item)) {
    const plannedEnd = item.plannedStart.getTime() + item.plannedDurationMin * MINUTE
    return Math.max(0, Math.round((item.expectedEnd.getTime() - plannedEnd) / MINUTE))
  }
  return Math.max(0, item.delayMin)
}

function minutesAgoValid(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= LIVE_LIMITS.maxMinutesAgo
}

export function applyLiveCommand(items: ScheduleItem[], command: LiveCommand, now: Date, settings: ProjectSettings): LiveResult {
  const find = (id: string | null) => (id === null ? undefined : items.find(item => item.id === id))
  const nowMs = now.getTime()

  switch (command.kind) {
    case 'advance': {
      const to = find(command.toId)
      if (!to) return { ok: false, reason: 'not-found' }
      if (!isActive(to)) return { ok: false, reason: 'inactive' }
      if (isStarted(to)) return { ok: false, reason: 'already' }
      const patches: LivePatch[] = []
      if (command.fromId !== null) {
        const from = find(command.fromId)
        if (!from) return { ok: false, reason: 'not-found' }
        if (from.actualEnd) return { ok: false, reason: 'already' }
        if (!from.actualStart) return { ok: false, reason: 'not-running' }
        if (from.trackId !== to.trackId || nextInTrack(items, to.trackId, from.id)?.id !== to.id) return { ok: false, reason: 'not-next' }
        patches.push({ id: from.id, status: 'DONE', actualEnd: now })
      } else {
        if ((byTrack(items.filter(isActive)).get(to.trackId) ?? []).some(isRunning)) return { ok: false, reason: 'not-next' }
        if (nextInTrack(items, to.trackId)?.id !== to.id) return { ok: false, reason: 'not-next' }
      }
      // Mit dem Beginn steht fest, wann der Punkt anfing - eine vorher gemeldete Verspätung hat sich erledigt.
      patches.push({ id: to.id, status: 'RUNNING', actualStart: now, reportedDelayMin: null, reportedAt: null })
      return { ok: true, patches }
    }

    case 'start': {
      if (!minutesAgoValid(command.minutesAgo)) return { ok: false, reason: 'range' }
      const item = find(command.id)
      if (!item) return { ok: false, reason: 'not-found' }
      if (!isActive(item)) return { ok: false, reason: 'inactive' }
      if (isStarted(item)) return { ok: false, reason: 'already' }
      const at = nowMs - command.minutesAgo * MINUTE
      // Nie vor dem Beginn eines früheren Punkts derselben Spur.
      const earlier = items.filter(other => other.trackId === item.trackId && other.sortOrder < item.sortOrder && other.actualStart)
      if (earlier.some(other => other.actualStart!.getTime() > at)) return { ok: false, reason: 'too-early' }
      return { ok: true, patches: [{ id: item.id, status: 'RUNNING', actualStart: new Date(at), reportedDelayMin: null, reportedAt: null }] }
    }

    case 'end': {
      if (!minutesAgoValid(command.minutesAgo)) return { ok: false, reason: 'range' }
      const item = find(command.id)
      if (!item) return { ok: false, reason: 'not-found' }
      if (item.actualEnd) return { ok: false, reason: 'already' }
      if (!item.actualStart) return { ok: false, reason: 'not-running' }
      const at = nowMs - command.minutesAgo * MINUTE
      if (at < item.actualStart.getTime()) return { ok: false, reason: 'too-early' }
      return { ok: true, patches: [{ id: item.id, status: 'DONE', actualEnd: new Date(at) }] }
    }

    case 'delay': {
      if (!Number.isInteger(command.delayMin) || command.delayMin < 0 || command.delayMin > LIVE_LIMITS.maxDelayMin) return { ok: false, reason: 'range' }
      const item = find(command.id)
      if (!item) return { ok: false, reason: 'not-found' }
      if (!isActive(item)) return { ok: false, reason: 'inactive' }
      if (item.actualEnd) return { ok: false, reason: 'started' }
      if (item.reportedDelayMin === command.delayMin) return { ok: false, reason: 'already' }
      return { ok: true, patches: [{ id: item.id, reportedDelayMin: command.delayMin, reportedAt: now }] }
    }

    case 'ontime': {
      const item = find(command.id)
      if (!item) return { ok: false, reason: 'not-found' }
      if (item.actualEnd) return { ok: false, reason: 'started' }
      if (item.reportedDelayMin === null) return { ok: false, reason: 'already' }
      return { ok: true, patches: [{ id: item.id, reportedDelayMin: null, reportedAt: null }] }
    }

    case 'defer': {
      const item = find(command.id)
      if (!item) return { ok: false, reason: 'not-found' }
      if (item.status === 'DEFERRED') return { ok: false, reason: 'already' }
      if (!isActive(item)) return { ok: false, reason: 'inactive' }
      if (isStarted(item)) return { ok: false, reason: 'started' }
      return { ok: true, patches: [{ id: item.id, status: 'DEFERRED' }] }
    }

    case 'cancel': {
      const item = find(command.id)
      if (!item) return { ok: false, reason: 'not-found' }
      if (item.status === 'CANCELLED') return { ok: false, reason: 'already' }
      if (isStarted(item)) return { ok: false, reason: 'started' }
      const reason = command.reason?.trim().slice(0, LIVE_LIMITS.cancelReasonMax) || null
      return { ok: true, patches: [{ id: item.id, status: 'CANCELLED', cancelReason: reason }] }
    }

    case 'restore': {
      const item = find(command.id)
      if (!item) return { ok: false, reason: 'not-found' }
      if (isActive(item)) return { ok: false, reason: 'already' }
      return { ok: true, patches: [{ id: item.id, status: 'PLANNED', cancelReason: null }] }
    }

    case 'requeue': {
      const item = find(command.id)
      if (!item) return { ok: false, reason: 'not-found' }
      if (item.status !== 'DEFERRED') return { ok: false, reason: isActive(item) ? 'already' : 'inactive' }
      if (item.isAnchor) return { ok: false, reason: 'anchor' }
      const reference = liveReference(items, item.trackId)
      if (!reference) return { ok: false, reason: 'nothing-started' }

      const projection = project(items, now, settings)
      if (!projection.ok) return { ok: false, reason: 'cycle' }
      const referenceEnd = projection.items.find(p => p.id === reference.id)!.expectedEnd.getTime()
      const start = Math.ceil(Math.max(referenceEnd, nowMs) / MINUTE) * MINUTE

      // Neue Reihenfolge der Spur: der Punkt direkt nach dem Bezugspunkt, alle lückenlos 1..n.
      const others = items.filter(other => other.trackId === item.trackId && other.id !== item.id).sort((a, b) => a.sortOrder - b.sortOrder)
      const index = others.indexOf(reference)
      const ordered = [...others.slice(0, index + 1), item, ...others.slice(index + 1)]
      const patches: LivePatch[] = []
      ordered.forEach((entry, position) => {
        if (entry.id === item.id) patches.push({ id: item.id, status: 'PLANNED', plannedStart: new Date(start), sortOrder: position + 1 })
        else if (entry.sortOrder !== position + 1) patches.push({ id: entry.id, sortOrder: position + 1 })
      })
      const changed = applyChanges(items, patches.map(p => ({ id: p.id, plannedStart: p.plannedStart, sortOrder: p.sortOrder })))
        .map(entry => (entry.id === item.id ? { ...entry, status: 'PLANNED' as const } : entry))
      if (checkDependencies(changed)) return { ok: false, reason: 'cycle' }
      return { ok: true, patches }
    }
  }
}

/** Wendet Patches auf eine Liste an - für Tests und Vorschau (die Server Action schreibt sie in die Datenbank). */
export function applyLivePatches<T extends ScheduleItem>(items: T[], patches: LivePatch[]): T[] {
  const byId = new Map(patches.map(patch => [patch.id, patch]))
  return items.map(item => {
    const patch = byId.get(item.id)
    if (!patch) return item
    const fields = Object.entries(patch).filter(([key, value]) => key !== 'id' && value !== undefined)
    return { ...item, ...Object.fromEntries(fields) }
  })
}

/**
 * Wann ein Event automatisch endet (docs/KONZEPT.md Abschnitt 10, "Nach Eventende automatisch ENDED"):
 * LIVE_LIMITS.autoEndGraceHours nach dem Ende des letzten aktiven Punkts (tatsächliches Ende, sonst geplantes).
 * Ohne Punkte zwei Tage nach dem Beginn des Eventtags.
 */
export function autoEndAt(items: ScheduleItem[], eventDate: Date): Date {
  const ends = items.filter(isActive).map(item => item.actualEnd?.getTime() ?? item.plannedStart.getTime() + item.plannedDurationMin * MINUTE)
  if (ends.length === 0) return new Date(eventDate.getTime() + 2 * 24 * 60 * MINUTE)
  return new Date(Math.max(...ends) + LIVE_LIMITS.autoEndGraceHours * 60 * MINUTE)
}
