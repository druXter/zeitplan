// app/admin/events/event-forms.tsx
'use client'

import { useActionState, useState } from 'react'
import { createEvent, updateEventSettings, type FormState } from './actions'
import { suggestSlug, SLUG_MAX_LENGTH } from '../../lib/slugs'
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from '../../lib/events/settings'
import SubmitButton from '../../ui/submit-button'
import Notice from '../../ui/notice'

function Feedback({ state }: { state: FormState }) {
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

const input = 'w-full border border-gray-300 p-2 rounded'
const labelClass = 'block text-sm font-medium mb-1'

export type EventFormValues = { title: string; slug: string; date: string; description: string }

/** Titel + Adresse: Solange die Adresse nicht selbst geändert wurde, folgt sie dem Titel. */
function TitleAndSlug({ initialTitle, initialSlug, baseUrl }: { initialTitle: string; initialSlug: string; baseUrl: string }) {
  const [title, setTitle] = useState(initialTitle)
  const [slug, setSlug] = useState(initialSlug)
  const [slugTouched, setSlugTouched] = useState(initialSlug !== '')
  return (
    <>
      <div>
        <label htmlFor="event-title" className={labelClass}>Titel</label>
        <input
          id="event-title" name="title" required maxLength={TITLE_MAX_LENGTH} value={title} className={input}
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

function DateAndDescription({ values }: { values: Pick<EventFormValues, 'date' | 'description'> }) {
  return (
    <>
      <div>
        <label htmlFor="event-date" className={labelClass}>Datum</label>
        <input id="event-date" name="date" type="date" required defaultValue={values.date} className={input} />
        <p className="text-xs text-gray-600 mt-1">Der Tag, an dem der Ablauf beginnt. Die Uhrzeiten stehen an den Programmpunkten.</p>
      </div>
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
      <SubmitButton disabled={pending}>Event anlegen</SubmitButton>
    </form>
  )
}

export function EventSettingsForm({ eventId, values, baseUrl }: { eventId: string; values: EventFormValues; baseUrl: string }) {
  const [state, action, pending] = useActionState(updateEventSettings, null)
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      <Feedback state={state} />
      <TitleAndSlug initialTitle={values.title} initialSlug={values.slug} baseUrl={baseUrl} />
      <DateAndDescription values={values} />
      <SubmitButton disabled={pending}>Einstellungen speichern</SubmitButton>
    </form>
  )
}
