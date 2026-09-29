// app/admin/events/event-forms.tsx
'use client'

import { useActionState, useState } from 'react'
import { createEvent, duplicateEvent, importEvent, updateEventOptions, updateEventSettings, type FormState } from './actions'
import { suggestSlug, SLUG_MAX_LENGTH } from '../../lib/slugs'
import { DESCRIPTION_MAX_LENGTH, OPTION_BOUNDS, TITLE_MAX_LENGTH, type EventOptions } from '../../lib/events/settings'
import SubmitButton from '../../ui/submit-button'
import Notice from '../../ui/notice'

export function Feedback({ state }: { state: FormState }) {
  if (!state) return null
  if (state.errors.length > 0) {
    return (
      <Notice tone="error">
        <ul className="list-disc list-inside">
          {state.errors.map((error, index) => <li key={index}>{error}</li>)}
        </ul>
      </Notice>
    )
  }
  return state.message ? <Notice tone="success">{state.message}</Notice> : null
}

export const input = 'w-full border border-gray-300 p-2 rounded'
export const labelClass = 'block text-sm font-medium mb-1'

export type EventFormValues = { title: string; slug: string; date: string; description: string }

/** Titel + Adresse: Solange die Adresse nicht selbst geändert wurde, folgt sie dem Titel. */
function TitleAndSlug({ initialTitle, initialSlug, baseUrl, required = true }: { initialTitle: string; initialSlug: string; baseUrl: string; required?: boolean }) {
  const [title, setTitle] = useState(initialTitle)
  const [slug, setSlug] = useState(initialSlug)
  const [slugTouched, setSlugTouched] = useState(initialSlug !== '')
  return (
    <>
      <div>
        <label htmlFor="event-title" className={labelClass}>Titel</label>
        <input
          id="event-title" name="title" required={required} maxLength={TITLE_MAX_LENGTH} value={title} className={input}
          placeholder="z. B. Hochzeit Anna & Ben"
          onChange={event => {
            setTitle(event.currentTarget.value)
            if (!slugTouched) setSlug(suggestSlug(event.currentTarget.value))
          }}
        />
      </div>
      <div>
        <label htmlFor="event-slug" className={labelClass}>Adresse</label>
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-600 whitespace-nowrap">{baseUrl}/</span>
          <input
            id="event-slug" name="slug" required maxLength={SLUG_MAX_LENGTH} value={slug} className={input}
            pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-describedby="event-slug-hint"
            onChange={event => {
              setSlug(event.currentTarget.value)
              setSlugTouched(true)
            }}
          />
        </div>
        <p id="event-slug-hint" className="text-xs text-gray-600 mt-1">
          Kleinbuchstaben, Ziffern und Bindestriche. Ändert sich die Adresse später, funktionieren bereits verteilte Links
          und QR-Codes nicht mehr.
        </p>
      </div>
    </>
  )
}

function EventDate({ value, required = true, hint = 'Der Tag, an dem der Ablauf beginnt. Die Uhrzeiten stehen an den Programmpunkten.' }: { value: string; required?: boolean; hint?: string }) {
  return (
    <div>
      <label htmlFor="event-date" className={labelClass}>Datum</label>
      <input id="event-date" name="date" type="date" required={required} defaultValue={value} className={input} />
      <p className="text-xs text-gray-600 mt-1">{hint}</p>
    </div>
  )
}

function DateAndDescription({ values }: { values: Pick<EventFormValues, 'date' | 'description'> }) {
  return (
    <>
      <EventDate value={values.date} />
      <div>
        <label htmlFor="event-description" className={labelClass}>Beschreibung (optional)</label>
        <textarea id="event-description" name="description" maxLength={DESCRIPTION_MAX_LENGTH} defaultValue={values.description} rows={4} className={input} />
      </div>
    </>
  )
}

export function CreateEventForm({ baseUrl }: { baseUrl: string }) {
  const [state, action, pending] = useActionState(createEvent, null)
  return (
    <form action={action} className="space-y-4">
      <Feedback state={state} />
      <TitleAndSlug initialTitle="" initialSlug="" baseUrl={baseUrl} />
      <DateAndDescription values={{ date: '', description: '' }} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="template" value="wedding" className="mt-1" />
        <span>
          Mit der Vorlage „Hochzeit“ beginnen
          <span className="block text-xs text-gray-600">
            Ein typischer Ablauf mit Trauung, Empfang, Abendessen (Anker), Party, einer Spur fürs Brautpaar und einer fürs
            Team – alles lässt sich danach ändern oder löschen.
          </span>
        </span>
      </label>
      <SubmitButton disabled={pending}>Event anlegen</SubmitButton>
    </form>
  )
}

/** Import einer Ablauf-Datei (Export dieses Tools) als neues Event. Titel und Tag optional aus der Datei. */
export function ImportEventForm({ baseUrl }: { baseUrl: string }) {
  const [state, action, pending] = useActionState(importEvent, null)
  return (
    <form action={action} className="space-y-4">
      <Feedback state={state} />
      <div>
        <label htmlFor="import-file" className={labelClass}>Datei (JSON)</label>
        <input id="import-file" name="file" type="file" accept="application/json,.json" required className="text-sm" />
      </div>
      <TitleAndSlug initialTitle="" initialSlug="" baseUrl={baseUrl} required={false} />
      <EventDate value="" required={false} hint="Leer lassen, um den Tag aus der Datei zu übernehmen. Sonst rutschen alle Punkte auf diesen Tag, die Uhrzeiten bleiben." />
      <SubmitButton disabled={pending}>Importieren</SubmitButton>
    </form>
  )
}

export type SeriesOption = { id: string; title: string }

