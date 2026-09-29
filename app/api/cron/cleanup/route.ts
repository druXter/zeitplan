import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { safeEqual } from '../../../lib/permissions'
import { endIfOver } from '../../../lib/live/store'

// Suite-weit einheitliche Fristen (siehe suite-kit README "Betrieb"), damit die
// Datenschutzerklärungen aller Tools dieselben Zeiträume nennen können.
const ACCOUNT_INACTIVITY_YEARS = 2
const EVENT_RETENTION_MONTHS = 18
// Das Ende eines Events ist vorerst das Ende seines Tages plus ein Tag Spielraum (Hochzeiten gehen
// bis nach Mitternacht). Sobald es Programmpunkte gibt, kann das Ende des letzten Punkts zählen.
const EVENT_END_GRACE_MS = 2 * 24 * 60 * 60 * 1000

/**
 * Automatischer Cron-Endpunkt für Uptime Kuma o.Ä. (Speicherbegrenzung, Art. 5 Abs. 1 lit. e
 * DSGVO), gleiches Muster wie in Seating. Läuft idempotent, einmal täglich reicht.
 *
 * Stand Phase 0:
 * 1. Löscht Events EVENT_RETENTION_MONTHS nach ihrem Ende - samt Freigaben (Cascade).
 * 2. Löscht Konten, die seit ACCOUNT_INACTIVITY_YEARS nicht mehr eingeloggt waren - bewusst
 *    NICHT Admin-Konten (sie sind eine fortlaufende Identität) und nicht Konten, denen noch
 *    Events gehören.
 * 3. Räumt Technisches auf: abgelaufene Sitzungen, abgelaufene Einladungs-/Reset-Links,
 *    veraltete Drossel-Zähler. Abgelaufene Gast-Sitzungen kommen mit Phase 5 dazu.
 * 4. Setzt veröffentlichte und laufende Events nach ihrem Ende auf ENDED (endIfOver, Phase 4) - falls
 *    niemand mehr die Live-Steuerung geöffnet hat.
 */
export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret')
  const expected = process.env.CRON_SECRET

  // Ein leeres/fehlendes CRON_SECRET darf den Endpunkt NICHT freischalten.
  if (!expected || !secret || !safeEqual(secret, expected)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const now = new Date()

  let endedEvents = 0
  for (const event of await prisma.event.findMany({ where: { status: { in: ['PUBLISHED', 'LIVE'] } }, select: { id: true, date: true, status: true } })) {
    if (await endIfOver(event, now)) endedEvents++
  }

  const eventCutoff = new Date(now)
  eventCutoff.setMonth(eventCutoff.getMonth() - EVENT_RETENTION_MONTHS)
  const deletedEvents = await prisma.event.deleteMany({ where: { date: { lt: new Date(eventCutoff.getTime() - EVENT_END_GRACE_MS) } } })

  const inactivityCutoff = new Date(now)
  inactivityCutoff.setFullYear(inactivityCutoff.getFullYear() - ACCOUNT_INACTIVITY_YEARS)

  // Sitzungen und Freigaben verschwinden per Cascade mit dem Konto.
  const deletedUsers = await prisma.user.deleteMany({
    where: { role: { not: 'ADMIN' }, lastLoginAt: { lt: inactivityCutoff }, events: { none: {} } }
  })

  const deletedSessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })
  await prisma.user.updateMany({
    where: { resetTokenExpiresAt: { lt: now } },
    data: { resetTokenHash: null, resetTokenExpiresAt: null }
  })
  await prisma.loginThrottle.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } })

  return NextResponse.json({
    deletedEvents: deletedEvents.count,
    deletedUsers: deletedUsers.count,
    deletedSessions: deletedSessions.count,
    endedEvents
  })
}
