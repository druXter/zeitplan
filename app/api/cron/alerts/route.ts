import { NextResponse } from 'next/server'
import { safeEqual } from '../../../lib/permissions'
import { runAlerts } from '../../../lib/alerts/send'

/**
 * Vorwarnung fürs Team (Idee L17, app/lib/alerts/send.ts): jede Minute von einem externen Scheduler (crontab, Uptime
 * Kuma o. Ä.) mit ?secret=CRON_SECRET aufgerufen. Idempotent - zwei Aufrufe in derselben Minute schicken nichts doppelt.
 * Ohne VAPID-Schlüssel passiert nichts.
 */
export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret')
  const expected = process.env.CRON_SECRET
  // Ein leeres/fehlendes CRON_SECRET darf den Endpunkt NICHT freischalten.
  if (!expected || !secret || !safeEqual(secret, expected)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  return NextResponse.json(await runAlerts(new Date()))
}
