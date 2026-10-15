import { createServer, type Server } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMessage, openMessage, signMessage, type Message } from '../../app/lib/rsvp/token'

// Test-Doppel für rsvp-app (Phase 7b), damit die E2E-Tests ohne echte rsvp-app laufen. Es tut, was rsvp-app nach
// Konzept Abschnitt 8 tun soll: Beim Klick auf "Zeitplan" (hier GET /zeitplan/<timelineEventId>?rsvpEvent=&rsvp=)
// erzeugt es FRISCH einen kurz gültigen, signierten Link und leitet zu Zeitplan weiter; bei Änderungen einer
// Zusage schickt es den Webhook rsvp-change (sendRsvpChange, aus dem Testprozess). Signiert wird wie in rsvp-app
// (createSignedMessage: { typ, ...Felder, iat, exp }) mit dem eigenen Secret der Anbindung.
//
// Port 2532 auf `localhost`: neben Test-SMTP (2527) und den Föderations-Doppeln (2530/2531), und anders als die
// Doppel von Seating (2526-2529), damit beide Testläufe gleichzeitig laufen können.

export const RSVP_PORT = 2532
export const RSVP_ORIGIN = `http://localhost:${RSVP_PORT}`
export const TEST_RSVP_TIMELINE_SECRET = 'e2e-rsvp-timeline-secret-0123456789abcdef'

/** Adresse, die rsvp-app in der Gästeansicht hinter "Zeitplan" legt (Weiterleitung, nicht das Token selbst). */
export function rsvpRedirectUrl(timelineEventId: string, rsvpEventId: string, rsvpId: string): string {
  return `${RSVP_ORIGIN}/zeitplan/${timelineEventId}?rsvpEvent=${rsvpEventId}&rsvp=${rsvpId}`
}

/** Signierter Link wie von rsvp-app - für die Sicherheitsfälle mit einzelnen Abweichungen. */
export function timelineLinkToken(
  zeitplanOrigin: string, content: Omit<Message<'timeline-link'>, 'typ' | 'iat' | 'exp' | 'aud'> & { aud?: string },
  options: { secret?: string; now?: Date; ttlSeconds?: number } = {}
): string {
  return createMessage('timeline-link', { aud: zeitplanOrigin, ...content }, options.secret ?? TEST_RSVP_TIMELINE_SECRET, options)
}

/** Webhook rsvp-change an Zeitplan, wie rsvp-app ihn schickt (text/plain, Body = signierte Nachricht). */
export async function sendRsvpChange(
  zeitplanOrigin: string, content: Omit<Message<'rsvp-change'>, 'typ' | 'iat' | 'exp' | 'aud'> & { aud?: string },
  options: { secret?: string; now?: Date; ttlSeconds?: number } = {}
): Promise<Response> {
  const body = createMessage('rsvp-change', { aud: zeitplanOrigin, ...content }, options.secret ?? TEST_RSVP_TIMELINE_SECRET, options)
  return fetch(`${zeitplanOrigin}/api/rsvp-webhook`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })
}

// Protokoll für den Rückblick (Idee L7, POST /api/timeline/protocol): pro Zeitplan-Event, was rsvp-app freigibt. Die
// Tests laufen in einem anderen Prozess als das Doppel (global-setup) - deshalb über eine Datei.
const PROTOCOLS = join('.e2e', 'rsvp-protocols.json')

export type ProtocolScenario = {
  presence?: { at: string; name: string; change: 'IN' | 'OUT' | 'BACK' }[] | null
  decisions?: object[] | null
  decisionsState?: 'ok' | 'off' | 'unreachable'
  status?: number
  /** Antwort mit falschem Secret signieren */
  badSignature?: boolean
}

export function setProtocol(timelineEventId: string, scenario: ProtocolScenario) {
  mkdirSync('.e2e', { recursive: true })
  let all: Record<string, ProtocolScenario> = {}
  try { all = JSON.parse(readFileSync(PROTOCOLS, 'utf8')) } catch { /* noch keine Datei */ }
  all[timelineEventId] = scenario
  writeFileSync(PROTOCOLS, JSON.stringify(all))
}

/** Prüft die Anfrage wie rsvp-app (Secret, Art, Empfänger) und antwortet mit dem festgelegten Protokoll. */
function protocolResponse(body: string, zeitplanOrigin: string): { status: number; body: string } {
  const request = openMessage(body, TEST_RSVP_TIMELINE_SECRET) as Record<string, unknown> | null
  const now = Math.floor(Date.now() / 1000)
  if (!request || request.typ !== 'protocol-request' || request.aud !== RSVP_ORIGIN || typeof request.exp !== 'number' || request.exp <= now) return { status: 401, body: '' }
  let all: Record<string, ProtocolScenario> = {}
  try { all = JSON.parse(readFileSync(PROTOCOLS, 'utf8')) } catch { /* keine Szenarien */ }
  const scenario = all[String(request.timelineEventId)]
  if (!scenario) return { status: 404, body: '' }
  if (scenario.status && scenario.status !== 200) return { status: scenario.status, body: '' }
  const reply = signMessage({
    typ: 'protocol', aud: zeitplanOrigin, timelineEventId: request.timelineEventId, rsvpEventId: request.rsvpEventId,
    presence: scenario.presence ?? null, decisions: scenario.decisions ?? null, decisionsState: scenario.decisionsState ?? (scenario.decisions ? 'ok' : 'off'),
    iat: now, exp: now + 300
  }, scenario.badSignature ? 'falsch-falsch-falsch-falsch-falsch-falsch' : TEST_RSVP_TIMELINE_SECRET)
  return { status: 200, body: reply }
}

/** `localhost` löst zu ::1 oder 127.0.0.1 auf - auf beiden Loopback-Adressen lauschen, nie nach außen. */
export async function startRsvpServer(zeitplanOrigin: string): Promise<Server[]> {
  const handler = (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
    const url = new URL(request.url ?? '/', RSVP_ORIGIN)
    if (request.method === 'POST' && url.pathname === '/api/timeline/protocol') {
      let body = ''
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        const answer = protocolResponse(body, zeitplanOrigin)
        response.writeHead(answer.status, { 'Content-Type': 'text/plain' }).end(answer.body)
      })
      return
    }
    const match = /^\/zeitplan\/([a-z0-9]+)$/.exec(url.pathname)
    const rsvpEventId = url.searchParams.get('rsvpEvent')
    const rsvpId = url.searchParams.get('rsvp')
    if (!match || !rsvpEventId || !rsvpId) return response.writeHead(404).end('not found')
    const token = timelineLinkToken(zeitplanOrigin, { timelineEventId: match[1], rsvpEventId, rsvpId })
    const target = `${zeitplanOrigin}/rsvp/${match[1]}?t=${encodeURIComponent(token)}`
    response.writeHead(303, { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end()
  }
  return Promise.all(['127.0.0.1', '::1'].map(host => new Promise<Server>((resolve, reject) => {
    const server = createServer(handler)
    server.once('error', reject)
    server.listen(RSVP_PORT, host, () => resolve(server))
  })))
}
