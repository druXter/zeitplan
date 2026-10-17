import { Notice } from '../../ui/kit'
import type { AlertSetting } from '@prisma/client'
import { saveAlertSetting } from './alert-actions'
import { ALERT_LEAD_OPTIONS, ALERT_SCOPE_LABELS } from '../../lib/alerts/due'
import PushToggle from '../../ui/push-toggle'

const ALERT_NOTICES: Record<string, { tone: 'success' | 'error'; text: string }> = {
  saved: { tone: 'success', text: 'Vorwarnung gespeichert.' },
  off: { tone: 'success', text: 'Vorwarnung für dieses Event ausgeschaltet.' },
  invalid: { tone: 'error', text: 'Bitte wähle, wofür und wie lange vorher du gewarnt werden willst.' }
}

/**
 * Vorwarnung fürs Team (Idee L17) in der Team-Ansicht: Push auf diesem Gerät an/aus und für dieses Event "meine Punkte"
 * oder "alle Punkte" mit Vorlauf. Gerechnet wird nach der Prognose, nicht nach der Planzeit.
 */
export default function AlertSettings({ eventId, setting, publicKey, mineOnly, notice }: {
  eventId: string
  setting: Pick<AlertSetting, 'scope' | 'leadMin'> | null
  publicKey: string
  mineOnly: boolean
  notice: string | undefined
}) {
  const feedback = notice ? ALERT_NOTICES[notice] : undefined
  const summary = setting ? `${setting.leadMin} Min vorher, ${ALERT_SCOPE_LABELS[setting.scope]}` : 'aus'
  return (
    <details id="vorwarnung" open={feedback !== undefined} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
      <summary className="cursor-pointer font-semibold">Vorwarnung aufs Handy: <span className="font-normal">{summary}</span></summary>
      <div className="mt-3 space-y-3">
        {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Eine Push-Mitteilung kurz bevor ein Punkt beginnt – nach der erwarteten Zeit, also mit Verspätungen („In 10 Min:
          Eröffnungstanz“). Rutscht der Punkt danach deutlich, kommt eine neue. Gilt nur, solange das Event veröffentlicht
          oder live ist.
        </p>
        <form action={saveAlertSetting} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="eventId" value={eventId} />
          {mineOnly && <input type="hidden" name="mine" value="1" />}
          <div>
            <label htmlFor="alert-scope" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Für</label>
            <select id="alert-scope" name="scope" defaultValue={setting?.scope ?? 'MINE'} className="rounded-lg border border-gray-300 bg-white p-2 text-base sm:text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900">
              <option value="MINE">{ALERT_SCOPE_LABELS.MINE}</option>
              <option value="ALL">{ALERT_SCOPE_LABELS.ALL}</option>
              <option value="OFF">aus</option>
            </select>
          </div>
          <div>
            <label htmlFor="alert-lead" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Wie lange vorher</label>
            <select id="alert-lead" name="leadMin" defaultValue={String(setting?.leadMin ?? 10)} className="rounded-lg border border-gray-300 bg-white p-2 text-base sm:text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900">
              {ALERT_LEAD_OPTIONS.map(minutes => <option key={minutes} value={minutes}>{minutes} Min</option>)}
            </select>
          </div>
          <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-60 whitespace-nowrap px-3.5 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 border border-blue-600">Speichern</button>
        </form>
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-1">
          <p className="text-sm font-medium">Dieses Gerät</p>
          <PushToggle publicKey={publicKey} />
        </div>
      </div>
    </details>
  )
}
