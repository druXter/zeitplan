import { defineConfig, devices } from '@playwright/test'
import { SMTP_PORT } from './tests/e2e/mail-server'
import { TEST_SUITE_IDPS, TEST_SUITE_TRUSTED_APPS, TEST_ZEITPLAN_SIGNING_KEY } from './tests/e2e/suite-server'

// E2E-Tests gegen eine echte, frisch gebaute Instanz (next build + next start) mit eigener
// Datenbank (prisma/test.db) - nie gegen die Entwicklungs- oder Produktivdatenbank.
//
// 127.0.0.1 statt localhost: Cookies sind nicht an Ports gebunden, eine parallel laufende
// Entwicklungsinstanz (localhost:3800) oder ein anderes Tool der Suite auf localhost würde
// sonst dieselben Cookies sehen (siehe suite-kit README, Stolpersteine).
const PORT = 3801
export const BASE_URL = `http://127.0.0.1:${PORT}`
export const TEST_CRON_SECRET = 'e2e-cron-secret'
// Secrets für Zugangscode und Tafel-Link (app/lib/guest/tokens.ts) - auch im Testprozess gesetzt, damit
// die Tests Codes direkt in der Datenbank festlegen und Tafel-Links ableiten können.
const TEST_ACCESS_CODE_SECRET = 'e2e-access-code-secret-0123456789abcdef'
const TEST_DISPLAY_LINK_SECRET = 'e2e-display-link-secret-0123456789abcdef'

// Gilt für den Server UND für die Testprozesse (tests/e2e/helpers.ts greift direkt auf die
// Datenbank zu). Relative SQLite-Pfade löst Prisma relativ zu prisma/schema.prisma auf.
process.env.DATABASE_URL = 'file:./test.db'
process.env.BASE_URL = BASE_URL
process.env.ACCESS_CODE_SECRET = TEST_ACCESS_CODE_SECRET
process.env.DISPLAY_LINK_SECRET = TEST_DISPLAY_LINK_SECRET

export default defineConfig({
  testDir: './tests/e2e',
  // Alle Tests teilen sich eine Datenbank und die Drossel-Zähler - nacheinander ausführen.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    ...devices['Desktop Chrome'],
    locale: 'de-DE'
  },
  webServer: {
    // Datenbank bei jedem Lauf frisch anlegen (nur die eigene Testdatei löschen - bewusst kein
    // `prisma db push --force-reset`, das bei falsch gesetzter DATABASE_URL eine fremde
    // Datenbank leeren würde), dann wie in Produktion bauen und starten.
    command: `rm -f prisma/test.db prisma/test.db-journal && npx prisma db push --skip-generate && npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE_URL}/impressum`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      DATABASE_URL: 'file:./test.db',
      BASE_URL,
      // Ein Proxy: Die Tests spielen ihn selbst und setzen X-Forwarded-For, um verschiedene
      // Besucher-IPs zu simulieren.
      TRUST_PROXY_HOPS: '1',
      CRON_SECRET: TEST_CRON_SECRET,
      ACCESS_CODE_SECRET: TEST_ACCESS_CODE_SECRET,
      DISPLAY_LINK_SECRET: TEST_DISPLAY_LINK_SECRET,
      // Konto-Föderation (Phase 6): zwei andere Tools aus tests/e2e/suite-server.ts - Zeitplan nimmt
      // Anmeldungen von beiden an und stellt selbst welche für Tool A aus.
      SUITE_IDPS: TEST_SUITE_IDPS,
      SUITE_TRUSTED_APPS: TEST_SUITE_TRUSTED_APPS,
      SUITE_SIGNING_KEY: TEST_ZEITPLAN_SIGNING_KEY,
      SUITE_APP_NAME: 'Zeitplan Test',
      // Test-SMTP aus tests/e2e/mail-server.ts (in global-setup gestartet). Empfänger @nomail.test
      // lehnt er ab - dann greift der angezeigte Einladungslink.
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(SMTP_PORT),
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_FROM: 'Zeitplan Test <zeitplan@example.test>',
      TZ: 'Europe/Berlin'
    }
  }
})
