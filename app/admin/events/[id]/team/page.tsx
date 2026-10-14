import Link from 'next/link'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { formatDuration, formatItemClock } from '../../../../lib/timezone'
import { currentAnnouncement } from '../../../../lib/guest/announcement'
import { loadTeamView } from '../../../../lib/team/view'
import AutoRefresh from '../../../../ui/auto-refresh'
import StatusBadge from '../../../../ui/status-badge'
import TeamTimeline from '../../../../ui/team-timeline'
import { prisma } from '../../../../lib/prisma'
import { vapidPublicKey } from '../../../../lib/push'
import AlertSettings from '../../alert-settings'

export const dynamic = 'force-dynamic'

/**
 * Team-Ansicht (docs/KONZEPT.md Abschnitt 5), nur lesen: wie die Gästeansicht, aber mit Team-Punkten, geheimen
 * Punkten (Inhalt nur mit Eintrag, sonst "Geheimer Punkt" mit Zeit und Dauer), internen Notizen, Konflikten,
 * Zuständigen und minutengenauer Prognose (app/ui/team-timeline.tsx, gemeinsam mit dem Team-Link). Oben "Meine
 * Punkte" (Idee L16), ?meine=1 zeigt nur die eigenen. Lädt sich alle 30 s selbst neu. Mit VAPID-Schlüsseln dazu die
 * Vorwarnung per Push (Idee L17, app/admin/events/alert-settings.tsx).
 */
export default async function TeamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meine?: string; alert?: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/team`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const mineOnly = search.meine === '1'
  const now = new Date()
  const pushKey = vapidPublicKey()
  const [view, alertSetting] = await Promise.all([
    loadTeamView(event, { kind: 'account', userId: user.id }, now),
    pushKey ? prisma.alertSetting.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } }, select: { scope: true, leadMin: true } }) : null
  ])
  const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)
  const hasMine = view.items.some(item => item.assigneeIds.includes(user.id))
  const link = 'text-blue-700 dark:text-blue-300 hover:underline'

  return (
    <main className="bg-gray-50 dark:bg-gray-900 py-6 px-4">
      <AutoRefresh />
      <div className="max-w-3xl mx-auto space-y-4 text-gray-900 dark:text-gray-100">
        <div className="space-y-1">
          <p className="text-sm"><Link href={`/admin/events/${event.id}`} className={link}>{event.title}</Link></p>
          <h1 className="text-2xl font-bold">{mineOnly ? 'Meine Punkte' : 'Team-Ansicht'} <StatusBadge status={event.status} /></h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Stand {clock(now)} Uhr, minutengenau{view.lastActionAt ? `, letzte Meldung vor ${formatDuration(Math.max(0, Math.round((now.getTime() - view.lastActionAt.getTime()) / 60_000)))}` : ''}.
            Aktualisiert sich alle 30 Sekunden.{' '}
            <Link href={`/admin/events/${event.id}/live`} className={link}>Live-Steuerung</Link>{' · '}
            <Link href={`/admin/events/${event.id}/plan`} className={link}>Planung</Link>{' · '}
            <Link href={`/${event.slug}`} className={link}>Gästeansicht</Link>{' · '}
            <Link href={`/${event.slug}/tafel`} className={link}>Tafel</Link>{' · '}
            <Link href={`/admin/events/${event.id}/rueckblick`} className={link}>Rückblick</Link>{' · '}
            <Link href={`/admin/events/${event.id}/druck`} className={link}>Drucken</Link>
          </p>
          {(hasMine || mineOnly) && (
            <p className="text-sm">
              {mineOnly
                ? <Link href={`/admin/events/${event.id}/team`} className={link}>Alle Punkte zeigen</Link>
                : <Link href={`/admin/events/${event.id}/team?meine=1`} className={link}>Nur meine Punkte zeigen</Link>}
            </p>
          )}
        </div>
        {pushKey && <AlertSettings eventId={event.id} setting={alertSetting} publicKey={pushKey} mineOnly={mineOnly} notice={search.alert} />}
        <TeamTimeline view={view} event={event} now={now} announcement={currentAnnouncement(event, now)} meId={user.id} mineOnly={mineOnly} />
      </div>
    </main>
  )
}
