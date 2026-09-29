'use server'

import { redirect } from 'next/navigation'
import { requireUser } from '../../../../lib/auth'
import { formString } from '../../../../lib/form'
import { loadEventForUser } from '../../../../lib/events/store'
import { canAddRemoveItems, seesItemContent } from '../../../../lib/permissions'
import {
  applyLiveCommand, insertAfter, isStarted, liveReference, LIVE_LIMITS, swapAdjacent, type LiveCommand, type LivePatch, type ScheduleItem
} from '../../../../lib/schedule'
import { cleanText, PLAN_LIMITS } from '../../../../lib/planning/rules'
import { loadPlan } from '../../../../lib/planning/store'
import type { PlanItem } from '../../../../lib/planning/items'
import { isUndoable, parseState, unchangedSince, type ActionMeta, type LiveActionType } from '../../../../lib/live/history'
import {
  applyPatches, endIfOver, freezeOriginalPlan, liveTransaction, LiveRefused, logAction, readRecords, restoreRecords
} from '../../../../lib/live/store'

// Live-Steuerung (docs/KONZEPT.md Abschnitt 3). EINE Action für alle Knöpfe der Live-Seite, damit jede Aktion
// dieselben Prüfungen durchläuft:
//   - Zugriff aufs Event (loadEventForUser), Event ist LIVE (sonst gesperrt; nach Eventende automatisch ENDED)
//   - SECRET: jeder genannte Punkt muss für das Konto sichtbar sein (loadPlan → canSee), auch Tauschpartner
//   - Einschub und Entfernen nur mit Recht (canAddRemoveItems: Moderator*innen brauchen den Schalter)
//   - Zeit ist IMMER die Serverzeit (new Date() hier) - das Formular liefert höchstens "vor N Minuten"
// Die Regeln selbst kommen aus dem Kern (applyLiveCommand, swapAdjacent, insertAfter). Jede Änderung landet mit
// Vorher/Nachher im Verlauf (LiveAction) - Grundlage für Rückgängig.

const COMMANDS = ['advance', 'start', 'end', 'delay', 'ontime', 'defer', 'cancel', 'restore', 'requeue', 'swap', 'insert', 'remove', 'undo', 'golive', 'endevent'] as const
type Command = (typeof COMMANDS)[number]

/** Ganze, nicht negative Zahl aus dem Formular, sonst NaN (der Kern lehnt dann mit 'range' ab). */
function formInt(formData: FormData, name: string): number {
  const raw = formString(formData, name, 10)
  return /^\d{1,4}$/.test(raw) ? Number(raw) : NaN
}

type Outcome = { done: string } | { error: string } | { undone: true } | { live: true } | { ended: true }

