'use client'

import { SubmitButton } from '../../ui/kit'
import { useActionState, useState } from 'react'
import type { GuestAlertMode, ItemVisibility } from '@prisma/client'
import { saveItem } from './plan-actions'
import { ITEM_VISIBILITY_LABELS, PLAN_LIMITS } from '../../lib/planning/rules'
import { Feedback, input, labelClass } from './event-forms'

export type ItemFormValues = {
  title: string
  location: string
  description: string
  internalNote: string
  trackId: string
  start: string
  durationMin: string
  minDurationMin: string
  visibility: ItemVisibility
  isAnchor: boolean
  mayStartEarly: boolean
  guestAlert: boolean
  waitsFor: string[]
  secretViewers: string[]
  assignees: string[]
}

export type ItemFormOptions = {
  tracks: { id: string; name: string }[]
  /** Punkte, auf die gewartet werden kann - Titel schon nach der SECRET-Regel (Platzhalter). */
  items: { id: string; label: string }[]
  accounts: { id: string; label: string }[]
  /** Namen der Orte mit Adresse (Idee L22) - Vorschläge fürs Feld "Ort". */
  places: string[]
  /** Erinnerungen für Gäste im Event (Idee L12) - das Häkchen wirkt nur bei MARKED. */
  guestAlerts: GuestAlertMode
}

/**
 * Formular eines Programmpunkts (neu oder bearbeiten). Die Liste "Geheim für" erscheint nur bei SECRET;
 * geprüft wird alles in saveItem auf dem Server.
 */
