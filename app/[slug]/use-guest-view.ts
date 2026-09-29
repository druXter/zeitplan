'use client'

import { useEffect, useRef, useState } from 'react'
import type { GuestPayload } from '../lib/guest/payload'
import { forgetView, rememberView } from '../lib/guest/offline'

/** Alle 20-30 s (zufällig verteilt, damit nicht alle Gäste im selben Moment fragen) und sofort beim Zurückkehren. */
const POLL_MIN_MS = 20_000
const POLL_JITTER_MS = 10_000

export type Connection = {
  /** Letzte erfolgreiche Antwort (Uhr des Geräts) - für "Stand: 15:32". */
  lastOk: number
  /** Letzte Anfrage gescheitert: den gemerkten Stand mit Hinweis zeigen. */
  offline: boolean
  /** Das Event ist nicht (mehr) sichtbar - z. B. zurück zum Entwurf. */
  gone: boolean
}

/**
 * Hält Gästeansicht und Tafel aktuell: fragt /api/view/<slug> mit dem letzten ETag ab (304 = unverändert), nur
 * solange der Tab sichtbar ist, und merkt sich jeden Stand im Browser (remember - nicht bei der Vorschau).
 */
export function useGuestView(slug: string, initial: GuestPayload, initialEtag: string, remember: boolean) {
  const [payload, setPayload] = useState(initial)
  const [connection, setConnection] = useState<Connection>(() => ({ lastOk: Date.now(), offline: false, gone: false }))
  const etag = useRef(initialEtag)

  useEffect(() => {
    if (remember) rememberView(slug, initial)
  }, [slug, initial, remember])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let running = false

    const poll = async () => {
      if (running) return
      running = true
      try {
        const response = await fetch(`/api/view/${encodeURIComponent(slug)}`, { cache: 'no-store', headers: { 'If-None-Match': etag.current } })
        if (response.status === 200) {
          const next = (await response.json()) as GuestPayload
          etag.current = response.headers.get('ETag') ?? ''
          setPayload(next)
          if (remember) rememberView(slug, next)
          setConnection({ lastOk: Date.now(), offline: false, gone: false })
        } else if (response.status === 304) {
          setConnection({ lastOk: Date.now(), offline: false, gone: false })
        } else if (response.status === 403 || response.status === 404) {
          forgetView(slug)
          setConnection(current => ({ ...current, offline: false, gone: true }))
        } else {
          setConnection(current => ({ ...current, offline: true }))
        }
      } catch {
        setConnection(current => ({ ...current, offline: true }))
      } finally {
        running = false
      }
    }

    const schedule = () => {
      clearTimeout(timer)
      if (!stopped) timer = setTimeout(tick, POLL_MIN_MS + Math.random() * POLL_JITTER_MS)
    }
    const tick = async () => {
      if (!document.hidden) await poll()
      schedule()
    }
    const wake = () => {
      if (document.hidden) return
      void poll()
      schedule()
    }

    schedule()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [slug, remember])

  return { payload, connection }
}
