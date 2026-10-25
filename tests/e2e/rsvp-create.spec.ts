import { expect, test, type APIRequestContext } from '@playwright/test'
import { LINKED_CREATE, LINKED_CREATE_STATUS, signLinkedCreate, signLinkMessage, type LinkedCreateMessage } from 'suite-kit'
import { BASE_URL, createAccount, prisma } from './helpers'
import { RSVP_ORIGIN, TEST_RSVP_TIMELINE_SECRET } from './rsvp-server'

// Anlegen aus rsvp-app (Idee Q1, app/lib/rsvp/create.ts): nur mit gültiger Nachricht, nur für ein per Verbund
// verknüpftes Konto mit Anlege-Recht, wiederholbar ohne Doppel. Jeder Angriffsfall mit Positivkontrolle.

const AUD = new URL(BASE_URL).origin
let counter = 0
const cuid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`.slice(0, 30)

async function send(request: APIRequestContext, message: LinkedCreateMessage, options: { secret?: string; aud?: string } = {}) {
  const response = await request.post('/api/rsvp-create', {
    headers: { 'content-type': 'text/plain' },
    data: signLinkedCreate(message, options.aud ?? AUD, options.secret ?? TEST_RSVP_TIMELINE_SECRET)
  })
  return { status: response.status(), body: response.status() === 200 ? await response.json() : null }
}

async function linkedAccount(role: 'CREATOR' | 'MODERATOR' | 'ADMIN' = 'CREATOR') {
  const user = await createAccount(role)
  const rsvpUserId = cuid('rsvpuser')
  await prisma.externalIdentity.create({ data: { issuer: RSVP_ORIGIN, subject: rsvpUserId, userId: user.id } })
  return { user, rsvpUserId }
}

test('angelegt als Entwurf, verknüpft, auf dem Tag des Termins; Wiederholung liefert dasselbe Event', async ({ request }) => {
  const { user, rsvpUserId } = await linkedAccount()
  const rsvpEventId = cuid('rsvpevent')
  const req = { rsvpEventId, rsvpUserId, toolUserId: null }

  expect((await send(request, { kind: LINKED_CREATE_STATUS, request: req })).body).toEqual({ status: 'ready' })
  // 23:30 Uhr deutscher Zeit am 5.12. ist UTC schon der 5.12. 22:30 - der Tag bleibt der 5.12.
  const created = await send(request, { kind: LINKED_CREATE, request: req, title: 'Winterball 2026', startsAt: new Date('2026-12-05T22:30:00Z') })
  expect(created.body).toMatchObject({ status: 'created', linkUrl: `${AUD}/rsvp/${created.body.eventId}`, adminUrl: `${AUD}/admin/events/${created.body.eventId}` })
  const event = await prisma.event.findUniqueOrThrow({ where: { id: created.body.eventId }, include: { tracks: true } })
  expect(event).toMatchObject({ ownerId: user.id, title: 'Winterball 2026', status: 'DRAFT', access: 'RSVP', rsvpLink: { rsvpEventId }, timezone: 'Europe/Berlin' })
  expect(event.slug).toMatch(/^winterball-2026-[0-9a-f]{6}$/)
  expect(event.date.toISOString()).toBe('2026-12-04T23:00:00.000Z')
  expect(event.tracks.map(t => t.name)).toEqual(['Ablauf'])

  // Wiederholt (Doppelklick, Neuladen): dasselbe Event, kein zweites
  const again = await send(request, { kind: LINKED_CREATE, request: req, title: 'Winterball 2026', startsAt: new Date('2026-12-05T22:30:00Z') })
  expect(again.body).toMatchObject({ status: 'linked', eventId: event.id })
  expect((await send(request, { kind: LINKED_CREATE_STATUS, request: req })).body).toMatchObject({ status: 'linked', eventId: event.id })
  expect(await prisma.event.count({ where: { title: 'Winterball 2026', ownerId: user.id } })).toBe(1)

  // Ein anderes Konto bekommt das Event nicht
  const other = await linkedAccount()
  expect((await send(request, { kind: LINKED_CREATE, request: { ...req, rsvpUserId: other.rsvpUserId }, title: 'X', startsAt: new Date() })).body).toEqual({ status: 'taken' })
})

test('ohne Verbund-Verknüpfung nichts, Moderator*innen nicht, Konto aus Anmeldung über Zeitplan schon', async ({ request }) => {
  const req = { rsvpEventId: cuid('rsvpevent'), rsvpUserId: cuid('unbekannt'), toolUserId: null }
  expect((await send(request, { kind: LINKED_CREATE, request: req, title: 'Ohne Konto', startsAt: new Date() })).body).toEqual({ status: 'no-account', loginUrl: `${AUD}/login` })
  expect(await prisma.event.count({ where: { title: 'Ohne Konto' } })).toBe(0)

  const moderator = await linkedAccount('MODERATOR')
  expect((await send(request, { kind: LINKED_CREATE, request: { ...req, rsvpUserId: moderator.rsvpUserId }, title: 'Moderation', startsAt: new Date() })).body).toEqual({ status: 'no-permission' })
  expect(await prisma.event.count({ where: { title: 'Moderation' } })).toBe(0)

  // rsvp-app kennt das Konto hier aus einer Anmeldung über Zeitplan (toolUserId)
  const direct = await createAccount('CREATOR')
  const result = await send(request, { kind: LINKED_CREATE, request: { ...req, toolUserId: direct.id }, title: 'Direkt', startsAt: new Date() })
  expect(result.body.status).toBe('created')
  expect((await prisma.event.findUniqueOrThrow({ where: { id: result.body.eventId } })).ownerId).toBe(direct.id)
})

test('falsches Secret, falscher Empfänger, andere Nachrichtenart, zu großer Body: abgelehnt', async ({ request }) => {
  const { rsvpUserId } = await linkedAccount()
  const message: LinkedCreateMessage = { kind: LINKED_CREATE, request: { rsvpEventId: cuid('rsvpevent'), rsvpUserId, toolUserId: null }, title: 'Angriff', startsAt: new Date() }
  expect((await send(request, message, { secret: 'f'.repeat(40) })).status).toBe(401)
  expect((await send(request, message, { aud: 'https://schichten.example.de' })).status).toBe(401)
  const webhook = signLinkMessage('rsvp-change', AUD, { ...message.request }, TEST_RSVP_TIMELINE_SECRET)
  expect((await request.post('/api/rsvp-create', { data: webhook, headers: { 'content-type': 'text/plain' } })).status()).toBe(401)
  expect((await request.post('/api/rsvp-create', { data: 'x'.repeat(6000), headers: { 'content-type': 'text/plain' } })).status()).toBe(413)
  expect(await prisma.event.count({ where: { title: 'Angriff' } })).toBe(0)
  // Positivkontrolle
  expect((await send(request, message)).body.status).toBe('created')
})
