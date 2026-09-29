import { prisma } from './helpers'
import { startMailServer } from './mail-server'

/**
 * Läuft nach dem Start des Servers (dessen Befehl hat die Datenbank bereits frisch angelegt).
 * Startet den Test-SMTP (tests/e2e/mail-server.ts); die zurückgegebene Funktion beendet ihn am Ende.
 * Test-Doppel für rsvp-app und andere Tools der Suite kommen mit Phase 6 und 7b dazu (wie in Seating).
 */
export default async function globalSetup() {
  const mailServer = await startMailServer()
  await prisma.event.deleteMany()
  await prisma.series.deleteMany()
  await prisma.user.deleteMany()
  await prisma.loginThrottle.deleteMany()
  await prisma.$disconnect()
  return async () => {
    await new Promise<void>(resolve => mailServer.close(() => resolve()))
  }
}
