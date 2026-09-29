'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Lädt eine Server-Seite regelmäßig neu (router.refresh - mit der Anmeldung des Kontos, ohne eigenen Endpunkt)
 * und sofort beim Zurückkehren in den Tab. Für Konto-Ansichten wie Team-Ansicht und Live-Steuerung; Gäste nutzen
 * stattdessen den Polling-Endpunkt mit ETag.
 */
export default function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    // Nicht, während jemand tippt (eigene Minuten, Grund, Einschub) - sonst ginge die Eingabe verloren.
    const typing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement
    const refresh = () => { if (!document.hidden && !typing()) router.refresh() }
    const timer = setInterval(refresh, intervalMs)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [router, intervalMs])
  return null
}
