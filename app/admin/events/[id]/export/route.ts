import { NextResponse } from 'next/server'
import { getCurrentUser } from '../../../../lib/auth'
import { loadEventForUser } from '../../../../lib/events/store'
import { buildExport } from '../../../../lib/planning/exchange'
import { loadPlan } from '../../../../lib/planning/store'

/**
 * Download des Ablaufs als JSON (Format siehe app/lib/planning/exchange.ts). Nur lesend - GET verändert
 * nichts. Jedes Konto mit Zugriff aufs Event; geheime Punkte ohne Eintrag nur als Platzhalter (loadPlan).
 * Ohne Zugriff 404 statt 403, damit fremde Event-ids nicht bestätigt werden.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })

  const event = await loadEventForUser((await params).id, user)
  if (!event) return new NextResponse('Nicht gefunden', { status: 404 })

  const { tracks, items } = await loadPlan(event.id, user.id)
  const body = JSON.stringify(buildExport(event, tracks, items), null, 2)

  // Dateiname: die Adresse des Events (nur a-z, 0-9, Bindestrich) - ohne Sonderzeichen-Probleme.
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="zeitplan-${event.slug}.json"`,
      'Cache-Control': 'no-store'
    }
  })
}
