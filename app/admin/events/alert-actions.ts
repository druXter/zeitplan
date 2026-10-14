'use server'

import { redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { formString } from '../../lib/form'
import { loadEventForUser } from '../../lib/events/store'
import { ALERT_LEAD_OPTIONS } from '../../lib/alerts/due'

/**
 * Vorwarnung fürs Team einstellen (Idee L17): jedes Konto mit Zugriff aufs Event für sich selbst - aus, für die eigenen
 * Punkte oder für alle, mit Vorlauf aus ALERT_LEAD_OPTIONS. Ob das Gerät Mitteilungen bekommt, entscheidet der
 * Schalter "auf diesem Gerät" (app/ui/push-toggle.tsx) - die Einstellung gilt für alle Geräte des Kontos.
 */
export async function saveAlertSetting(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')
  const scope = formString(formData, 'scope', 10)
  const lead = Number(formString(formData, 'leadMin', 4))
  const back = `/admin/events/${event.id}/team${formString(formData, 'mine', 2) === '1' ? '?meine=1&' : '?'}`

  if (scope === 'OFF') {
    await prisma.alertSetting.deleteMany({ where: { eventId: event.id, userId: user.id } })
    redirect(`${back}alert=off#vorwarnung`)
  }
  if ((scope !== 'MINE' && scope !== 'ALL') || !(ALERT_LEAD_OPTIONS as readonly number[]).includes(lead)) redirect(`${back}alert=invalid#vorwarnung`)
  await prisma.alertSetting.upsert({
    where: { eventId_userId: { eventId: event.id, userId: user.id } },
    update: { scope, leadMin: lead },
    create: { eventId: event.id, userId: user.id, scope, leadMin: lead }
  })
  redirect(`${back}alert=saved#vorwarnung`)
}
