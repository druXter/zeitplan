// app/lib/rsvp/protocol.ts
import { z } from 'zod'
import { linkedRsvpEventId, MAX_TOKEN_AGE_SECONDS, openMessage, originOf, REMOTE_ID, rsvpSecret, signMessage, timelineOrigin } from './token'

/**
 * Protokoll aus rsvp-app für den Rückblick (Idee L7): Kommen und Gehen mit Namen und die Beschlüsse der Sitzung im
 * Abstimmungstool - beides gibt der Termin in rsvp-app einzeln frei. Einzige Nachricht, die Zeitplan selbst schickt:
 *
 *   protocol-request { typ, aud: rsvp-app, timelineEventId, rsvpEventId, iat, exp }  -> POST <RSVP_APP_BASE_URL>/api/timeline/protocol
 *   protocol         { typ, aud: Zeitplan, timelineEventId, rsvpEventId, presence, decisions, decisionsState, iat, exp }
 *
 * Gleiches Format und Secret wie die übrige Anbindung (./token.ts). Geladen wird nur zum Anzeigen des Rückblicks
 * (Seite und CSV) - Zeitplan speichert davon nichts, Namen von Gästen stehen weiterhin nie in der Datenbank.
 */

/** Adresse von rsvp-app (RSVP_APP_BASE_URL) - nur dorthin geht die Anfrage. Ohne sie gibt es kein Protokoll. */
export function rsvpAppOrigin(): string | null {
  return originOf(process.env.RSVP_APP_BASE_URL)
}

const time = z.string().max(40).refine(value => !Number.isNaN(Date.parse(value)))
const count = z.number().int().min(0)

const PROTOCOL = z.object({
  typ: z.literal('protocol'),
  aud: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  timelineEventId: z.string().regex(REMOTE_ID),
  rsvpEventId: z.string().regex(REMOTE_ID),
  presence: z.array(z.object({ at: time, name: z.string().max(200), change: z.enum(['IN', 'OUT', 'BACK']) })).max(20_000).nullable(),
  decisions: z.array(z.object({
    title: z.string().max(500),
    secret: z.boolean(),
    openedAt: time,
    closedAt: time,
    voters: count,
    present: count.nullable(),
    quorumMet: z.boolean().nullable(),
    options: z.array(z.object({ label: z.string().max(500), votes: count, names: z.array(z.string().max(200)).max(2000).optional() })).max(100)
  })).max(200).nullable(),
  decisionsState: z.enum(['ok', 'off', 'unreachable'])
})

export type PresenceChange = 'IN' | 'OUT' | 'BACK'
export type ProtocolEntry =
  | { kind: 'presence'; at: Date; name: string; change: PresenceChange }
  | {
      kind: 'decision'; at: Date; title: string; secret: boolean; voters: number; present: number | null; quorumMet: boolean | null
      options: { label: string; votes: number; names?: string[] }[]
    }

export type Protocol =
  /** Nicht verknüpft, nicht eingerichtet oder in rsvp-app nichts freigegeben - der Rückblick zeigt nichts davon. */
  | { state: 'off' }
  | { state: 'unreachable' }
  | { state: 'ok'; presence: boolean; decisions: 'ok' | 'off' | 'unreachable'; entries: ProtocolEntry[] }

/** Liest die signierte Antwort von rsvp-app - null bei jedem Problem (Signatur, Empfänger, Alter, Verknüpfung, Inhalt). */
export function readProtocol(token: string, expected: { timelineEventId: string; rsvpEventId: string }, secret: string, now = new Date()): Protocol | null {
  const parsed = PROTOCOL.safeParse(openMessage(token, secret))
  if (!parsed.success) return null
  const message = parsed.data
  const seconds = Math.floor(now.getTime() / 1000)
  if (message.aud !== timelineOrigin()) return null
  if (message.exp <= seconds || message.exp - seconds > MAX_TOKEN_AGE_SECONDS || message.iat > seconds + 60) return null
  if (message.timelineEventId !== expected.timelineEventId || message.rsvpEventId !== expected.rsvpEventId) return null
  if (message.presence === null && message.decisionsState === 'off') return { state: 'off' }

  const entries: ProtocolEntry[] = [
    ...(message.presence ?? []).map(p => ({ kind: 'presence' as const, at: new Date(p.at), name: p.name, change: p.change })),
    ...(message.decisions ?? []).map(d => ({
      kind: 'decision' as const, at: new Date(d.closedAt),
      title: d.title, secret: d.secret, voters: d.voters, present: d.present, quorumMet: d.quorumMet,
      // Geheime Abstimmungen nie mit Namen - auch wenn welche kämen
      options: d.options.map(o => (d.secret ? { label: o.label, votes: o.votes } : o))
    }))
  ]
  entries.sort((a, b) => a.at.getTime() - b.at.getTime())
  return { state: 'ok', presence: message.presence !== null, decisions: message.decisionsState, entries }
}

/** Fragt rsvp-app nach dem Protokoll des verknüpften Termins (5 Sekunden Zeitlimit). */
export async function loadProtocol(event: { id: string; rsvpLink: unknown }): Promise<Protocol> {
  const secret = rsvpSecret()
  const origin = rsvpAppOrigin()
  const rsvpEventId = linkedRsvpEventId(event.rsvpLink)
  if (!secret || !origin || !rsvpEventId) return { state: 'off' }
  const iat = Math.floor(Date.now() / 1000)
  const body = signMessage({ typ: 'protocol-request', aud: origin, timelineEventId: event.id, rsvpEventId, iat, exp: iat + 300 }, secret)
  try {
    const response = await fetch(`${origin}/api/timeline/protocol`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store'
    })
    // 404: rsvp-app kennt die Verknüpfung (noch) nicht oder hat die Anbindung nicht eingerichtet
    if (response.status === 404) return { state: 'off' }
    if (!response.ok) return { state: 'unreachable' }
    return readProtocol(await response.text(), { timelineEventId: event.id, rsvpEventId }, secret) ?? { state: 'unreachable' }
  } catch {
    return { state: 'unreachable' }
  }
}

const CHANGE_TEXT: Record<PresenceChange, string> = { IN: 'kommt', OUT: 'geht', BACK: 'kommt wieder' }

/** Eine Zeile fürs Protokoll, ohne Uhrzeit: "Anna kommt" bzw. "Beschluss „Antrag 1“: Ja 12 · Nein 3 (…)". */
export function describeProtocolEntry(entry: ProtocolEntry): string {
  if (entry.kind === 'presence') return `${entry.name} ${CHANGE_TEXT[entry.change]}`
  const facts = [
    `${entry.voters} abgestimmt`,
    entry.present !== null && `${entry.present} anwesend`,
    entry.quorumMet === true && 'beschlussfähig',
    entry.quorumMet === false && 'nicht beschlussfähig',
    entry.secret ? 'geheim' : 'namentlich'
  ].filter(Boolean).join(' · ')
  return `Beschluss „${entry.title}“: ${entry.options.map(o => `${o.label} ${o.votes}`).join(' · ')} (${facts})`
}

/** Namen einer namentlichen Abstimmung je Option ("Ja: Anna, Ben; Nein: Cem") - leer bei geheimen. */
export function decisionNames(entry: ProtocolEntry): string {
  if (entry.kind !== 'decision' || entry.secret) return ''
  return entry.options.filter(o => o.names?.length).map(o => `${o.label}: ${o.names!.join(', ')}`).join('; ')
}
