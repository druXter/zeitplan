import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { createAccount, prisma, uniqueEmail } from './helpers'

// Auskunft und Löschung zu einer Adresse (Idee Q8, auskunft.js): findet ohne Groß-/Kleinschreibung, gibt keine
// Tokens oder Hashes heraus, ändert erst mit --ja etwas und nie Verwaltungskonten oder Fremdes.
const run = (...args: string[]) => JSON.parse(execFileSync('node', ['auskunft.js', ...args], { env: { ...process.env, DATABASE_URL: 'file:./test.db' }, encoding: 'utf8' }))

test('Auskunft zum Verwaltungskonto, Löschen ändert nichts', async () => {
  const email = uniqueEmail('auskunft')
  const user = await createAccount('CREATOR', { email })
  const info = run(email.toUpperCase())
  expect(info.tool).toBe('zeitplan')
  expect(info.daten.verwaltungskonten).toHaveLength(1)
  expect(info.daten.verwaltungskonten[0]).toMatchObject({ id: user.id, email })
  expect(JSON.stringify(info)).not.toMatch(/passwordHash|tokenHash/)
  expect(info.hinweise.join(' ')).toContain('Verwaltungskonto vorhanden')
  expect(run(email, '--loeschen', '--ja').modus).toBe('geloescht')
  expect(await prisma.user.count({ where: { id: user.id } })).toBe(1)
  expect(run(uniqueEmail('niemand')).daten.verwaltungskonten).toEqual([])
})
