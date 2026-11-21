// app/lib/rsvp/create.ts
import { randomBytes } from 'node:crypto'
import { linkedCreateSlug, type LinkedCreateRequest, type LinkedCreateResult } from 'suite-kit'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { DEFAULT_EVENT_OPTIONS, TITLE_MAX_LENGTH } from '../events/settings'
import { createEventFromPlan, EMPTY_PLAN } from '../planning/create'
import { SlugTakenError } from '../planning/slug-store'
import { validateSlug } from '../slugs'
import { DEFAULT_TIMEZONE, utcToZonedDate, zonedDateToUtc } from '../timezone'
import { rsvpAppOrigin } from './protocol'
import { linkedRsvpEventId, timelineLinkFor, timelineOrigin } from './token'

/**
 * Anlegen aus rsvp-app (Idee Q1, Vertrag in suite-kit src/linked-create.ts, Route app/api/rsvp-create): rsvp-app
 * lässt zu einem Termin ein Event hier anlegen, das gleich verknüpft ist (Zugang „nur mit Zusage“, Event.rsvpLink) -
 * als Entwurf, leer mit einer Spur, auf dem Tag des Termins. rsvp-app trägt den Zeitplan-Link dann selbst ein.
 *
 * Das Event gehört dem Konto, das hier über den Konten-Verbund mit dem rsvp-app-Konto verknüpft ist (ExternalIdentity
 * mit rsvp-app als Anbieter) - oder dem Konto, das rsvp-app aus einer Anmeldung über Zeitplan kennt (toolUserId). Nie
 * über die E-Mail. Ohne Verknüpfung entsteht nichts, die Antwort nennt den Anmelde-Link.
 */

type Owner = { id: string; role: string }

async function resolveOwner(request: LinkedCreateRequest): Promise<Owner | null> {
  const issuer = rsvpAppOrigin()
  const identity = issuer
    ? await prisma.externalIdentity.findUnique({ where: { issuer_subject: { issuer, subject: request.rsvpUserId } }, select: { userId: true } })
    : null
  const userId = identity?.userId ?? request.toolUserId
  return userId ? prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } }) : null
}

/**
 * Events, die die Kennung dieses Termins tragen. Eintragen kann sie jedes Konto in den Zugangs-Einstellungen - das
 * allein heißt nicht, dass rsvp-app zugestimmt hat. Als bestätigt gilt nur ein Event, das hier aus rsvp-app angelegt
 * wurde (createdFromRsvp). Eine von Hand eingetragene Verknüpfung, die rsvp-app übernommen hat, fragt ohnehin nie
 * hier an: rsvp-app bietet das Anlegen nur an, solange am Termin kein Zeitplan-Link steht.
 */
async function linkedEvents(rsvpEventId: string) {
  const events = await prisma.event.findMany({ where: { rsvpLink: { not: Prisma.DbNull } }, select: { id: true, title: true, ownerId: true, rsvpLink: true } })
  return events
    .filter(event => linkedRsvpEventId(event.rsvpLink) === rsvpEventId)
    .map(event => ({ id: event.id, title: event.title, ownerId: event.ownerId, confirmed: createdFromRsvp(event.rsvpLink) }))
}

function createdFromRsvp(rsvpLink: unknown): boolean {
  return typeof rsvpLink === 'object' && rsvpLink !== null && (rsvpLink as Record<string, unknown>).createdFromRsvp === true
}

/** Mit Titel (suite-kit v0.16.0): rsvp-app zeigt ihn, bevor die Verwaltung ein vorhandenes Event übernimmt. */
function created(status: 'created' | 'linked', eventId: string, title: string): LinkedCreateResult {
  return { status, eventId, linkUrl: timelineLinkFor(eventId), adminUrl: `${timelineOrigin()}/admin/events/${eventId}`, title }
}

/** Darf angelegt werden? Gleiche Prüfungen wie beim Anlegen, ohne etwas zu ändern. */
export async function checkLinkedCreate(request: LinkedCreateRequest): Promise<LinkedCreateResult> {
  const owner = await resolveOwner(request)
  if (!owner) return { status: 'no-account', loginUrl: `${timelineOrigin()}/login` }
  if (owner.role === 'MODERATOR') return { status: 'no-permission' }
  const existing = await linkedEvents(request.rsvpEventId)
  // Nur ein eigenes Event wird übernommen - auch für Admins: rsvp-app trägt den gelieferten Link am Termin ein, und
  // jede Zusage bekommt darüber Zugang zum Event (auch zu einem fremden mit Zugang „nur mit Zusage“).
  const own = existing.find(event => event.ownerId === owner.id)
  if (own) return created('linked', own.id, own.title)
  // Ein fremdes blockiert nur, wenn es bestätigt ist - sonst könnte jedes Konto das Anlegen für beliebige Termine
  // sperren, indem es deren Kennung einträgt.
  return existing.some(event => event.confirmed) ? { status: 'taken' } : { status: 'ready' }
}

export async function performLinkedCreate(request: LinkedCreateRequest, title: string, startsAt: Date): Promise<LinkedCreateResult> {
  const check = await checkLinkedCreate(request)
  if (check.status !== 'ready') return check
  const owner = (await resolveOwner(request))!

  // Der Tag des Termins in der Zeitzone von Zeitplan, 00:00 Ortszeit wie beim Anlegen per Formular
  const timezone = DEFAULT_TIMEZONE
  const date = zonedDateToUtc(utcToZonedDate(startsAt, timezone), timezone)!
  const fields = { title: title.slice(0, TITLE_MAX_LENGTH), description: '', date, timezone }
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = linkedCreateSlug(title, randomBytes(3).toString('hex'), 60)
    if (validateSlug(slug)) continue
    try {
      const eventId = await createEventFromPlan(owner.id, { ...fields, slug }, DEFAULT_EVENT_OPTIONS, EMPTY_PLAN, request.rsvpEventId)
      return created('created', eventId, fields.title)
    } catch (error) {
      if (!(error instanceof SlugTakenError)) throw error
    }
  }
  throw new Error('Keine freie Adresse für das angelegte Event gefunden')
}