export function EventSettingsForm({ eventId, values, baseUrl, series, seriesId }: {
  eventId: string; values: EventFormValues; baseUrl: string; series: SeriesOption[]; seriesId: string | null
}) {
  const [state, action, pending] = useActionState(updateEventSettings, null)
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      <Feedback state={state} />
      <TitleAndSlug initialTitle={values.title} initialSlug={values.slug} baseUrl={baseUrl} />
      <EventDate value={values.date} hint="Ein anderer Tag verschiebt alle Programmpunkte mit, die Uhrzeiten bleiben." />
      <div>
        <label htmlFor="event-description" className={labelClass}>Beschreibung (optional)</label>
        <textarea id="event-description" name="description" maxLength={DESCRIPTION_MAX_LENGTH} defaultValue={values.description} rows={4} className={input} />
      </div>
      <div>
        <label htmlFor="event-series" className={labelClass}>Reihe (optional)</label>
        <select id="event-series" name="seriesId" defaultValue={seriesId ?? ''} className={input}>
          <option value="">keine</option>
          {series.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
        </select>
        <p className="text-xs text-gray-600 mt-1">Mehrere Events (z. B. Polterabend, Hochzeit, Brunch) mit gemeinsamer Übersichtsseite. Reihen legst du unter „Reihen“ an.</p>
      </div>
      <SubmitButton disabled={pending}>Einstellungen speichern</SubmitButton>
    </form>
  )
}

function MinutesField({ name, label, value, hint }: { name: keyof typeof OPTION_BOUNDS; label: string; value: number; hint: string }) {
  const bound = OPTION_BOUNDS[name]
  return (
    <div>
      <label htmlFor={`option-${name}`} className={labelClass}>{label}</label>
      <div className="flex items-center gap-2">
        <input id={`option-${name}`} name={name} type="number" inputMode="numeric" min={bound.min} max={bound.max} step={1} required defaultValue={value} className={`${input} max-w-28`} />
        <span className="text-sm text-gray-600">Min.</span>
      </div>
      <p className="text-xs text-gray-600 mt-1">{hint}</p>
    </div>
  )
}

function Toggle({ name, label, checked, hint }: { name: string; label: string; checked: boolean; hint: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-1" />
      <span>{label}<span className="block text-xs text-gray-600">{hint}</span></span>
    </label>
  )
}

/** Prognose, Anzeige für Gäste und Rechte der Moderator*innen (docs/KONZEPT.md Abschnitt 2 und 7). */
export function EventOptionsForm({ eventId, options, modsMayEditPlan, modsMayInsert }: {
  eventId: string; options: EventOptions; modsMayEditPlan: boolean; modsMayInsert: boolean
}) {
  const [state, action, pending] = useActionState(updateEventOptions, null)
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      <Feedback state={state} />
      <fieldset className="space-y-3">
        <legend className="font-medium">Rechte der Moderator*innen</legend>
        <Toggle name="modsMayEditPlan" label="Plan bearbeiten" checked={modsMayEditPlan}
          hint="Texte, Orte, Zeiten, Dauer, Anker und Sichtbarkeit aller Punkte ändern, Punkte anlegen und löschen – auch vor dem Event. Spuren und Einstellungen bleiben bei dir." />
        <Toggle name="modsMayInsert" label="Einschübe und Löschen während des Events" checked={modsMayInsert}
          hint="Spontane Punkte einfügen und wieder entfernen, solange das Event live ist." />
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-medium">Anzeige für Gäste</legend>
        <MinutesField name="guestRoundingMin" label="Rundung" value={options.guestRoundingMin} hint="Abweichende Zeiten werden auf so viele Minuten gerundet und mit „ca.“ gezeigt." />
        <MinutesField name="hysteresisMin" label="Hysterese" value={options.hysteresisMin} hint="Kleinere Schwankungen ändern die Anzeige nicht, damit Zeiten nicht springen." />
        <MinutesField name="guestHorizonMin" label="Horizont" value={options.guestHorizonMin} hint="Abweichungen sehen Gäste erst so kurz vor dem geplanten Beginn, davor die Planzeit." />
        <Toggle name="showDelayToGuests" label="Abweichung zeigen („+10“)" checked={options.showDelayToGuests} hint="Sonst sehen Gäste nur die neue Uhrzeit mit „ca.“." />
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-medium">Prognose</legend>
        <Toggle name="autoCreep" label="Fortschreiben" checked={options.autoCreep} hint="Läuft ein Punkt länger und niemand drückt „Beendet“, wächst die Verspätung live mit." />
        <MinutesField name="creepNudgeMin" label="Nachfrage nach" value={options.creepNudgeMin} hint="So lange nach dem erwarteten Ende fragt die Live-Steuerung „läuft noch?“." />
        <MinutesField name="creepCapMin" label="Deckel" value={options.creepCapMin} hint="Weiter wächst die Verspätung ohne Bestätigung nicht; das Team sieht dann „unklar“." />
      </fieldset>
      <SubmitButton disabled={pending}>Speichern</SubmitButton>
    </form>
  )
}

/** Kopie auf einen neuen Tag - ohne Live-Stand und Freigaben. */
export function DuplicateEventForm({ eventId, title, baseUrl }: { eventId: string; title: string; baseUrl: string }) {
  const [state, action, pending] = useActionState(duplicateEvent, null)
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      <Feedback state={state} />
      <TitleAndSlug initialTitle={`${title} (Kopie)`.slice(0, TITLE_MAX_LENGTH)} initialSlug="" baseUrl={baseUrl} />
      <EventDate value="" hint="Alle Punkte rutschen auf diesen Tag, die Uhrzeiten bleiben." />
      <SubmitButton disabled={pending}>Kopie anlegen</SubmitButton>
    </form>
  )
}
