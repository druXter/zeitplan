// app/[slug]/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { prisma } from '../lib/prisma'
import { formString } from '../lib/form'
import { validateSlug } from '../lib/slugs'
import { clientIp, accessCodeRules, guestPushRule, refund, reserve } from '../lib/throttle'
import { isGuestVisibleStatus } from '../lib/guest/access'
import { currentGuestSessionId, guestAccessExpiresAt, startGuestSession } from '../lib/guest/session'
import { accessCodeConfigured, accessCodeMatches } from '../lib/guest/tokens'
import { resolveGuestEvent } from '../lib/guest/store'
import { guestReminders } from '../lib/guest/payload'
import { getCurrentSessionId } from '../lib/auth'
import { type PushSubscriptionInput, validPushSubscription } from 'suite-kit/web'
import { MAX_GUEST_SUBSCRIPTIONS } from '../lib/guest-alerts/due'

export type AccessCodeState = { error: string } | null

const UNAVAILABLE = 'Für diesen Ablauf gibt es gerade keinen Zugang per Code.'

/**
 * Zugangscode der Gäste (docs/KONZEPT.md Abschnitt 6): gedrosselt pro IP und pro Event (accessCodeRules), der
 * Versuch wird VOR dem Vergleich reserviert (viele gleichzeitige Anfragen umgehen das Limit nicht), ein
 * richtiger Code gibt ihn zurück. Danach eine Gast-Sitzung (Cookie pro Event) und zurück zum Ablauf.
 *
 * Entwürfe, Archiv, unbekannte Adressen und Events ohne Code antworten gleich - die Aktion verrät nicht, ob es
 * ein Event gibt, das nicht sichtbar ist.
 */
export async function enterAccessCode(_previous: AccessCodeState, formData: FormData): Promise<AccessCodeState> {
  const slug = formString(formData, 'slug', 100)
  const input = formString(formData, 'code', 200)
  const event = validateSlug(slug) === null
    ? await prisma.event.findUnique({ where: { slug }, select: { id: true, slug: true, date: true, status: true, access: true, accessCodeHmac: true } })
    : null
  if (!event || !isGuestVisibleStatus(event.status) || event.access !== 'CODE' || !event.accessCodeHmac || !accessCodeConfigured()) {
    return { error: UNAVAILABLE }
  }
  if (!input) return { error: 'Bitte gib den Zugangscode ein.' }

  const rules = accessCodeRules(await clientIp(), event.id)
  if (!(await reserve([rules.ip, rules.event]))) {
    return { error: 'Zu viele Versuche. Bitte warte 15 Minuten und versuch es dann noch einmal.' }
  }
  if (!accessCodeMatches(event.id, input, event.accessCodeHmac)) {
    return { error: 'Der Code stimmt nicht. Du findest ihn auf deiner Einladung.' }
  }
  await refund(rules.ip)
  await refund(rules.event)

  await startGuestSession(event, new Date())
  redirect(`/${event.slug}`)
}

export type GuestReminderResult = 'on' | 'off' | 'unavailable' | 'throttled' | 'error'

/** Event, für das sich dieser Browser gerade Erinnerungen holen darf - sonst null (wie "gibt es nicht"). */
async function reminderEvent(slug: unknown) {
  if (typeof slug !== 'string') return null
  const resolved = await resolveGuestEvent(slug)
  if (!resolved || resolved.visibility === 'protected' || guestReminders(resolved.event) === null) return null
  return resolved.event
}

/**
 * Erinnerungen für Gäste auf DIESEM Gerät einschalten (Idee L12, app/[slug]/reminder-toggle.tsx). Nur, wenn das Event
 * Erinnerungen anbietet und der Browser den Ablauf sehen darf. Gespeichert wird nur das Push-Abo - kein Name, kein
 * Konto -, bei geschützten Events gebunden an den Zugang dieses Browsers (Gast-Sitzung bzw. Konto-Sitzung), damit es
 * mit dem Zugang endet. Gedrosselt pro IP, höchstens MAX_GUEST_SUBSCRIPTIONS Geräte je Event.
 */
export async function subscribeGuestReminders(slug: unknown, input: PushSubscriptionInput): Promise<GuestReminderResult> {
  const event = await reminderEvent(slug)
  if (!event) return 'unavailable'
  const subscription = validPushSubscription(input)
  if (!subscription) return 'error'
  if (!(await reserve([guestPushRule(await clientIp())]))) return 'throttled'

  const now = new Date()
  let binding: { guestSessionId: string | null; sessionId: string | null } = { guestSessionId: null, sessionId: null }
  if (event.access !== 'PUBLIC') {
    const guestSessionId = await currentGuestSessionId(event, now)
    const sessionId = guestSessionId ? null : await getCurrentSessionId()
    if (!guestSessionId && !sessionId) return 'unavailable'
    binding = { guestSessionId, sessionId }
  }

  const existing = await prisma.guestPushSubscription.findUnique({ where: { eventId_endpoint: { eventId: event.id, endpoint: subscription.endpoint } }, select: { id: true } })
  if (!existing && (await prisma.guestPushSubscription.count({ where: { eventId: event.id } })) >= MAX_GUEST_SUBSCRIPTIONS) return 'error'
  const expiresAt = await guestAccessExpiresAt(event, now)
  await prisma.guestPushSubscription.upsert({
    where: { eventId_endpoint: { eventId: event.id, endpoint: subscription.endpoint } },
    update: { p256dh: subscription.p256dh, auth: subscription.auth, ...binding, expiresAt },
    create: { eventId: event.id, ...subscription, ...binding, expiresAt }
  })
  return 'on'
}

/**
 * Erinnerungen dieses Events auf diesem Gerät ausschalten. Das Abo des Browsers selbst bleibt - dasselbe Gerät kann
 * Erinnerungen anderer Events oder die Vorwarnung fürs Team bekommen.
 */
export async function unsubscribeGuestReminders(slug: unknown, endpoint: unknown): Promise<GuestReminderResult> {
  if (typeof slug !== 'string' || typeof endpoint !== 'string' || endpoint.length > 1000 || validateSlug(slug) !== null) return 'error'
  await prisma.guestPushSubscription.deleteMany({ where: { event: { slug }, endpoint } })
  return 'off'
}

/** Hat dieses Gerät (Endpoint seines Push-Abos) Erinnerungen für das Event eingeschaltet? */
export async function guestReminderStatus(slug: unknown, endpoint: unknown): Promise<GuestReminderResult> {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return 'off'
  const event = await reminderEvent(slug)
  if (!event) return 'unavailable'
  const row = await prisma.guestPushSubscription.findUnique({ where: { eventId_endpoint: { eventId: event.id, endpoint } }, select: { expiresAt: true } })
  return row && row.expiresAt > new Date() ? 'on' : 'off'
}
