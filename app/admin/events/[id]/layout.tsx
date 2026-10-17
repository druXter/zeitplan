// app/admin/events/[id]/layout.tsx
import { requireUser } from '../../../lib/auth'
import { loadEventOr404 } from '../../../lib/events/store'
import { canManageEvent } from '../../../lib/permissions'
import { linkedRsvpEventId } from '../../../lib/rsvp/token'
import { linkedShiftsEventId } from '../../../lib/shifts/token'
import { formatDate } from '../../../lib/timezone'
import { Badge, ButtonLink, Main, PageHeader } from '../../../ui/kit'
import NavLink from '../../../ui/nav-link'
import StatusBadge from '../../../ui/status-badge'

const ACCESS_BADGES = { PUBLIC: null, CODE: 'Zugangscode', ACCOUNT: 'nur mit Konto', RSVP: 'nur mit Zusage' } as const

/**
 * Rahmen aller Seiten eines Events (docs/KONZEPT-OBERFLAECHE.md): Kopf mit Titel, Tag, Status und Merkmalen,
 * „Gästeansicht ↗“, darunter die Reiter (auf dem Handy seitlich scrollbar). Beim Drucken und eingebettet (Live-Steuerung
 * in der Sitzungsleitung des Abstimmungstools) ausgeblendet. Jede Seite prüft den Zugriff selbst noch einmal
 * (loadEventOr404) - das Layout allein schützt nichts.
 */
export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}`)
  const event = await loadEventOr404(id, user)
  const base = `/admin/events/${event.id}`
  const owner = canManageEvent(event.level)
  const tabs = [
    { href: base, label: 'Übersicht', exact: true },
    { href: `${base}/plan`, label: 'Ablauf', match: [`${base}/plan`, `${base}/items`, `${base}/was-waere-wenn`] },
    { href: `${base}/live`, label: 'Live' },
    { href: `${base}/team`, label: 'Team-Ansicht' },
    { href: `${base}/rueckblick`, label: 'Rückblick' },
    ...(owner ? [{ href: `${base}/einstellungen`, label: 'Einstellungen' }] : [])
  ]
  const access = ACCESS_BADGES[event.access]
  return (
    <Main>
      <div className="embed-hidden print:hidden">
        <PageHeader
          back={{ href: '/admin', label: 'Alle Events' }}
          title={event.title}
          subtitle={
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1">{formatDate(event.date, event.timezone)}</span>
              <StatusBadge status={event.status} />
              {!owner && <Badge tone="teal">für dich freigegeben</Badge>}
              {access && <Badge>{access}</Badge>}
              {linkedRsvpEventId(event.rsvpLink) && <Badge tone="pink">mit rsvp-app</Badge>}
              {linkedShiftsEventId(event.shiftsLink) && <Badge tone="purple">mit Schichten</Badge>}
            </div>
          }
          actions={<ButtonLink href={`/${event.slug}`} external size="sm">Gästeansicht ↗</ButtonLink>}
        />
        <nav className="-mx-4 mb-6 flex overflow-x-auto border-b border-gray-200 px-4 dark:border-gray-700" aria-label="Bereiche des Events">
          {tabs.map(tab => <NavLink key={tab.href} href={tab.href} exact={tab.exact} match={tab.match} variant="tab">{tab.label}</NavLink>)}
        </nav>
      </div>
      {children}
    </Main>
  )
}
