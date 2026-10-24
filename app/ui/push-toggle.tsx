// app/ui/push-toggle.tsx
'use client'

import { useEffect, useState } from 'react'
import { buttonClass } from './kit'
import { deletePushSubscription, savePushSubscription } from '../push-actions'
import { keyToBytes, pushSupported, registration } from './push-client'

type State = 'loading' | 'unsupported' | 'denied' | 'off' | 'on' | 'error'

/**
 * Push-Mitteilungen auf DIESEM Gerät an- und ausschalten (app/lib/push.ts, Vorwarnung fürs Team, Idee L17) - wie im
 * Abstimmungstool. Ist im Browser
 * schon ein Abo vorhanden, wird es beim Öffnen der Seite erneut gespeichert - so hängt es nach
 * einer neuen Anmeldung wieder an der aktuellen Sitzung (siehe PushSubscription in schema.prisma).
 */
export default function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!pushSupported()) return 'unsupported'
      if (Notification.permission === 'denied') return 'denied'
      const subscription = await (await registration()).pushManager.getSubscription()
      if (!subscription) return 'off'
      return (await savePushSubscription(subscription.toJSON())) ? 'on' : 'off'
    })()
      .then(result => { if (active) setState(result as State) })
      .catch(() => { if (active) setState('error') })
    return () => { active = false }
  }, [])

  async function enable() {
    setState('loading')
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setState('denied')
      const reg = await registration()
      const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) })
      setState((await savePushSubscription(subscription.toJSON())) ? 'on' : 'error')
    } catch {
      setState('error')
    }
  }

  async function disable() {
    setState('loading')
    try {
      const subscription = await (await registration()).pushManager.getSubscription()
      if (subscription) {
        await deletePushSubscription(subscription.endpoint)
        await subscription.unsubscribe()
      }
      setState('off')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="space-y-2 text-sm">
      {state === 'unsupported' && <p className="text-gray-600 dark:text-gray-400">Dieser Browser unterstützt keine Push-Mitteilungen. Auf dem iPhone/iPad gehen sie nur, wenn das Tool als App installiert ist (Safari → Teilen → „Zum Home-Bildschirm“).</p>}
      {state === 'denied' && <p className="text-gray-600 dark:text-gray-400">Mitteilungen sind für diese Seite im Browser blockiert. Du kannst sie in den Website-Einstellungen des Browsers wieder erlauben.</p>}
      {state === 'error' && <p className="text-red-700 dark:text-red-300">Das hat nicht geklappt. Bitte versuche es später erneut.</p>}
      {(state === 'off' || state === 'error') && (
        <button type="button" onClick={enable} className={buttonClass('primary')}>Mitteilungen auf diesem Gerät einschalten</button>
      )}
      {state === 'on' && (
        <>
          <p className="text-green-800 dark:text-green-200">Mitteilungen sind auf diesem Gerät eingeschaltet.</p>
          <button type="button" onClick={disable} className={buttonClass('secondary')}>Ausschalten</button>
        </>
      )}
      {state === 'loading' && <p className="text-gray-500 dark:text-gray-400">…</p>}
    </div>
  )
}
