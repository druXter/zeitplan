import { redirect } from 'next/navigation'
import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { baseUrl } from '../../../../lib/base-url'
import { loadEventOr404 } from '../../../../lib/events/store'
import { canManageEvent } from '../../../../lib/permissions'
import { utcToZonedDate } from '../../../../lib/timezone'
import { accessCodeConfigured, suggestAccessCode } from '../../../../lib/guest/tokens'
import { linkedRsvpEventId, rsvpConfigured, timelineLinkFor } from '../../../../lib/rsvp/token'
import { linkedShiftsEventId, shiftsConfigured, shiftsLinkUrl, shiftsOrigin } from '../../../../lib/shifts/token'
import { deleteEvent, shareEvent, unshareEvent } from '../../actions'
import { EventOptionsForm, EventSettingsForm, GuestAccessForm, ShiftsLinkForm } from '../../event-forms'
import { buttonClass, Card, inputClass, SettingsSection, ConfirmForm, Notice } from '../../../../ui/kit'

export const dynamic = 'force-dynamic'

type Search = { abschnitt?: string; shared?: string; unshared?: string; shareError?: string }

const ACCESS_SUMMARY = { PUBLIC: 'jede*r mit Link', CODE: 'mit Zugangscode', ACCOUNT: 'nur mit Konto', RSVP: 'nur mit Zusage in rsvp-app' } as const

/**
 * Einstellungen in einklappbaren Abschnitten mit Kurzstand (docs/KONZEPT-OBERFLAECHE.md): Event · Zugang für Gäste ·
 * Prognose, Anzeige und Rechte · Schichten · Freigaben; darunter Löschen. Jeder Abschnitt speichert für sich,
 * `?abschnitt=<id>` öffnet einen. Nur owner.
 */
export default async function EventSettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/einstellungen`)
  const event = await loadEventOr404(id, user)
  if (!canManageEvent(event.level)) redirect(`/admin/events/${event.id}`)
  const search = await searchParams
  const open = (section: string) => search.abschnitt === section

  const [shares, series, activeGuestSessions] = await Promise.all([
    prisma.eventAccess.findMany({ where: { eventId: event.id }, include: { user: { select: { email: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.series.findMany({
      where: user.role === 'ADMIN' ? {} : { OR: [{ ownerId: user.id }, ...(event.seriesId ? [{ id: event.seriesId }] : [])] },
      orderBy: { title: 'asc' },
      select: { id: true, title: true }
    }),
    prisma.guestSession.count({ where: { eventId: event.id, expiresAt: { gt: new Date() } } })
  ])
  const rights = [event.modsMayEditPlan && 'planen', event.modsMayInsert && 'Einschübe'].filter(Boolean).join(', ')
  const shiftsEventId = linkedShiftsEventId(event.shiftsLink)

  return (
    <div className="space-y-3">
      <SettingsSection id="event" title="Event" summary={`/${event.slug}`} open={open('event')}>
        <EventSettingsForm
          eventId={event.id}
          baseUrl={baseUrl()}
          values={{ title: event.title, slug: event.slug, date: utcToZonedDate(event.date, event.timezone), description: event.description }}
          series={series}
          seriesId={event.seriesId}
        />
      </SettingsSection>

      <SettingsSection id="zugang" title="Zugang für Gäste" summary={ACCESS_SUMMARY[event.access]} open={open('zugang')}>
        <GuestAccessForm
          eventId={event.id}
          access={event.access}
          hasCode={event.accessCodeHmac !== null}
          suggestion={suggestAccessCode()}
          codeConfigured={accessCodeConfigured()}
          activeSessions={activeGuestSessions}
          rsvp={{ configured: rsvpConfigured(), rsvpEventId: linkedRsvpEventId(event.rsvpLink) ?? '', timelineLink: timelineLinkFor(event.id) }}
        />
      </SettingsSection>

      <SettingsSection id="ablauf" title="Prognose, Anzeige und Rechte" summary={`Moderator*innen: ${rights || 'nur live'}`} open={open('ablauf')}>
        <EventOptionsForm
          eventId={event.id}
          modsMayEditPlan={event.modsMayEditPlan}
          modsMayInsert={event.modsMayInsert}
          options={{
            autoCreep: event.autoCreep, creepNudgeMin: event.creepNudgeMin, creepCapMin: event.creepCapMin,
            guestRoundingMin: event.guestRoundingMin, hysteresisMin: event.hysteresisMin,
            showDelayToGuests: event.showDelayToGuests, guestHorizonMin: event.guestHorizonMin
          }}
        />
      </SettingsSection>

      {shiftsConfigured() && (
        <SettingsSection id="schichten" title="Schichten" summary={shiftsEventId ? 'verknüpft' : 'aus'} marker="purple" open={open('schichten')}
          description="Helfer*innen-Schichten in Schichten können Programmpunkten folgen und verschieben sich mit, wenn sich ein Punkt verspätet.">
          <ShiftsLinkForm eventId={event.id} origin={shiftsOrigin()!} shiftsUrl={shiftsEventId ? shiftsLinkUrl(shiftsEventId) ?? '' : ''} />
        </SettingsSection>
      )}

      <SettingsSection id="freigaben" title="Freigaben" summary={shares.length === 0 ? 'keine' : shares.length === 1 ? '1 Konto' : `${shares.length} Konten`} marker="teal"
        open={open('freigaben') || search.shared !== undefined || search.unshared !== undefined || search.shareError !== undefined}
        description="Freigegebene Konten (z. B. Moderator*innen) sehen das Event mit internen Notizen und steuern den Ablauf live. Den Plan bearbeiten sie nur, wenn du es unter „Prognose, Anzeige und Rechte“ erlaubst. Einstellungen ändern, löschen und weiter freigeben können sie nicht.">
        {search.shared === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
        {search.unshared === '1' && <Notice tone="success">Freigabe entfernt.</Notice>}
        {search.shareError === 'notfound' && <Notice tone="error">Zu dieser Adresse gibt es kein Konto. Lade die Person zuerst unter „Konten“ ein.</Notice>}
        {search.shareError === 'owner' && <Notice tone="error">Diesem Konto gehört das Event bereits.</Notice>}
        {shares.length > 0 && (
          <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
            {shares.map(share => (
              <li key={share.id} className="flex items-center justify-between gap-2 py-2">
                <span className="truncate">{share.user.email}</span>
                <form action={unshareEvent}>
                  <input type="hidden" name="accessId" value={share.id} />
                  <button type="submit" className={buttonClass('danger', 'sm')}>Entfernen</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={shareEvent} className="flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="eventId" value={event.id} />
          <label htmlFor="share-email" className="sr-only">E-Mail-Adresse des Kontos</label>
          <input id="share-email" name="email" type="email" required placeholder="E-Mail-Adresse des Kontos" className={`${inputClass} sm:flex-1`} />
          <button type="submit" className={buttonClass('primary')}>Freigeben</button>
        </form>
      </SettingsSection>

      <Card className="space-y-3">
        <h2 className="font-semibold">Event löschen</h2>
        <p className="text-xs text-gray-600 dark:text-gray-400">Löscht das Event mit Ablauf und allen Freigaben endgültig.</p>
        <ConfirmForm action={deleteEvent} message={`Event „${event.title}“ endgültig löschen?`}>
          <input type="hidden" name="eventId" value={event.id} />
          <button type="submit" className={buttonClass('danger')}>Event löschen</button>
        </ConfirmForm>
      </Card>
    </div>
  )
}
