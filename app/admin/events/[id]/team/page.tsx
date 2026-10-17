import Link from 'next/link'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { formatDuration, formatItemClock } from '../../../../lib/timezone'
import { currentAnnouncement } from '../../../../lib/guest/announcement'
import { loadTeamView } from '../../../../lib/team/view'
import AutoRefresh from '../../../../ui/auto-refresh'
import { ButtonLink } from '../../../../ui/kit'
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
  const base = `/admin/events/${event.id}`

  return (
    <div className="max-w-3xl space-y-4">
      <AutoRefresh />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{mineOnly ? 'Meine Punkte' : 'Team-Ansicht'}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Stand {clock(now)} Uhr, minutengenau{view.lastActionAt ? `, letzte Meldung vor ${formatDuration(Math.max(0, Math.round((now.getTime() - view.lastActionAt.getTime()) / 60_000)))}` : ''}.
            Aktualisiert sich alle 30 Sekunden.
          </p>
          {(hasMine || mineOnly) && (
            <p className="text-sm">
              {mineOnly
                ? <Link href={`${base}/team`} className={link}>Alle Punkte zeigen</Link>
                : <Link href={`${base}/team?meine=1`} className={link}>Nur meine Punkte zeigen</Link>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ButtonLink href={`/${event.slug}/tafel`} size="sm">Tafel</ButtonLink>
          <ButtonLink href={`${base}/druck`} size="sm">Drucken</ButtonLink>
        </div>
      </div>
      {pushKey && <AlertSettings eventId={event.id} setting={alertSetting} publicKey={pushKey} mineOnly={mineOnly} notice={search.alert} />}
      <TeamTimeline view={view} event={event} now={now} announcement={currentAnnouncement(event, now)} meId={user.id} mineOnly={mineOnly} />
    </div>
  )
}
