// app/admin/events/[id]/page.tsx
import Link from 'next/link'
import { prisma } from '../../../lib/prisma'
import { requireUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { loadEventOr404 } from '../../../lib/events/store'
import { formatDate, utcToZonedDate } from '../../../lib/timezone'
import { deleteEvent, shareEvent, unshareEvent } from '../actions'
import { EventSettingsForm } from '../event-forms'
import ConfirmForm from '../../../ui/confirm-form'
import CopyableField from '../../../ui/copyable-field'
import StatusBadge from '../../../ui/status-badge'
import Notice from '../../../ui/notice'

export const dynamic = 'force-dynamic'

type Search = { created?: string; shared?: string; unshared?: string; shareError?: string }

/**
 * Übersicht eines Events. owner (Besitzer*in, Admin) sieht Einstellungen, Freigaben und Löschen;
 * freigegebene Konten sehen nur die Übersicht - Planung, Team-Ansicht und Live-Steuerung kommen mit
 * Phase 2 bis 4 hierher.
 */
export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const isOwner = event.level === 'owner'

  const shares = isOwner
    ? await prisma.eventAccess.findMany({ where: { eventId: event.id }, include: { user: { select: { email: true } } }, orderBy: { createdAt: 'asc' } })
    : []

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-3xl mx-auto space-y-4 text-gray-900">
        <div className="space-y-1">
          <p className="text-sm"><Link href="/admin/events" className="text-blue-700 hover:underline">Alle Events</Link></p>
          <h1 className="text-2xl font-bold">{event.title} <StatusBadge status={event.status} /></h1>
          <p className="text-sm text-gray-600">{formatDate(event.date, event.timezone)}</p>
        </div>

        {search.created === '1' && <Notice tone="success">Event angelegt. Es ist noch ein Entwurf.</Notice>}
        {search.shared === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
        {search.unshared === '1' && <Notice tone="success">Freigabe entfernt.</Notice>}
        {search.shareError === 'notfound' && <Notice tone="error">Zu dieser Adresse gibt es kein Konto. Lade die Person zuerst unter „Nutzer*innen“ ein.</Notice>}
        {search.shareError === 'owner' && <Notice tone="error">Diesem Konto gehört das Event bereits.</Notice>}

        <div className="bg-white rounded-lg shadow p-4 space-y-2">
          <CopyableField label="Link für Gäste" value={`${baseUrl()}/${event.slug}`} />
          <p className="text-xs text-gray-600">Die Gästeansicht mit dem Ablauf folgt in einer späteren Ausbaustufe.</p>
        </div>

        {isOwner ? (
          <>
            <div className="bg-white rounded-lg shadow p-4 space-y-3">
              <h2 className="font-bold">Einstellungen</h2>
              <EventSettingsForm
                eventId={event.id}
                baseUrl={baseUrl()}
                values={{ title: event.title, slug: event.slug, date: utcToZonedDate(event.date, event.timezone), description: event.description }}
              />
            </div>

            <div className="bg-white rounded-lg shadow p-4 space-y-3">
              <h2 className="font-bold">Freigaben</h2>
              <p className="text-xs text-gray-600">
                Freigegebene Konten (z. B. Moderator*innen) sehen das Event und steuern später den Ablauf live. Die
                Einstellungen ändern, löschen und weiter freigeben können sie nicht.
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
              <p className="text-xs text-gray-600">Löscht das Event mit allen Freigaben endgültig.</p>
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
              Dieses Event wurde für dich freigegeben. Hier findest du später den Ablauf mit den internen Notizen und die
              Live-Steuerung.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
