// app/[slug]/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { prisma } from '../lib/prisma'
import { formString } from '../lib/form'
import { validateSlug } from '../lib/slugs'
import { clientIp, accessCodeRules, refund, reserve } from '../lib/throttle'
import { isGuestVisibleStatus } from '../lib/guest/access'
import { startGuestSession } from '../lib/guest/session'
import { accessCodeConfigured, accessCodeMatches } from '../lib/guest/tokens'

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
