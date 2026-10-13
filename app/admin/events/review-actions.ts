'use server'

import { redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { formString } from '../../lib/form'
import { loadEventForUser } from '../../lib/events/store'
import { cleanText, PLAN_LIMITS } from '../../lib/planning/rules'
import { loadPlan } from '../../lib/planning/store'

/**
 * Protokollnotiz eines Punkts speichern (Idee L24) - aus dem Rückblick oder live beim laufenden Punkt, z. B. das
 * Ergebnis eines Tagesordnungspunkts. Wie die Live-Aktionen für alle Konten mit Zugriff aufs Event, bei geheimen
 * Punkten nur für Eingetragene (loadPlan → canSee). Kein Teil des Plans: ändert weder Item.version noch
 * liveVersion (Gäste sehen die Notiz nie). Gleichzeitiges Schreiben: Das Formular schickt die Notiz mit, die es
 * angezeigt hat; hat sie inzwischen jemand anderes geändert, wird abgelehnt statt überschrieben.
 */
export async function saveResultNote(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')
  const itemId = formString(formData, 'itemId', 50)
  const fromLive = formString(formData, 'from', 10) === 'live'
  const track = formString(formData, 'track', 50)
  const back = (params: Record<string, string>): never => {
    if (fromLive) redirect(`/admin/events/${event.id}/live?${new URLSearchParams({ ...(track ? { track } : {}), ...params })}`)
    redirect(`/admin/events/${event.id}/rueckblick?${new URLSearchParams(params)}#item-${itemId}`)
  }

  const note = cleanText(formString(formData, 'note', PLAN_LIMITS.noteMax * 2), true)
  if (note.length > PLAN_LIMITS.noteMax) back({ noteError: 'long' })
  const previous = cleanText(formString(formData, 'previous', PLAN_LIMITS.noteMax * 2), true)

  const result = await prisma.$transaction(async tx => {
    const { items } = await loadPlan(event.id, user.id, tx)
    const item = items.find(i => i.id === itemId)
    if (!item || !item.canSee) return 'forbidden'
    const current = await tx.item.findUniqueOrThrow({ where: { id: item.id }, select: { resultNote: true } })
    if ((current.resultNote ?? '') !== previous) return 'changed'
    await tx.item.update({ where: { id: item.id }, data: { resultNote: note || null } })
    return 'ok'
  })
  back(result === 'ok' ? { noted: '1' } : { noteError: result })
}
