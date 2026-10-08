'use client'

import { useActionState, useState } from 'react'
import { createSeries, updateSeries } from './actions'
import { suggestSlug, SLUG_MAX_LENGTH } from '../../lib/slugs'
import { TITLE_MAX_LENGTH } from '../../lib/events/settings'
import { Feedback, input, labelClass } from '../events/event-forms'
import SubmitButton from '../../ui/submit-button'

/** Titel + Adresse einer Reihe; solange die Adresse nicht selbst geändert wurde, folgt sie dem Titel. */
export default function SeriesForm({ baseUrl, seriesId, values }: { baseUrl: string; seriesId?: string; values?: { title: string; slug: string } }) {
  const [state, action, pending] = useActionState(seriesId ? updateSeries : createSeries, null)
  const [title, setTitle] = useState(values?.title ?? '')
  const [slug, setSlug] = useState(values?.slug ?? '')
  const [slugTouched, setSlugTouched] = useState(Boolean(values?.slug))
  return (
    <form action={action} className="space-y-4">
      {seriesId && <input type="hidden" name="seriesId" value={seriesId} />}
      <Feedback state={state} />
      <div>
        <label htmlFor="series-title" className={labelClass}>Titel</label>
        <input id="series-title" name="title" required maxLength={TITLE_MAX_LENGTH} value={title} className={input} placeholder="z. B. Hochzeitswochenende Anna & Ben"
          onChange={event => {
            setTitle(event.currentTarget.value)
            if (!slugTouched) setSlug(suggestSlug(event.currentTarget.value))
          }} />
      </div>
      <div>
        <label htmlFor="series-slug" className={labelClass}>Adresse</label>
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{baseUrl}/</span>
          <input id="series-slug" name="slug" required maxLength={SLUG_MAX_LENGTH} value={slug} className={input} pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={event => { setSlug(event.currentTarget.value); setSlugTouched(true) }} />
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Die Übersichtsseite mit allen Events der Reihe. Events und Reihen teilen sich die Adressen.</p>
      </div>
      <SubmitButton disabled={pending}>{seriesId ? 'Reihe speichern' : 'Reihe anlegen'}</SubmitButton>
    </form>
  )
}
