'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Lädt eine Server-Seite regelmäßig neu (router.refresh - mit der Anmeldung des Kontos, ohne eigenen Endpunkt)
 * und sofort beim Zurückkehren in den Tab. Für Konto-Ansichten wie die Team-Ansicht; Gäste nutzen stattdessen
 * den Polling-Endpunkt mit ETag.
 */
export default function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const refresh = () => { if (!document.hidden) router.refresh() }
    const timer = setInterval(refresh, intervalMs)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [router, intervalMs])
  return null
}
