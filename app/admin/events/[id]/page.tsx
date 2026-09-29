import Link from 'next/link'
import { prisma } from '../../../lib/prisma'
import { requireUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { loadEventOr404 } from '../../../lib/events/store'
import { canAddRemoveItems, canCreateEvents, canEditPlan, canManageEvent } from '../../../lib/permissions'
import { allowedStatusChanges, STATUS_LABELS } from '../../../lib/events/settings'
import { isGuestVisibleStatus } from '../../../lib/guest/access'
import { formatDate, utcToZonedDate } from '../../../lib/timezone'
import { accessCodeConfigured, displayLinkConfigured, displayToken, suggestAccessCode } from '../../../lib/guest/tokens'
import { changeEventStatus, deleteEvent, regenerateDisplayLink, shareEvent, unshareEvent } from '../actions'
import { EventOptionsForm, EventSettingsForm, GuestAccessForm } from '../event-forms'
import ConfirmForm from '../../../ui/confirm-form'
import CopyableField from '../../../ui/copyable-field'
import StatusBadge from '../../../ui/status-badge'
import Notice from '../../../ui/notice'

export const dynamic = 'force-dynamic'

type Search = { created?: string; imported?: string; duplicated?: string; status?: string; shared?: string; unshared?: string; shareError?: string; display?: string }

const ACCESS_LABELS = { PUBLIC: 'jede*r mit Link', CODE: 'nur mit Zugangscode', ACCOUNT: 'nur mit Konto', RSVP: 'nur mit Zusage in rsvp-app' } as const

const STATUS_ACTIONS: Record<string, string> = {
  PUBLISHED: 'Veröffentlichen',
  DRAFT: 'Zurück zum Entwurf',
  ARCHIVED: 'Archivieren'
}

/**
 * Übersicht eines Events. owner (Besitzer*in, Admin) sieht Status, Einstellungen, Zugang der Gäste, Rechte der
 * Moderator*innen, Freigaben und Löschen; freigegebene Konten den Weg zum Ablauf und ihre Rechte. Für alle: Links
 * zu Team-Ansicht, Live-Steuerung, Gästeansicht, Tafel (bei geschütztem Zugang mit Tafel-Link) und QR-Code.
 */
export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const isOwner = canManageEvent(event.level)

  const [shares, series, itemCount, activeGuestSessions] = await Promise.all([
    isOwner
      ? prisma.eventAccess.findMany({ where: { eventId: event.id }, include: { user: { select: { email: true } } }, orderBy: { createdAt: 'asc' } })
      : Promise.resolve([]),
    isOwner
      ? prisma.series.findMany({
          where: user.role === 'ADMIN' ? {} : { OR: [{ ownerId: user.id }, ...(event.seriesId ? [{ id: event.seriesId }] : [])] },
          orderBy: { title: 'asc' },
          select: { id: true, title: true }
        })
      : Promise.resolve([]),
    prisma.item.count({ where: { eventId: event.id } }),
    isOwner ? prisma.guestSession.count({ where: { eventId: event.id, expiresAt: { gt: new Date() } } }) : Promise.resolve(0)
  ])

  // Tafel-Link: bei geschütztem Zugang per HMAC abgeleitet (für den Fernseher, an dem sich niemand anmeldet).
  const protectedAccess = event.access !== 'PUBLIC'
  const boardLink = protectedAccess && displayLinkConfigured()
    ? `${baseUrl()}/${event.slug}/tafel?k=${displayToken(event.id, event.displayTokenVersion)}`
    : `${baseUrl()}/${event.slug}/tafel`

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-3xl mx-auto space-y-4 text-gray-900">
        <div className="space-y-1">
          <p className="text-sm"><Link href="/admin/events" className="text-blue-700 hover:underline">Alle Events</Link></p>
          <h1 className="text-2xl font-bold">{event.title} <StatusBadge status={event.status} /></h1>
          <p className="text-sm text-gray-600">{formatDate(event.date, event.timezone)}</p>
        </div>

        {search.created === '1' && <Notice tone="success">Event angelegt. Es ist noch ein Entwurf.</Notice>}
        {search.imported === '1' && <Notice tone="success">Ablauf importiert. Das neue Event ist noch ein Entwurf.</Notice>}
        {search.duplicated === '1' && <Notice tone="success">Kopie angelegt. Sie ist noch ein Entwurf.</Notice>}
        {search.status === '1' && <Notice tone="success">Status geändert.</Notice>}
        {search.shared === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
        {search.unshared === '1' && <Notice tone="success">Freigabe entfernt.</Notice>}
        {search.shareError === 'notfound' && <Notice tone="error">Zu dieser Adresse gibt es kein Konto. Lade die Person zuerst unter „Nutzer*innen“ ein.</Notice>}
        {search.shareError === 'owner' && <Notice tone="error">Diesem Konto gehört das Event bereits.</Notice>}
        {search.display === '1' && <Notice tone="success">Neuer Tafel-Link erzeugt. Der bisherige funktioniert nicht mehr.</Notice>}

        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <h2 className="font-bold">Ablauf</h2>
          <p className="text-sm text-gray-700">
            {itemCount === 1 ? '1 Programmpunkt' : `${itemCount} Programmpunkte`}.{' '}
            {canEditPlan(event.level, event) ? 'Du kannst den Plan bearbeiten.' : 'Du kannst den Plan ansehen.'}
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={`/admin/events/${event.id}/plan`} className="bg-blue-600 text-white font-bold py-2 px-3 rounded hover:bg-blue-700">Ablauf planen</Link>
            <a href={`/admin/events/${event.id}/export`} className="py-2 px-3 rounded border border-gray-300 hover:bg-gray-50">Export (JSON)</a>
            {canCreateEvents(user) && (
              <Link href={`/admin/events/${event.id}/duplicate`} className="py-2 px-3 rounded border border-gray-300 hover:bg-gray-50">Duplizieren</Link>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <h2 className="font-bold">Ansichten</h2>
          <CopyableField label="Link für Gäste" value={`${baseUrl()}/${event.slug}`} />
          <CopyableField label="Link für die Anzeigetafel (Beamer, TV)" value={boardLink} />
          {protectedAccess && (
            displayLinkConfigured() ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span>Der Tafel-Link enthält einen Schlüssel und zeigt den Ablauf ohne Anmeldung – gib ihn nur für die Geräte vor Ort weiter.</span>
                {isOwner && (
                  <ConfirmForm action={regenerateDisplayLink} message="Neuen Tafel-Link erzeugen? Der bisherige funktioniert danach nicht mehr.">
                    <input type="hidden" name="eventId" value={event.id} />
                    <button type="submit" className="text-blue-700 hover:underline">Neuen Tafel-Link erzeugen</button>
                  </ConfirmForm>
                )}
              </div>
            ) : (
              <p className="text-xs text-amber-900">Auf dem Server fehlt <code>DISPLAY_LINK_SECRET</code> – ohne ihn zeigt die Tafel bei geschütztem Zugang nichts (siehe README).</p>
            )
          )}
          <p className="text-xs text-gray-600">
            {isGuestVisibleStatus(event.status)
              ? `Gäste (${ACCESS_LABELS[event.access]}) sehen den öffentlichen Ablauf mit der aktuellen Prognose; die Seite aktualisiert sich selbst.`
              : 'Gäste sehen den Ablauf erst, wenn das Event veröffentlicht ist. Bis dahin siehst nur du (und wer Zugriff hat) eine Vorschau.'}
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={`/admin/events/${event.id}/live`} className="bg-blue-600 text-white font-bold py-2 px-3 rounded hover:bg-blue-700">Live-Steuerung</Link>
            <Link href={`/admin/events/${event.id}/team`} className="py-2 px-3 rounded border border-gray-300 hover:bg-gray-50">Team-Ansicht</Link>
            <Link href={`/${event.slug}`} className="py-2 px-3 rounded border border-gray-300 hover:bg-gray-50">Gästeansicht</Link>
            <Link href={`/${event.slug}/tafel`} className="py-2 px-3 rounded border border-gray-300 hover:bg-gray-50">Tafel</Link>
            <Link href={`/admin/events/${event.id}/qr`} className="py-2 px-3 rounded border border-gray-300 hover:bg-gray-50">QR-Code zum Ausdrucken</Link>
          </div>
        </div>

        {isOwner ? (
          <>
            <div className="bg-white rounded-lg shadow p-4 space-y-3">
              <h2 className="font-bold">Status: {STATUS_LABELS[event.status]}</h2>
              <p className="text-xs text-gray-600">
                Entwürfe und archivierte Events sehen nur Konten mit Zugriff. Veröffentlichte Events zeigen den Ablauf allen
                Gästen mit Zugang (siehe unten). Live schalten und beenden geht in der Live-Steuerung (auch für Moderator*innen); einige Stunden
                nach dem letzten Punkt endet das Event automatisch.
              </p>
              <div className="flex flex-wrap gap-2">
                {allowedStatusChanges(event.status).map(target => (
                  <form key={target} action={changeEventStatus}>
                    <input type="hidden" name="eventId" value={event.id} />
                    <input type="hidden" name="status" value={target} />
                    <button type="submit" className="text-sm py-2 px-3 rounded border border-gray-300 hover:bg-gray-50">{STATUS_ACTIONS[target]}</button>
                  </form>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4 space-y-3">
              <h2 className="font-bold">Einstellungen</h2>
              <EventSettingsForm
                eventId={event.id}
                baseUrl={baseUrl()}
                values={{ title: event.title, slug: event.slug, date: utcToZonedDate(event.date, event.timezone), description: event.description }}
                series={series}
                seriesId={event.seriesId}
              />
            </div>

            <div className="bg-white rounded-lg shadow p-4 space-y-3">
              <h2 className="font-bold">Zugang für Gäste</h2>
              <GuestAccessForm
                eventId={event.id}
                access={event.access}
                hasCode={event.accessCodeHmac !== null}
                suggestion={suggestAccessCode()}
                codeConfigured={accessCodeConfigured()}
                activeSessions={activeGuestSessions}
              />
            </div>

            <div className="bg-white rounded-lg shadow p-4 space-y-3">
              <h2 className="font-bold">Ablauf und Gäste</h2>
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
            </div>

            <div className="bg-white rounded-lg shadow p-4 space-y-3">
              <h2 className="font-bold">Freigaben</h2>
              <p className="text-xs text-gray-600">
                Freigegebene Konten (z. B. Moderator*innen) sehen das Event mit internen Notizen und steuern später den
                Ablauf live. Den Plan bearbeiten sie nur, wenn du es oben erlaubst. Einstellungen ändern, löschen und
                weiter freigeben können sie nicht.
              </p>
              {shares.length > 0 && (
                <ul className="text-sm divide-y">
                  {shares.map(share => (
                    <li key={share.id} className="py-1 flex items-center justify-between gap-2">
                      <span className="truncate">{share.user.email}</span>
                      <form action={unshareEvent}>
                        <input type="hidden" name="accessId" value={share.id} />
                        <button type="submit" className="text-xs text-red-700 hover:underline">Entfernen</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form action={shareEvent} className="flex flex-wrap gap-2">
                <input type="hidden" name="eventId" value={event.id} />
                <label htmlFor="share-email" className="sr-only">E-Mail-Adresse des Kontos</label>
                <input id="share-email" name="email" type="email" required placeholder="E-Mail-Adresse des Kontos" className="grow min-w-0 border border-gray-300 p-2 rounded text-sm" />
                <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-3 rounded hover:bg-blue-700 text-sm">Freigeben</button>
              </form>
            </div>

            <div className="bg-white rounded-lg shadow p-4 space-y-2">
              <h2 className="font-bold">Event löschen</h2>
              <p className="text-xs text-gray-600">Löscht das Event mit Ablauf und allen Freigaben endgültig.</p>
              <ConfirmForm action={deleteEvent} message={`Event „${event.title}“ endgültig löschen?`}>
                <input type="hidden" name="eventId" value={event.id} />
                <button type="submit" className="text-sm text-red-700 hover:underline">Event löschen</button>
              </ConfirmForm>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-lg shadow p-4 space-y-2">
            <h2 className="font-bold">Freigegeben für dich</h2>
            <p className="text-sm text-gray-700">
              Dieses Event wurde für dich freigegeben. In der Live-Steuerung meldest du Beginn, Ende, Verspätungen und
              Änderungen; die Team-Ansicht zeigt den Ablauf mit Prognose und internen Notizen.
            </p>
            <ul className="text-sm list-disc list-inside text-gray-700">
              <li>Plan bearbeiten: {event.modsMayEditPlan ? 'erlaubt' : 'nicht erlaubt'}</li>
              <li>Einschübe und Löschen während des Events: {event.modsMayInsert ? 'erlaubt' : 'nicht erlaubt'}</li>
            </ul>
            {!canAddRemoveItems(event.level, event) && event.modsMayEditPlan && event.status === 'LIVE' && (
              <p className="text-xs text-gray-600">Solange das Event live ist, legst du keine Punkte an und löschst keine.</p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
