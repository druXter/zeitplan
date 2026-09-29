import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { APP_NAME } from '../../lib/app'
import { loadGuestPayload, payloadEtag, resolveGuestEvent } from '../../lib/guest/store'
import Board from './board'

export const dynamic = 'force-dynamic'

/**
 * Anzeigetafel /<slug>/tafel - gleiche Sichtbarkeit wie die Gästeansicht (resolveGuestEvent). Geschützte Events
 * bekommen mit Phase 5 einen eigenen, per HMAC abgeleiteten Tafel-Link; bis dahin zeigt die Tafel dort nichts.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const resolved = await resolveGuestEvent((await params).slug)
  return { title: resolved ? `${resolved.event.title} – Tafel – ${APP_NAME}` : APP_NAME, robots: { index: false, follow: false } }
}

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolved = await resolveGuestEvent((await params).slug)
  if (!resolved) notFound()
  if (resolved.visibility === 'protected') {
    return (
      <div data-board className="fixed inset-0 z-50 bg-slate-950 text-white flex items-center justify-center p-[4vh]">
        <p className="text-[5vh] font-bold text-center">{resolved.event.title}: nur mit Zugang sichtbar.</p>
      </div>
    )
  }
  const payload = await loadGuestPayload(resolved.event, new Date())
  return <Board slug={resolved.event.slug} initial={payload} etag={payloadEtag(payload)} remember={resolved.visibility === 'public'} />
}