export default function ItemForm({ eventId, itemId, version, values, options, minStart, maxStart }: {
  eventId: string
  itemId?: string
  version?: number
  values: ItemFormValues
  options: ItemFormOptions
  minStart: string
  maxStart: string
}) {
  const [state, action, pending] = useActionState(saveItem, null)
  const [visibility, setVisibility] = useState<ItemVisibility>(values.visibility)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      {itemId && <input type="hidden" name="itemId" value={itemId} />}
      {version !== undefined && <input type="hidden" name="version" value={version} />}
      <Feedback state={state} />

      <div>
        <label htmlFor="item-title" className={labelClass}>Titel</label>
        <input id="item-title" name="title" required maxLength={PLAN_LIMITS.titleMax} defaultValue={values.title} className={input} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="item-start" className={labelClass}>Beginn</label>
          <input id="item-start" name="start" type="datetime-local" required min={minStart} max={maxStart} defaultValue={values.start} className={input} />
        </div>
        <div>
          <label htmlFor="item-duration" className={labelClass}>Dauer in Minuten</label>
          <input id="item-duration" name="durationMin" type="number" inputMode="numeric" required min={0} max={PLAN_LIMITS.durationMaxMin} step={1} defaultValue={values.durationMin} className={input} />
        </div>
      </div>
      <div>
        <label htmlFor="item-min-duration" className={labelClass}>Kürzbar bis (Minuten, optional)</label>
        <input id="item-min-duration" name="minDurationMin" type="number" inputMode="numeric" min={0} max={PLAN_LIMITS.durationMaxMin} step={1} defaultValue={values.minDurationMin} className={`${input} sm:max-w-48`} />
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Mindestdauer für Punkte, die sich kürzen lassen (Kaffee, Reden). Bei Verspätung kürzt die Prognose den Punkt bis hierhin, bevor sie die folgenden Punkte verschiebt. Leer = nicht kürzbar.</p>
      </div>
      <div>
        <label htmlFor="item-track" className={labelClass}>Spur</label>
        <select id="item-track" name="trackId" required defaultValue={values.trackId} className={input}>
          {options.tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="item-location" className={labelClass}>Ort (optional)</label>
        <input id="item-location" name="location" maxLength={PLAN_LIMITS.locationMax} defaultValue={values.location} className={input} list={options.places.length > 0 ? 'item-places' : undefined} />
        {options.places.length > 0 && (
          <>
            <datalist id="item-places">{options.places.map(name => <option key={name} value={name} />)}</datalist>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Heißt der Ort wie einer der Orte mit Adresse ({options.places.join(', ')}), sehen Gäste die Adresse und „Route öffnen“.</p>
          </>
        )}
      </div>
      <div>
        <label htmlFor="item-description" className={labelClass}>Beschreibung für Gäste (optional)</label>
        <textarea id="item-description" name="description" maxLength={PLAN_LIMITS.descriptionMax} rows={3} defaultValue={values.description} className={input} />
      </div>
      <div>
        <label htmlFor="item-note" className={labelClass}>Interne Notiz (nur Team, optional)</label>
        <textarea id="item-note" name="internalNote" maxLength={PLAN_LIMITS.noteMax} rows={3} defaultValue={values.internalNote} className={input} placeholder="z. B. Song, Mikrofon 2, Ansprechperson" />
      </div>

      <fieldset className="space-y-2">
        <legend className={labelClass}>Sichtbarkeit</legend>
        {(Object.keys(ITEM_VISIBILITY_LABELS) as ItemVisibility[]).map(value => (
          <label key={value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} className="mt-1" />
            <span>
              {ITEM_VISIBILITY_LABELS[value]}
              <span className="block text-xs text-gray-600 dark:text-gray-400">
                {value === 'PUBLIC' && 'Gäste sehen den Punkt (in öffentlichen Spuren).'}
                {value === 'TEAM' && 'Alle Konten mit Zugriff aufs Event, keine Gäste – z. B. Aufbau, Technik.'}
                {value === 'SECRET' && 'Inhalt nur für die gewählten Konten – auch nicht für Besitzer*in oder Admins. Alle anderen sehen nur „Geheimer Punkt“ mit Zeit und Dauer, Gäste gar nichts.'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {visibility === 'PUBLIC' && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="guestAlert" defaultChecked={values.guestAlert} className="mt-1" />
          <span>
            <span aria-hidden>🔔 </span>Gäste erinnern
            <span className="block text-xs text-gray-600 dark:text-gray-400">
              {options.guestAlerts === 'MARKED' && 'Gäste mit eingeschalteten Erinnerungen bekommen kurz vor dem Punkt eine Mitteilung.'}
              {options.guestAlerts === 'ALL' && 'Im Event sind gerade Erinnerungen für alle Punkte eingeschaltet – das Häkchen zählt erst bei „nur markierte Punkte“.'}
              {options.guestAlerts === 'OFF' && 'Wirkt erst, wenn in den Einstellungen unter „Erinnerungen für Gäste“ „nur markierte Punkte“ gewählt ist.'}
            </span>
          </span>
        </label>
      )}

      {visibility === 'SECRET' && (
        <fieldset className="space-y-1 border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/50 rounded-lg p-3">
          <legend className={`${labelClass} px-1`}>Geheim für</legend>
          {options.accounts.map(account => (
            <label key={account.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="secretViewers" value={account.id} defaultChecked={values.secretViewers.includes(account.id)} />
              {account.label}
            </label>
          ))}
          <p className="text-xs text-gray-600 dark:text-gray-400">Zur Auswahl stehen Konten mit Zugriff aufs Event. Nur diese können den Punkt auch ändern und live steuern.</p>
        </fieldset>
      )}

      {options.accounts.length > 0 && (
        <fieldset className="space-y-1">
          <legend className={labelClass}>Zuständig (optional)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {options.accounts.map(account => (
              <label key={account.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="assignees" value={account.id} defaultChecked={values.assignees.includes(account.id)} />
                {account.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">Wer den Punkt verantwortet (Rede, Musik, Technik). Zuständige finden ihn in der Team-Ansicht unter „Meine Punkte“ mit der erwarteten Zeit.</p>
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className={labelClass}>Kette</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="isAnchor" defaultChecked={values.isAnchor} className="mt-1" />
          <span>Anker<span className="block text-xs text-gray-600 dark:text-gray-400">Feste Uhrzeit, rutscht nicht mit (Standesamt, Feuerwerk, Band laut Vertrag).</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="mayStartEarly" defaultChecked={values.mayStartEarly} className="mt-1" />
          <span>Darf früher beginnen<span className="block text-xs text-gray-600 dark:text-gray-400">Ist der Punkt davor früher fertig, rückt dieser nach (z. B. Spiele). Sonst beginnt er nie vor seiner Planzeit.</span></span>
        </label>
      </fieldset>

      {options.items.length > 0 && (
        <details open={values.waitsFor.length > 0} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <summary className="text-sm font-medium cursor-pointer">Wartet auf ({values.waitsFor.length} gewählt)</summary>
          <p className="text-xs text-gray-600 dark:text-gray-400 my-2">Der Punkt beginnt frühestens, wenn alle gewählten Punkte vorbei sind – meist Punkte anderer Spuren (Torte wartet auf das Fotoshooting).</p>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {options.items.map(item => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="waitsFor" value={item.id} defaultChecked={values.waitsFor.includes(item.id)} />
                {item.label}
              </label>
            ))}
          </div>
        </details>
      )}

      <SubmitButton disabled={pending}>{itemId ? 'Punkt speichern' : 'Punkt anlegen'}</SubmitButton>
    </form>
  )
}
