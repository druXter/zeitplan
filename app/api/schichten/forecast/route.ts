// app/api/schichten/forecast/route.ts
import { NextResponse } from 'next/server'
import { readLimitedText } from 'suite-kit/web'
import { prisma } from '../../../lib/prisma'
import { createForecastResponse, linkedShiftsEventId, shiftsOrigin, shiftsSecret, timelineOrigin, verifyForecastRequest } from '../../../lib/shifts/token'
import { forecastForShifts } from '../../../lib/shifts/forecast'

export const dynamic = 'force-dynamic'

const MAX_BODY = 10_000

/**
 * Abruf der Prognose durch Schichten (app/lib/shifts/token.ts): Anfrage forecast-request im Body, Antwort
 * timeline-forecast als signierter Text. 404 ohne Anbindung, 401 bei ungültiger Anfrage, 404, wenn das Event nicht
 * genau mit dem anfragenden Schichten-Event verknüpft ist (beide Seiten müssen die andere id eingetragen haben).
 */
export async function POST(request: Request) {
  const secret = shiftsSecret()
  const audience = shiftsOrigin()
  if (!secret || !audience) return new NextResponse('not configured', { status: 404 })

  const body = await readLimitedText(request, MAX_BODY)
  if (body === null) return new NextResponse('too large', { status: 413 })
  const message = verifyForecastRequest(body, { secret, audience: timelineOrigin() })
  if (!message) return new NextResponse('invalid message', { status: 401 })

  const event = await prisma.event.findUnique({
    where: { id: message.timelineEventId },
    select: { id: true, shiftsLink: true, autoCreep: true, creepCapMin: true, creepNudgeMin: true }
  })
  if (!event || linkedShiftsEventId(event.shiftsLink) !== message.shiftsEventId) return new NextResponse('not linked', { status: 404 })

  const items = await forecastForShifts(event, new Date())
  const response = createForecastResponse({ aud: audience, shiftsEventId: message.shiftsEventId, timelineEventId: event.id, items }, secret)
  return new NextResponse(response, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}
