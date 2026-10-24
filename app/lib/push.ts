// app/lib/push.ts
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto'
import { prisma } from './prisma'

/**
 * Web Push ohne Zusatzpaket, bewusst an einer Stelle auditierbar - übernommen aus dem Abstimmungstool
 * (app/lib/push.ts dort), hier für die Vorwarnung fürs Team (Idee L17, app/lib/alerts) und die Erinnerungen
 * für Gäste (Idee L12, app/lib/guest-alerts):
 * - VAPID (RFC 8292): Jede Anfrage an den Push-Dienst trägt ein mit unserem privaten Schlüssel
 *   signiertes JWT (ES256), damit nur wir an unsere Abos schicken können.
 * - Inhalt verschlüsselt nach RFC 8291 ("aes128gcm"): Nur der Browser mit dem Abo kann ihn
 *   lesen, der Push-Dienst (Google, Mozilla, Apple) sieht nur Empfänger-Adresse und Größe.
 *
 * Konfiguration: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url, erzeugen mit
 * `node scripts/generate-vapid-keys.js`) und VAPID_SUBJECT (mailto:… oder https://…, damit
 * der Push-Dienst bei Problemen jemanden erreicht). Ohne sie gibt es keine Push-Mitteilungen,
 * alles andere funktioniert unverändert. Versand ist immer best-effort.
 */

/** url: Pfad auf dieser Herkunft (der Service Worker öffnet nichts anderes). tag: gleiche Tags ersetzen sich. */
export type PushMessage = { title: string; body: string; url: string; tag?: string }

/** ttlSeconds: so lange darf der Push-Dienst zustellen (danach ist die Nachricht veraltet). */
export type PushOptions = { ttlSeconds?: number; urgency?: 'normal' | 'high' }

type VapidKeys = { publicKey: string; privateKey: string; subject: string }

function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

export function isPushConfigured(): boolean {
  return vapidKeys() !== null
}

/** Öffentlicher Schlüssel für pushManager.subscribe (applicationServerKey). */
export function vapidPublicKey(): string | null {
  return vapidKeys()?.publicKey ?? null
}

/** VAPID-Header für einen Push-Dienst (aud = dessen Origin), 12 Stunden gültig. */
function vapidAuthorization(endpoint: string, keys: VapidKeys): string {
  const publicKey = Buffer.from(keys.publicKey, 'base64url')
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC', crv: 'P-256',
      // Auf 32 Byte auffüllen, falls ein Schlüssel ohne führende Null gespeichert wurde.
      d: Buffer.concat([Buffer.alloc(Math.max(32 - Buffer.from(keys.privateKey, 'base64url').length, 0)), Buffer.from(keys.privateKey, 'base64url')]).toString('base64url'),
      x: publicKey.subarray(1, 33).toString('base64url'),
      y: publicKey.subarray(33, 65).toString('base64url')
    }
  })
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: keys.subject
  })).toString('base64url')
  // ES256 im JWT braucht die rohe Signatur r||s, nicht das DER-Format.
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `vapid t=${header}.${claims}.${signature}, k=${keys.publicKey}`
}

/**
 * Verschlüsselt eine Nachricht für ein Abo nach RFC 8291 (ein einziger Datensatz):
 * ECDH mit einem Einmal-Schlüsselpaar, daraus mit dem auth-Geheimnis des Browsers Schlüssel
 * und Nonce für AES-128-GCM. Kopf: salt (16) | Datensatzgröße (4) | Länge (1) | unser öffentlicher Schlüssel (65).
 */
export function encryptPayload(plaintext: Buffer, subscription: { p256dh: string; auth: string }): Buffer {
  const uaPublic = Buffer.from(subscription.p256dh, 'base64url')
  const authSecret = Buffer.from(subscription.auth, 'base64url')
  const ecdh = createECDH('prime256v1')
  const asPublic = ecdh.generateKeys()
  const sharedSecret = ecdh.computeSecret(uaPublic)
  const salt = randomBytes(16)

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // 0x02 = Trenner des letzten (hier einzigen) Datensatzes.
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])

  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(4096)
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, ciphertext])
}

/** Ein Abo beim Push-Dienst eines Browsers (Konto: PushSubscription, Gast: GuestPushSubscription). */
export type PushTarget = { id: string; endpoint: string; p256dh: string; auth: string }

/** So viele Zustellungen gleichzeitig - bei vielen Gäste-Geräten bleibt ein Cron-Lauf so deutlich unter einer Minute. */
const PARALLEL_DELIVERIES = 10

/**
 * Schickt eine Mitteilung an mehrere Abos, bis zu PARALLEL_DELIVERIES gleichzeitig. Abos, die der Push-Dienst als
 * erloschen meldet (404/410), gibt onGone zurück (der Aufrufer löscht sie in seiner Tabelle). Fehler werden
 * geschluckt - eine Mitteilung ist immer best-effort. Gibt die Zahl der angenommenen Zustellungen zurück.
 */
export async function sendPush(targets: PushTarget[], message: PushMessage, options: PushOptions, onGone: (ids: string[]) => Promise<unknown>): Promise<number> {
  const keys = vapidKeys()
  if (!keys || targets.length === 0) return 0
  const body = Buffer.from(JSON.stringify(message))
  const gone: string[] = []
  let delivered = 0
  let next = 0
  async function worker() {
    while (next < targets.length) {
      const target = targets[next++]
      try {
        const response = await fetch(target.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            TTL: String(options.ttlSeconds ?? 24 * 60 * 60),
            Urgency: options.urgency ?? 'normal',
            Authorization: vapidAuthorization(target.endpoint, keys!)
          },
          body: new Uint8Array(encryptPayload(body, target)),
          redirect: 'error', signal: AbortSignal.timeout(5000)
        })
        if (response.status === 404 || response.status === 410) gone.push(target.id)
        else if (response.ok) delivered++
      } catch {
        // Push-Dienst nicht erreichbar - best-effort, siehe oben.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_DELIVERIES, targets.length) }, worker))
  if (gone.length > 0) await onGone(gone)
  return delivered
}

/** Schickt eine Mitteilung an alle Geräte eines Kontos (Vorwarnung fürs Team, Idee L17). */
export async function sendPushToUser(userId: string, message: PushMessage, options: PushOptions = {}): Promise<number> {
  if (!isPushConfigured()) return 0
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId }, select: { id: true, endpoint: true, p256dh: true, auth: true } })
  return sendPush(subscriptions, message, options, ids => prisma.pushSubscription.deleteMany({ where: { id: { in: ids } } }))
}
