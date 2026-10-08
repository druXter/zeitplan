'use client'

import Link from 'next/link'
import { useActionState, useSyncExternalStore } from 'react'
import type { GuestAccess } from '@prisma/client'
import { enterAccessCode } from './actions'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'

const noSubscription = () => () => {}

/**
 * Weg hinein bei geschütztem Zugang (docs/KONZEPT.md Abschnitt 6): Zugangscode, Anmeldung mit Konto oder der Link
 * aus rsvp-app (app/rsvp/[eventId]). Zeigt nichts vom Ablauf - den gibt es erst mit gültigem Zugang.
 *
 * Eingebettet (iFrame auf der Hochzeits-Website) kommt das Cookie der Gast-Sitzung bzw. der Anmeldung als
 * Drittanbieter-Cookie meist nicht an. Dort deshalb nur ein Link, der den Ablauf in einem neuen Tab öffnet.
 */
export default function AccessGate({ slug, access, codeAvailable }: { slug: string; access: GuestAccess; codeAvailable: boolean }) {
  const embedded = useSyncExternalStore(noSubscription, () => window.self !== window.top, () => false)

  if (embedded) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-2">
        <p className="text-gray-700 dark:text-gray-300">Den Ablauf siehst du nach der Eingabe deines Zugangs auf unserer Seite.</p>
        <a href={`/${slug}`} target="_blank" rel="noopener" className="inline-block bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700">
          Ablauf in neuem Tab öffnen
        </a>
      </div>
    )
  }

  if (access === 'CODE') {
    return codeAvailable ? <CodeForm slug={slug} /> : (
      <p className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-gray-700 dark:text-gray-300">Der Zugang per Code ist noch nicht eingerichtet. Schau später wieder vorbei.</p>
    )
  }
  if (access === 'ACCOUNT') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-2">
        <p className="text-gray-700 dark:text-gray-300">Melde dich mit deinem Konto an, um den Ablauf zu sehen.</p>
        <Link href={`/login?next=${encodeURIComponent(`/${slug}`)}`} className="inline-block bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700">
          Anmelden
        </Link>
      </div>
    )
  }
  return (
    <p className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-gray-700 dark:text-gray-300">
      Den Ablauf öffnest du über deine Zusage – den Link findest du in der Einladung.
    </p>
  )
}

function CodeForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(enterAccessCode, null)
  return (
    <form action={action} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
      <input type="hidden" name="slug" value={slug} />
      {state && <Notice tone="error">{state.error}</Notice>}
      <div>
        <label htmlFor="access-code" className="block text-sm font-medium mb-1">Zugangscode</label>
        <input
          id="access-code" name="code" required maxLength={60} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          className="w-full border border-gray-300 dark:border-gray-600 p-3 rounded text-lg tracking-wider" aria-describedby="access-code-hint"
        />
        <p id="access-code-hint" className="text-xs text-gray-600 dark:text-gray-400 mt-1">Steht auf deiner Einladung. Groß- und Kleinschreibung sind egal.</p>
      </div>
      <SubmitButton disabled={pending}>Ablauf öffnen</SubmitButton>
    </form>
  )
}
