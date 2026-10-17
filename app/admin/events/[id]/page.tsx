import Link from 'next/link'
import { requireUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { loadEventOr404 } from '../../../lib/events/store'
import { canAddRemoveItems, canCreateEvents, canEditPlan, canManageEvent } from '../../../lib/permissions'
import { allowedStatusChanges, STATUS_LABELS } from '../../../lib/events/settings'
import { isGuestVisibleStatus } from '../../../lib/guest/access'
import { loadPlan } from '../../../lib/planning/store'
import { formatItemClock } from '../../../lib/timezone'
import { crewToken, displayLinkConfigured, displayToken } from '../../../lib/guest/tokens'
import { changeEventStatus, regenerateDisplayLink, setCrewLink } from '../actions'
import ConfirmForm from '../../../ui/confirm-form'
import CopyableField from '../../../ui/copyable-field'
import { ButtonLink, buttonClass, Card, Stat } from '../../../ui/kit'
import Notice from '../../../ui/notice'

export const dynamic = 'force-dynamic'

type Search = { created?: string; imported?: string; duplicated?: string; status?: string; display?: string; crew?: string }

const ACCESS_LABELS = { PUBLIC: 'jede*r mit Link', CODE: 'nur mit Zugangscode', ACCOUNT: 'nur mit Konto', RSVP: 'nur mit Zusage in rsvp-app' } as const

const STATUS_ACTIONS: Record<string, string> = {
  PUBLISHED: 'Veröffentlichen',
  DRAFT: 'Zurück zum Entwurf',
  ARCHIVED: 'Archivieren'
}

const STATUS_HINTS: Record<string, string> = {
  DRAFT: 'Gäste sehen den Ablauf erst, wenn das Event veröffentlicht ist. Bis dahin siehst nur du (und wer Zugriff hat) eine Vorschau.',
  PUBLISHED: 'Gäste sehen den geplanten Ablauf. Am Tag selbst schaltest du in der Live-Steuerung live; ab dann zeigt die Seite die Prognose.',
  LIVE: 'Das Event läuft. Gäste und Tafel zeigen die aktuelle Prognose und aktualisieren sich selbst.',
  ENDED: 'Das Event ist vorbei. Gäste sehen den Ablauf als Rückblick.',
  ARCHIVED: 'Archiviert – nur Konten mit Zugriff sehen das Event.'
}

/**
 * Übersicht eines Events (docs/KONZEPT-OBERFLAECHE.md): Kennzahlen des Plans, Status mit den nächsten Schritten,
 * Links für Gäste, Anzeigetafel und Dienstleister (Team-Link) sowie Drucken, Was wäre wenn, Export und Duplizieren.
 * Einstellungen, Zugang und Freigaben stehen unter „Einstellungen“ (nur owner); freigegebene Konten sehen hier ihre
 * Rechte.
 */
export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const isOwner = canManageEvent(event.level)
  const base = `/admin/events/${event.id}`

  // Kennzahlen aus dem Plan - loadPlan liefert auch geheime Punkte nur mit Zeit und Dauer, hier genügt das.
  const { tracks, items } = await loadPlan(event.id, user.id)
  const active = items.filter(item => item.status !== 'CANCELLED')
  const first = active.length ? new Date(Math.min(...active.map(item => item.plannedStart.getTime()))) : null
  const last = active.length ? new Date(Math.max(...active.map(item => item.plannedStart.getTime() + item.plannedDurationMin * 60_000))) : null
  const clock = (date: Date) => formatItemClock(date, event.date, event.timezone)
  const anchors = active.filter(item => item.isAnchor).length

  // Tafel-Link: bei geschütztem Zugang per HMAC abgeleitet (für den Fernseher, an dem sich niemand anmeldet).
  const protectedAccess = event.access !== 'PUBLIC'
  const boardLink = protectedAccess && displayLinkConfigured()
    ? `${baseUrl()}/${event.slug}/tafel?k=${displayToken(event.id, event.displayTokenVersion)}`
    : `${baseUrl()}/${event.slug}/tafel`
  const liveReady = event.status === 'PUBLISHED' || event.status === 'LIVE'

  return (
    <div className="space-y-6">
      {search.created === '1' && <Notice tone="success">Event angelegt. Es ist noch ein Entwurf.</Notice>}
      {search.imported === '1' && <Notice tone="success">Ablauf importiert. Das neue Event ist noch ein Entwurf.</Notice>}
      {search.duplicated === '1' && <Notice tone="success">Kopie angelegt. Sie ist noch ein Entwurf.</Notice>}
      {search.status === '1' && <Notice tone="success">Status geändert.</Notice>}
      {search.display === '1' && <Notice tone="success">Neuer Tafel-Link erzeugt. Der bisherige funktioniert nicht mehr.</Notice>}
      {search.crew === 'on' && <Notice tone="success">Team-Link eingeschaltet.</Notice>}
      {search.crew === 'new' && <Notice tone="success">Neuer Team-Link erzeugt. Der bisherige funktioniert nicht mehr.</Notice>}
      {search.crew === 'off' && <Notice tone="success">Team-Link ausgeschaltet. Der bisherige funktioniert nicht mehr.</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="plan-stats">
        <Stat label="Programmpunkte" value={items.length} hint={anchors > 0 ? `${anchors} mit fester Uhrzeit` : undefined} />
        <Stat label="Spuren" value={tracks.length} hint={tracks.length > 1 ? 'parallele Abläufe' : undefined} />
        <Stat label="Beginn" value={first ? clock(first) : '–'} hint="laut Plan" />
        <Stat label="Ende" value={last ? clock(last) : '–'} hint="laut Plan" />
      </div>

      <Card className="space-y-4">
        <h2 className="font-semibold">Status: {STATUS_LABELS[event.status]}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">{STATUS_HINTS[event.status]}</p>
        <div className="flex flex-wrap gap-2">
          {liveReady && <ButtonLink href={`${base}/live`} variant="primary">Live-Steuerung</ButtonLink>}
          <ButtonLink href={`${base}/plan`} variant={liveReady ? 'secondary' : 'primary'}>Ablauf planen</ButtonLink>
          {isOwner && allowedStatusChanges(event.status).map(target => (
            <form key={target} action={changeEventStatus}>
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="status" value={target} />
              <button type="submit" className={buttonClass('secondary')}>{STATUS_ACTIONS[target]}</button>
            </form>
          ))}
        </div>
        {isOwner && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Live schalten und beenden geht in der Live-Steuerung (auch für Moderator*innen); einige Stunden nach dem letzten
            Punkt endet das Event automatisch.
          </p>
        )}
      </Card>

      {!isOwner && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Freigegeben für dich</h2>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            In der Live-Steuerung meldest du Beginn, Ende, Verspätungen und Änderungen; die Team-Ansicht zeigt den Ablauf mit
            Prognose und internen Notizen.
          </p>
          <ul className="text-sm list-disc list-inside text-gray-700 dark:text-gray-300">
            <li>Plan bearbeiten: {event.modsMayEditPlan ? 'erlaubt' : 'nicht erlaubt'}</li>
            <li>Einschübe und Löschen während des Events: {event.modsMayInsert ? 'erlaubt' : 'nicht erlaubt'}</li>
          </ul>
          {!canAddRemoveItems(event.level, event) && event.modsMayEditPlan && event.status === 'LIVE' && (
            <p className="text-xs text-gray-600 dark:text-gray-400">Solange das Event live ist, legst du keine Punkte an und löschst keine.</p>
          )}
          {!canEditPlan(event.level, event) && <p className="text-xs text-gray-600 dark:text-gray-400">Den Ablauf kannst du ansehen, aber nicht bearbeiten.</p>}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-semibold">Für Gäste</h2>
          <CopyableField label="Link für Gäste" value={`${baseUrl()}/${event.slug}`} />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {isGuestVisibleStatus(event.status)
              ? `Gäste (${ACCESS_LABELS[event.access]}) sehen den öffentlichen Ablauf mit der aktuellen Prognose; die Seite aktualisiert sich selbst.`
              : 'Noch nicht sichtbar für Gäste – bis zur Veröffentlichung siehst nur du eine Vorschau.'}
            {isOwner && <> Zugang ändern: <Link href={`${base}/einstellungen?abschnitt=zugang`} className="text-blue-700 underline dark:text-blue-300">Einstellungen</Link>.</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/${event.slug}`} size="sm">Gästeansicht</ButtonLink>
            <ButtonLink href={`${base}/qr`} size="sm">QR-Code zum Ausdrucken</ButtonLink>
            <ButtonLink href={`${base}/druck?art=programm`} size="sm">Programmheft</ButtonLink>
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">Anzeigetafel</h2>
          <CopyableField label="Link für die Anzeigetafel (Beamer, TV)" value={boardLink} />
          {protectedAccess && (
            displayLinkConfigured() ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Der Tafel-Link enthält einen Schlüssel und zeigt den Ablauf ohne Anmeldung – gib ihn nur für die Geräte vor Ort weiter.
              </p>
            ) : (
              <Notice tone="warning">Auf dem Server fehlt <code>DISPLAY_LINK_SECRET</code> – ohne ihn zeigt die Tafel bei geschütztem Zugang nichts (siehe README).</Notice>
            )
          )}
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/${event.slug}/tafel`} size="sm">Tafel</ButtonLink>
            {protectedAccess && displayLinkConfigured() && isOwner && (
              <ConfirmForm action={regenerateDisplayLink} message="Neuen Tafel-Link erzeugen? Der bisherige funktioniert danach nicht mehr.">
                <input type="hidden" name="eventId" value={event.id} />
                <button type="submit" className={buttonClass('ghost', 'sm')}>Neuen Tafel-Link erzeugen</button>
              </ConfirmForm>
            )}
          </div>
        </Card>
      </div>

      <Card className="space-y-3">
        <div id="team-link" className="scroll-mt-20 space-y-3">
          <h2 className="font-semibold">Team-Link für Dienstleister</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Für DJ, Fotograf*in oder Catering ohne eigenes Konto: die Team-Ansicht nur zum Lesen – mit Team-Punkten,
            internen Notizen und Zuständigen (nur Namen), geheime Punkte nur als „Geheimer Punkt“ mit Zeit und Dauer.
          </p>
          {!displayLinkConfigured() ? (
            <Notice tone="warning">Auf dem Server fehlt <code>DISPLAY_LINK_SECRET</code> – ohne ihn gibt es keinen Team-Link (siehe README).</Notice>
          ) : event.crewLinkEnabled ? (
            <>
              <CopyableField label="Team-Link (nur lesen)" value={`${baseUrl()}/${event.slug}/team?k=${crewToken(event.id, event.crewLinkVersion)}`} />
              <p className="text-xs text-gray-600 dark:text-gray-400">Wer den Link hat, liest die internen Notizen – gib ihn nur an Dienstleister weiter, nicht an Gäste.</p>
              {isOwner && (
                <div className="flex flex-wrap gap-2">
                  <ConfirmForm action={setCrewLink} message="Neuen Team-Link erzeugen? Der bisherige funktioniert danach nicht mehr.">
                    <input type="hidden" name="eventId" value={event.id} />
                    <input type="hidden" name="mode" value="new" />
                    <button type="submit" className={buttonClass('secondary', 'sm')}>Neuen Team-Link erzeugen</button>
                  </ConfirmForm>
                  <ConfirmForm action={setCrewLink} message="Team-Link ausschalten? Der bisherige funktioniert danach nicht mehr.">
                    <input type="hidden" name="eventId" value={event.id} />
                    <input type="hidden" name="mode" value="off" />
                    <button type="submit" className={buttonClass('danger', 'sm')}>Team-Link ausschalten</button>
                  </ConfirmForm>
                </div>
              )}
            </>
          ) : isOwner ? (
            <form action={setCrewLink}>
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="mode" value="on" />
              <button type="submit" className={buttonClass('secondary')}>Team-Link einschalten</button>
            </form>
          ) : (
            <p className="text-sm text-gray-700 dark:text-gray-300">Ausgeschaltet. Einschalten können Besitzer*in und Admins.</p>
          )}
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Mehr</h2>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`${base}/druck`} size="sm">Regieplan und Programmheft</ButtonLink>
          <ButtonLink href={`${base}/was-waere-wenn`} size="sm">Was wäre wenn?</ButtonLink>
          <a href={`${base}/export`} className={buttonClass('secondary', 'sm')}>Export (JSON)</a>
          {canCreateEvents(user) && <ButtonLink href={`${base}/duplicate`} size="sm">Duplizieren</ButtonLink>}
        </div>
      </Card>
    </div>
  )
}
