import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { APP_NAME } from '../../lib/app'
import { loadGuestPayload, payloadEtag, resolveGuestEvent } from '../../lib/guest/store'
import Board from './board'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string | string[] }> }

/** Tafel-Link ?k=... (app/lib/guest/tokens.ts displayToken) - nur ein einzelner Wert zählt. */
async function displayKeyOf(searchParams: Props['searchParams']): Promise<string | undefined> {
  const { k } = await searchParams
  return typeof k === 'string' ? k : undefined
}

/**
 * Anzeigetafel /<slug>/tafel - gleiche Sichtbarkeit wie die Gästeansicht (resolveGuestEvent). Bei geschütztem
 * Zugang gilt zusätzlich der eigene, per HMAC abgeleitete Tafel-Link (/<slug>/tafel?k=...) für den Fernseher im
 * Saal, an dem sich niemand anmeldet. Ohne gültigen Zugang zeigt die Tafel nur den Titel - keine Code-Eingabe.
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const resolved = await resolveGuestEvent((await params).slug, await displayKeyOf(searchParams))
  return { title: resolved ? `${resolved.event.title} – Tafel – ${APP_NAME}` : APP_NAME, robots: { index: false, follow: false } }
}

export default async function BoardPage({ params, searchParams }: Props) {
  const displayKey = await displayKeyOf(searchParams)
  const resolved = await resolveGuestEvent((await params).slug, displayKey)
  if (!resolved) notFound()
  if (resolved.visibility === 'protected') {
    return (
      <div data-board className="fixed inset-0 z-50 bg-slate-950 text-white flex items-center justify-center p-[4vh]">
        <p className="text-[5vh] font-bold text-center">{resolved.event.title}: nur mit Zugang sichtbar.</p>
      </div>
    )
  }
  const payload = await loadGuestPayload(resolved.event, new Date())
  return (
    <Board
      slug={resolved.event.slug} initial={payload} etag={payloadEtag(payload)} remember={resolved.visibility !== 'preview'}
      displayKey={resolved.visibility === 'guest' ? displayKey : undefined}
    />
  )
}
