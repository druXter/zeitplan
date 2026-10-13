import { NextResponse } from 'next/server'
import { getCurrentUser } from '../../../../../lib/auth'
import { loadEventForUser } from '../../../../../lib/events/store'
import { toCsv } from '../../../../../lib/csv'
import { reviewTable } from '../../../../../lib/review/review'
import { loadReview } from '../../../../../lib/review/store'
import { utcToZonedInput } from '../../../../../lib/timezone'

/**
 * Rückblick als CSV (Idee L24): eine Zeile je Punkt mit Plan, Ist, Abweichungen und Protokollnotiz. Nur lesend,
 * für jedes Konto mit Zugriff aufs Event; geheime Punkte ohne Eintrag nur mit Platzhalter und ohne Notizen
 * (loadPlan). Ohne Zugriff 404 wie der Export.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })

  const event = await loadEventForUser((await params).id, user)
  if (!event) return new NextResponse('Nicht gefunden', { status: 404 })

  const { tracks, rows } = await loadReview(event.id, user.id)
  const names = new Map(tracks.map(track => [track.id, track.name]))
  const table = reviewTable(rows, date => utcToZonedInput(date, event.timezone).replace('T', ' '), id => names.get(id) ?? '')

  return new NextResponse(toCsv(table.header, table.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rueckblick-${event.slug}.csv"`,
      'Cache-Control': 'no-store'
    }
  })
}
