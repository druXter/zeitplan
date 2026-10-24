import { NextResponse } from 'next/server'
import { getCurrentUser } from '../../../../../lib/auth'
import { loadEventForUser } from '../../../../../lib/events/store'
import { csvResponse } from 'suite-kit/web'
import { placeByTime, reviewTable } from '../../../../../lib/review/review'
import { decisionNames, describeProtocolEntry, loadProtocol, type ProtocolEntry } from '../../../../../lib/rsvp/protocol'
import { loadReview } from '../../../../../lib/review/store'
import { utcToZonedInput } from '../../../../../lib/timezone'

/**
 * Rückblick als CSV (Idee L24): eine Zeile je Punkt mit Plan, Ist, Abweichungen und Protokollnotiz. Nur lesend,
 * für jedes Konto mit Zugriff aufs Event; geheime Punkte ohne Eintrag nur mit Platzhalter und ohne Notizen
 * (loadPlan). Ohne Zugriff 404 wie der Export. Gibt der Termin in rsvp-app Kommen und Gehen bzw. Beschlüsse frei (Idee
 * L7), steht beides in einer eigenen Spalte beim Punkt, der lief - was außerhalb der Punkte war, in einer letzten Zeile.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })

  const event = await loadEventForUser((await params).id, user)
  if (!event) return new NextResponse('Nicht gefunden', { status: 404 })

  const [{ tracks, rows }, protocol] = await Promise.all([loadReview(event.id, user.id), loadProtocol(event)])
  const names = new Map(tracks.map(track => [track.id, track.name]))
  const time = (date: Date) => utcToZonedInput(date, event.timezone).replace('T', ' ')
  const table = reviewTable(rows, time, id => names.get(id) ?? '')
  if (protocol.state === 'ok') {
    const { byItem, outside } = placeByTime(rows, protocol.entries)
    const lines = (entries: ProtocolEntry[] = []) => entries.map(entry => {
      const people = decisionNames(entry)
      return `${time(entry.at).slice(11)} ${describeProtocolEntry(entry)}${people ? ` - ${people}` : ''}`
    }).join('\n') || null
    table.header.push('Anwesenheit und Beschlüsse')
    rows.forEach((row, index) => table.rows[index].push(lines(byItem.get(row.item.id))))
    if (outside.length > 0) {
      const extra: (string | number | null)[] = table.header.map(() => null)
      extra[table.header.indexOf('Punkt')] = '(außerhalb der Punkte)'
      extra[extra.length - 1] = lines(outside)
      table.rows.push(extra)
    }
  }

  return csvResponse([table.header, ...table.rows], `rueckblick-${event.slug}.csv`)
}
