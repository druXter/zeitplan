import { prisma } from './helpers'
import { startMailServer } from './mail-server'
import { startSuiteServers } from './suite-server'
import { BASE_URL } from '../../playwright.config'

/**
 * Läuft nach dem Start des Servers (dessen Befehl hat die Datenbank bereits frisch angelegt).
 * Startet den Test-SMTP (tests/e2e/mail-server.ts) und die Test-Doppel zweier anderer Tools der Suite
 * (tests/e2e/suite-server.ts); die zurückgegebene Funktion beendet alle am Ende. Das Test-Doppel für
 * rsvp-app kommt mit Phase 7b dazu (wie in Seating).
 */
export default async function globalSetup() {
  const mailServer = await startMailServer()
  const suiteServers = await startSuiteServers(new URL(BASE_URL).origin)
  await prisma.event.deleteMany()
  await prisma.series.deleteMany()
  await prisma.user.deleteMany()
  await prisma.loginThrottle.deleteMany()
  await prisma.$disconnect()
  return async () => {
    await new Promise<void>(resolve => mailServer.close(() => resolve()))
    for (const server of suiteServers) await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