export async function liveCommand(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')
  const command = formString(formData, 'command', 20) as Command
  const track = formString(formData, 'track', 50)
  const back: (params: Record<string, string>) => never = params => {
    const query = new URLSearchParams({ ...(track ? { track } : {}), ...params }).toString()
    return redirect(`/admin/events/${event.id}/live${query ? `?${query}` : ''}`)
  }
  if (!COMMANDS.includes(command)) back({ error: 'invalid' })

  const now = new Date()
  if (await endIfOver(event, now)) back({ error: 'not-live' })

  let outcome: Outcome
  try {
    outcome = await liveTransaction(event.id, async tx => {
      const current = await tx.event.findUniqueOrThrow({ where: { id: event.id }, select: { status: true } })

      if (command === 'golive') {
        if (current.status !== 'PUBLISHED') throw new LiveRefused('not-published')
        await tx.event.update({ where: { id: event.id }, data: { status: 'LIVE' } })
        await freezeOriginalPlan(tx, event.id)
        await logAction(tx, { eventId: event.id, actorId: user.id, type: 'golive', itemId: null, before: { items: {} }, after: { items: {} } })
        return { live: true }
      }
      if (current.status !== 'LIVE') throw new LiveRefused('not-live')
      if (command === 'endevent') {
        await tx.event.update({ where: { id: event.id }, data: { status: 'ENDED' } })
        await logAction(tx, { eventId: event.id, actorId: user.id, type: 'endevent', itemId: null, before: { items: {} }, after: { items: {} } })
        return { ended: true }
      }

      const { items } = await loadPlan(event.id, user.id, tx)
      const byId = new Map(items.map(item => [item.id, item]))
      /** Punkt muss existieren und für das Konto sichtbar sein (SECRET) - sonst wie "gibt es nicht" bzw. verboten. */
      const visible = (id: string | null): PlanItem | null => {
        if (id === null) return null
        const item = byId.get(id)
        if (!item) throw new LiveRefused('not-found')
        if (!item.canSee) throw new LiveRefused('forbidden')
        return item
      }
      const mayAddRemove = canAddRemoveItems(event.level, event)

      // Rückgängig: nur, solange die Punkte genau so sind wie nach der Aktion.
      if (command === 'undo') {
        const action = await tx.liveAction.findFirst({ where: { id: formString(formData, 'actionId', 50), eventId: event.id } })
        if (!action || !isUndoable(action.type)) throw new LiveRefused('not-found')
        if (action.undoneAt) throw new LiveRefused('undone')
        const before = parseState(action.before)
        const after = parseState(action.after)
        if (!before || !after) throw new LiveRefused('changed')
        if ((action.type === 'insert' || action.type === 'remove') && !mayAddRemove) throw new LiveRefused('forbidden')
        const ids = [...new Set([...Object.keys(before.items), ...Object.keys(after.items)])]
        for (const id of ids) {
          const item = byId.get(id)
          const snapshot = before.items[id]?.content
          // Sichtbarkeit: vorhandene Punkte über loadPlan, entfernte über ihre gespeicherte SECRET-Liste.
          if (item ? !item.canSee : snapshot && !seesItemContent(snapshot, snapshot.secretViewerIds.includes(user.id))) throw new LiveRefused('forbidden')
        }
        const currentRecords = await readRecords(tx, event.id, ids)
        if (!unchangedSince(after, currentRecords)) throw new LiveRefused('changed')
        await restoreRecords(tx, event.id, before.items, currentRecords)
        const marked = await tx.liveAction.updateMany({ where: { id: action.id, undoneAt: null }, data: { undoneAt: now, undoneById: user.id } })
        if (marked.count !== 1) throw new LiveRefused('undone')
        return { undone: true }
      }

      let type: LiveActionType
      let patches: LivePatch[]
      let meta: ActionMeta
      let created: { id: string } | null = null
      let removed: string | null = null

      if (command === 'swap') {
        const first = visible(formString(formData, 'itemId', 50))!
        const second = visible(formString(formData, 'otherId', 50))!
        // Planänderung mit Versionsprüfung: Wer einen veralteten Stand sieht, tauscht nicht.
        if (formString(formData, 'version', 10) !== String(first.version) || formString(formData, 'otherVersion', 10) !== String(second.version)) {
          throw new LiveRefused('stale')
        }
        const swap = swapAdjacent(items, first.id, second.id)
        if (!swap.ok) throw new LiveRefused(swap.reason === 'not-adjacent' ? 'stale' : swap.reason)
        type = 'swap'
        patches = swap.changes.map(change => ({ id: change.id, plannedStart: change.plannedStart, sortOrder: change.sortOrder }))
        meta = { ids: [first.id, second.id] }
      } else if (command === 'insert') {
        if (!mayAddRemove) throw new LiveRefused('forbidden')
        const trackId = formString(formData, 'trackId', 50)
        const title = cleanText(formString(formData, 'title', PLAN_LIMITS.titleMax * 2))
        const durationMin = formInt(formData, 'durationMin')
        const visibility = formString(formData, 'visibility', 10)
        if (!title || title.length > PLAN_LIMITS.titleMax || !(durationMin >= 1 && durationMin <= LIVE_LIMITS.maxInsertMin) || (visibility !== 'PUBLIC' && visibility !== 'TEAM')) {
          throw new LiveRefused('invalid')
        }
        const reference = liveReference(items, trackId)
        if (!reference) throw new LiveRefused('nothing-started')
        visible(reference.id)
        const fresh: Omit<ScheduleItem, 'trackId' | 'sortOrder' | 'plannedStart'> = {
          id: '__new__', plannedDurationMin: durationMin, isAnchor: false, mayStartEarly: false, status: 'PLANNED',
          actualStart: null, actualEnd: null, reportedDelayMin: null, waitsFor: []
        }
        const insert = insertAfter<ScheduleItem>(items, reference.id, fresh, now, event)
        if (!insert.ok) throw new LiveRefused(insert.reason)
        type = 'insert'
        patches = insert.changes.map(change => ({ id: change.id, sortOrder: change.sortOrder }))
        created = await tx.item.create({
          data: {
            eventId: event.id, trackId, title, visibility, plannedDurationMin: durationMin, insertedLive: true,
            plannedStart: insert.item.plannedStart, sortOrder: insert.item.sortOrder
          },
          select: { id: true }
        })
        meta = { ids: [created.id] }
      } else if (command === 'remove') {
        if (!mayAddRemove) throw new LiveRefused('forbidden')
        const item = visible(formString(formData, 'itemId', 50))!
        if (!item.insertedLive || isStarted(item)) throw new LiveRefused('not-inserted')
        type = 'remove'
        patches = []
        removed = item.id
        meta = { ids: [item.id] }
      } else {
        const itemId = formString(formData, 'itemId', 50)
        let live: LiveCommand
        switch (command) {
          case 'advance': {
            const from = formString(formData, 'fromId', 50) || null
            visible(from)
            live = { kind: 'advance', fromId: from, toId: visible(formString(formData, 'toId', 50))!.id }
            break
          }
          case 'start': case 'end':
            live = { kind: command, id: visible(itemId)!.id, minutesAgo: formInt(formData, 'minutesAgo') }
            break
          case 'delay':
            live = { kind: 'delay', id: visible(itemId)!.id, delayMin: formInt(formData, 'baseDelay') + formInt(formData, 'addMin') }
            break
          case 'cancel':
            live = { kind: 'cancel', id: visible(itemId)!.id, reason: cleanText(formString(formData, 'reason', LIVE_LIMITS.cancelReasonMax * 2)) || null }
            break
          default:
            live = { kind: command as 'ontime' | 'defer' | 'restore' | 'requeue', id: visible(itemId)!.id }
        }
        const result = applyLiveCommand(items, live, now, event)
        if (!result.ok) throw new LiveRefused(result.reason)
        type = live.kind
        patches = result.patches
        meta = live.kind === 'advance'
          ? { ids: [live.fromId, live.toId] }
          : { ids: [live.id], ...(live.kind === 'start' || live.kind === 'end' ? { minutesAgo: live.minutesAgo } : {}), ...(live.kind === 'delay' ? { delayMin: live.delayMin } : {}) }
      }

      // Vorher/Nachher aller betroffenen Punkte (bei Einschub und Entfernen mit Inhalt, damit Rückgängig exakt wird).
      const ids = [...new Set([...patches.map(p => p.id), ...(removed ? [removed] : []), ...(created ? [created.id] : [])])]
      const withContent = type === 'insert' || type === 'remove'
      const before = await readRecords(tx, event.id, ids, withContent)
      if (created) before[created.id] = null
      await applyPatches(tx, event.id, patches)
      if (removed) await tx.item.delete({ where: { id: removed } })
      const after = await readRecords(tx, event.id, ids, withContent)
      const actionId = await logAction(tx, {
        eventId: event.id, actorId: user.id, type, itemId: meta.ids.find(id => id !== null && id !== removed) ?? null,
        before: { items: before, meta }, after: { items: after, meta }
      })
      return { done: actionId }
    })
  } catch (error) {
    if (error instanceof LiveRefused) outcome = { error: error.reason }
    else throw error
  }

  if ('error' in outcome) back({ error: outcome.error })
  if ('undone' in outcome) back({ undone: '1' })
  if ('live' in outcome) back({ live: '1' })
  if ('ended' in outcome) back({ ended: '1' })
  back({ done: outcome.done })
}
