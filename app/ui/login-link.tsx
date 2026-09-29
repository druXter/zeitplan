// app/ui/login-link.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { RESERVED_SLUGS } from '../lib/slugs'

/**
 * "Anmelden" in der Konto-Leiste - aber nicht auf Seiten für Gäste (Gästeansicht /<slug>, Tafel
 * /<slug>/tafel): Gäste haben kein Konto, der Link würde dort nur verwirren (und auf der Tafel stören).
 */
export default function LoginLink() {
  const pathname = usePathname()
  const segment = /^\/([^/]+)(?:\/tafel)?$/.exec(pathname)?.[1]
  if (segment && !RESERVED_SLUGS.has(segment)) return null
  return <Link href="/login" className="hover:text-gray-900">Anmelden</Link>
}
