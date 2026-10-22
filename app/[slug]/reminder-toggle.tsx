'use client'

import Link from 'next/link'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { guestReminderStatus, subscribeGuestReminders, unsubscribeGuestReminders } from './actions'
import { keyToBytes, pushSupported, registration } from '../ui/push-client'
import { buttonClass } from '../ui/kit'

type State = 'loading' | 'unsupported' | 'denied' | 'off' | 'on' | 'error' | 'throttled' | 'unavailable'

const noSubscription = () => () => {}

/**
 * Erinnerungen für Gäste (Idee L12) auf DIESEM Gerät ein- und ausschalten. Anders als bei der Vorwarnung fürs Team
 * (app/ui/push-toggle.tsx) meldet die Seite ein vorhandenes Browser-Abo NICHT von selbst an: Dasselbe Abo kann schon
 * für ein anderes Event oder fürs Team bestehen - erst der Knopf schaltet die Erinnerungen dieses Events ein.
 * Ausschalten löscht nur die Erinnerungen dieses Events, nicht das Abo des Browsers.
 *
 * Eingebettet (iFrame auf der Hochzeits-Website) erlauben Browser keine Mitteilungen - dort nur ein Link, der den
 * Ablauf in einem neuen Tab öffnet (wie app/[slug]/access-gate.tsx).
 */
export default function ReminderToggle({ slug, publicKey, summary }: { slug: string; publicKey: string; summary: string }) {
  const [state, setState] = useState<State>('loading')
  const embedded = useSyncExternalStore(noSubscription, () => window.self !== window.top, () => false)

  useEffect(() => {
    let active = true
    ;(async (): Promise<State> => {
      if (window.self !== window.top) return 'off'
      if (!pushSupported()) return 'unsupported'
      if (Notification.permission === 'denied') return 'denied'
      const subscription = await (await registration()).pushManager.getSubscription()
      if (!subscription) return 'off'
      return guestReminderStatus(slug, subscription.endpoint)
    })()
      .then(result => { if (active) setState(result) })
      .catch(() => { if (active) setState('error') })
    return () => { active = false }
  }, [slug])

  async function enable() {
    setState('loading')
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setState('denied')
      const reg = await registration()
      const subscription = (await reg.pushManager.getSubscription())
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) })
      setState(await subscribeGuestReminders(slug, subscription.toJSON()))
    } catch {
      setState('error')
    }
  }

  async function disable() {
    setState('loading')
    try {
      const subscription = await (await registration()).pushManager.getSubscription()
      setState(subscription ? await unsubscribeGuestReminders(slug, subscription.endpoint) : 'off')
    } catch {
      setState('error')
    }
  }

  if (state === 'unavailable') return null
  if (embedded) {
    return (
      <Frame summary={summary}>
        <a href={`/${slug}`} target="_blank" rel="noopener" className={buttonClass('primary')}>In neuem Tab öffnen und einschalten</a>
      </Frame>
    )
  }
  return (
    <Frame summary={summary}>
      <div className="space-y-2 text-sm" aria-live="polite">
        {state === 'unsupported' && <p className="text-gray-600 dark:text-gray-400">Dieser Browser kann keine Mitteilungen empfangen. Auf dem iPhone/iPad geht das nur, wenn du die Seite als App installierst (Safari → Teilen → „Zum Home-Bildschirm“) und von dort öffnest.</p>}
        {state === 'denied' && <p className="text-gray-600 dark:text-gray-400">Mitteilungen sind für diese Seite im Browser blockiert. Du kannst sie in den Website-Einstellungen des Browsers wieder erlauben.</p>}
        {state === 'error' && <p className="text-red-700 dark:text-red-300">Das hat nicht geklappt. Bitte versuche es später erneut.</p>}
        {state === 'throttled' && <p className="text-red-700 dark:text-red-300">Zu viele Versuche. Bitte warte ein paar Minuten.</p>}
        {(state === 'off' || state === 'error' || state === 'throttled') && (
          <button type="button" onClick={enable} className={buttonClass('primary')}>Erinnerungen einschalten</button>
        )}
        {state === 'on' && (
          <>
            <p className="text-green-800 dark:text-green-200">Erinnerungen sind auf diesem Gerät eingeschaltet.</p>
            <button type="button" onClick={disable} className={buttonClass('secondary')}>Ausschalten</button>
          </>
        )}
        {state === 'loading' && <p className="text-gray-500 dark:text-gray-400">…</p>}
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Gespeichert wird nur die Adresse deines Geräts beim Push-Dienst deines Browsers, kein Name. Sie wird einen Tag nach dem Event gelöscht.{' '}
          <Link href="/datenschutz" className="underline">Datenschutz</Link>
        </p>
      </div>
    </Frame>
  )
}

function Frame({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800" data-testid="guest-reminders">
      <div>
        <h2 className="font-semibold"><span aria-hidden>🔔 </span>Erinnerungen aufs Handy</h2>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{summary}</p>
      </div>
      {children}
    </section>
  )
}
