// app/ui/header-gate.tsx
'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { RESERVED_SLUGS } from '../lib/slugs'

/**
 * Blendet die Kopfzeile aus, wo sie stört: auf der Anzeigetafel (/<slug>/tafel, Beamer/TV) immer, auf den übrigen
 * Seiten für Gäste und Dienstleister (/<slug>, /<slug>/team) ohne Anmeldung - Gäste haben kein Konto, Marke und
 * „Anmelden“ würden dort nur verwirren.
 */
export default function HeaderGate({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  const guestPage = segments.length > 0 && !RESERVED_SLUGS.has(segments[0])
  if (guestPage && (!signedIn || segments[1] === 'tafel')) return null
  return <>{children}</>
}
