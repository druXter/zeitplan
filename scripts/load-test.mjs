// scripts/load-test.mjs
// Lasttest (Phase 8, docs/KONZEPT.md Abschnitt 11): 200 Gäste pollen die Gästeansicht, während eine Moderatorin
// laufend Änderungen meldet. Startet eine eigene Instanz (next start, Port 3802) mit eigener Datenbank
// (prisma/load.db, bei jedem Lauf neu) - nie gegen Entwicklungs- oder Produktivdaten.
//
//   npm run build && npm run test:load                       # Standard: Zugang per Code, 200 Gäste, 3 Minuten
//   GUESTS=400 DURATION=120 ACCESS=PUBLIC npm run test:load   # Varianten
//
// Szenarien:
//   1. Alltag: jede*r Gast fragt alle 20-30 s (zufällig verteilt) mit ETag, wie die Seite es tut. Alle 15 s ändert
//      eine Moderatorin etwas (Verspätung, Start, Ende) - danach bekommen alle einen neuen Stand (200 statt 304),
//      und die Anfragen speichern den gezeigten Beginn (guestShownStart) für die Hysterese.
//   2. Ansturm: alle Gäste gleichzeitig (z. B. alle kehren nach einer Durchsage in den Tab zurück), einmal ohne und
//      einmal direkt nach einer Änderung.
// Ergebnis: Antwortzeiten (p50/p95/p99/max), Statuscodes, Fehler. Exit-Code 1 bei Fehlern oder p95 über der Grenze.

import { spawn, execSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const PORT = Number(process.env.PORT ?? 3802)
const BASE = `http://127.0.0.1:${PORT}`
const GUESTS = Number(process.env.GUESTS ?? 200)
const DURATION_S = Number(process.env.DURATION ?? 180)
const ACCESS = process.env.ACCESS === 'PUBLIC' ? 'PUBLIC' : 'CODE'
const P95_LIMIT_MS = Number(process.env.P95_LIMIT_MS ?? 500)
const BURST_P99_LIMIT_MS = Number(process.env.BURST_P99_LIMIT_MS ?? 3000)
const DATABASE_URL = 'file:./load.db'
const MINUTE = 60_000

const env = { ...process.env, DATABASE_URL, BASE_URL: BASE, NODE_ENV: 'production', TRUST_PROXY_HOPS: '0', TZ: 'Europe/Berlin' }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

function summarize(label, samples) {
  const times = samples.map(s => s.ms).sort((a, b) => a - b)
  const statuses = {}
  for (const s of samples) statuses[s.status] = (statuses[s.status] ?? 0) + 1
  const result = {
    label,
    requests: samples.length,
    statuses,
    p50: Math.round(percentile(times, 50)),
    p95: Math.round(percentile(times, 95)),
    p99: Math.round(percentile(times, 99)),
    max: Math.round(times.at(-1) ?? 0)
  }
  console.log(`${label}: ${result.requests} Anfragen, Status ${JSON.stringify(statuses)}, p50 ${result.p50} ms, p95 ${result.p95} ms, p99 ${result.p99} ms, max ${result.max} ms`)
  return result
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/impressum`)).ok) return
    } catch { /* startet noch */ }
    await sleep(500)
  }
  throw new Error('Server startet nicht')
}

/** Ein Hochzeitsablauf um "jetzt" herum: zwei öffentliche Spuren, eine Team-Spur, 24 Punkte, ein Anker. */
async function seed(prisma) {
  const now = Math.floor(Date.now() / MINUTE) * MINUTE
  const day = new Date(now - (now % (24 * 60 * MINUTE)))
  const event = await prisma.event.create({
    data: { slug: 'lasttest-hochzeit', title: 'Lasttest Hochzeit', date: day, status: 'LIVE', access: ACCESS, accessCodeHmac: ACCESS === 'CODE' ? 'nicht-benutzt' : null }
  })
  const [main, couple, team] = await Promise.all([
    prisma.track.create({ data: { eventId: event.id, name: 'Gäste', sortOrder: 1 } }),
    prisma.track.create({ data: { eventId: event.id, name: 'Brautpaar', sortOrder: 2 } }),
    prisma.track.create({ data: { eventId: event.id, name: 'Technik', sortOrder: 3, visibility: 'TEAM' } })
  ])
  const items = []
  let order = 0
  for (let i = 0; i < 14; i++) {
    items.push({ trackId: main.id, sortOrder: ++order, title: `Programmpunkt ${i + 1}`, plannedStart: new Date(now + (i * 40 - 60) * MINUTE), plannedDurationMin: 30, isAnchor: i === 8, location: 'Festsaal', description: 'Beschreibung für Gäste', internalNote: 'Notiz fürs Team' })
  }
  for (let i = 0; i < 6; i++) {
    items.push({ trackId: couple.id, sortOrder: i + 1, title: `Brautpaar ${i + 1}`, plannedStart: new Date(now + (i * 60 - 30) * MINUTE), plannedDurationMin: 45 })
  }
  for (let i = 0; i < 4; i++) {
    items.push({ trackId: team.id, sortOrder: i + 1, title: `Technik ${i + 1}`, plannedStart: new Date(now + (i * 90 - 90) * MINUTE), plannedDurationMin: 20, visibility: 'TEAM' })
  }
  for (const item of items) await prisma.item.create({ data: { eventId: event.id, ...item } })
  // Der erste Punkt läuft seit 50 Minuten (überzogen - Fortschreiben rechnet bei jeder Anfrage mit).
  const first = await prisma.item.findFirstOrThrow({ where: { eventId: event.id, trackId: main.id, sortOrder: 1 } })
  await prisma.item.update({ where: { id: first.id }, data: { status: 'RUNNING', actualStart: new Date(now - 50 * MINUTE) } })

  // Gast-Sitzungen wie nach der Code-Eingabe: Token im Cookie, in der Datenbank nur der Hash.
  const cookies = []
  if (ACCESS === 'CODE') {
    for (let i = 0; i < GUESTS; i++) {
      const token = randomBytes(32).toString('base64url')
      await prisma.guestSession.create({
        data: { eventId: event.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(now + 2 * 24 * 60 * MINUTE) }
      })
      cookies.push(`__Host-guest-${event.id}=${token}`)
    }
  }
  return { event, cookies, mainTrackId: main.id }
}

/** Eine Anfrage wie useGuestView: If-None-Match mit dem letzten ETag. */
async function poll(slug, guest) {
  const started = performance.now()
  try {
    const response = await fetch(`${BASE}/api/view/${slug}`, {
      headers: { 'If-None-Match': guest.etag, ...(guest.cookie ? { cookie: guest.cookie } : {}) }
    })
    if (response.status === 200) {
      await response.json()
      guest.etag = response.headers.get('etag') ?? ''
    } else {
      await response.arrayBuffer()
    }
    return { status: response.status, ms: performance.now() - started }
  } catch (error) {
    return { status: `Fehler: ${error.cause?.code ?? error.message}`, ms: performance.now() - started }
  }
}

/** Die Moderatorin: abwechselnd Verspätung melden, nächsten Punkt starten, Meldung zurücknehmen. */
async function moderate(prisma, event, mainTrackId, step) {
  const items = await prisma.item.findMany({ where: { eventId: event.id, trackId: mainTrackId }, orderBy: { sortOrder: 'asc' } })
  const next = items.find(item => !item.actualStart)
  if (!next) return
  const now = new Date()
  await prisma.$transaction(async tx => {
    await tx.event.update({ where: { id: event.id }, data: { liveVersion: { increment: 1 } } })
    if (step % 3 === 0) await tx.item.update({ where: { id: next.id }, data: { reportedDelayMin: (next.reportedDelayMin ?? 0) + 10, reportedAt: now, version: { increment: 1 } } })
    else if (step % 3 === 1) await tx.item.update({ where: { id: next.id }, data: { reportedDelayMin: null, reportedAt: now, version: { increment: 1 } } })
    else {
      const running = items.find(item => item.actualStart && !item.actualEnd)
      if (running) await tx.item.update({ where: { id: running.id }, data: { actualEnd: now, status: 'DONE', version: { increment: 1 } } })
      await tx.item.update({ where: { id: next.id }, data: { actualStart: now, status: 'RUNNING', reportedDelayMin: null, version: { increment: 1 } } })
    }
  })
}

async function burst(slug, guests, label) {
  const samples = await Promise.all(guests.map(guest => poll(slug, guest)))
  return summarize(label, samples)
}

async function main() {
  console.log(`Lasttest: ${GUESTS} Gäste, ${DURATION_S} s, Zugang ${ACCESS}, Instanz ${BASE}`)
  rmSync('prisma/load.db', { force: true })
  rmSync('prisma/load.db-journal', { force: true })
  execSync('npx prisma db push --skip-generate', { env, stdio: 'ignore' })
  const server = spawn('npx', ['next', 'start', '-H', '127.0.0.1', '-p', String(PORT)], { env, stdio: ['ignore', 'ignore', 'inherit'], detached: true })
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } })
  const results = []
  try {
    await waitForServer()
    const { event, cookies, mainTrackId } = await seed(prisma)
    const guests = Array.from({ length: GUESTS }, (_, i) => ({ etag: '', cookie: cookies[i] ?? null }))

    // Vorlauf: jede*r lädt einmal (erstes HTML), dann Ansturm ohne Änderung (alles 304).
    await Promise.all(guests.map(guest => poll(event.slug, guest)))
    results.push({ ...(await burst(event.slug, guests, 'Ansturm ohne Änderung')), burst: true })
    // "Weiter" (nächster Punkt startet): für Gäste immer sichtbar - alle bekommen einen neuen Stand.
    await moderate(prisma, event, mainTrackId, 2)
    results.push({ ...(await burst(event.slug, guests, 'Ansturm direkt nach einer Änderung')), burst: true })

    // Alltag: jede*r Gast alle 20-30 s, die Moderatorin alle 15 s.
    const samples = []
    const end = Date.now() + DURATION_S * 1000
    let step = 1
    const moderator = (async () => {
      while (Date.now() < end) {
        await sleep(15_000)
        if (Date.now() < end) await moderate(prisma, event, mainTrackId, step++)
      }
    })()
    await Promise.all(guests.map(async guest => {
      await sleep(Math.random() * 25_000)
      while (Date.now() < end) {
        samples.push(await poll(event.slug, guest))
        await sleep(20_000 + Math.random() * 10_000)
      }
    }))
    await moderator
    results.push({ ...summarize(`Alltag (${Math.round(samples.length / DURATION_S * 10) / 10} Anfragen/s, ${step} Änderungen)`, samples), burst: false })

    // Kontrolle: Nach der letzten Änderung stimmt der gespeicherte gezeigte Beginn (Hysterese) für alle Punkte.
    const unset = await prisma.item.count({ where: { eventId: event.id, guestShownStart: null, visibility: 'PUBLIC', track: { visibility: 'PUBLIC' } } })
    console.log(`Öffentliche Punkte ohne gespeicherten gezeigten Beginn: ${unset}`)
  } finally {
    await prisma.$disconnect()
    try { process.kill(-server.pid) } catch { /* schon beendet */ }
  }

  const failures = results.filter(r => Object.keys(r.statuses).some(s => s !== '200' && s !== '304'))
  const slow = results.filter(r => (r.burst ? r.p99 > BURST_P99_LIMIT_MS : r.p95 > P95_LIMIT_MS))
  if (failures.length > 0) console.error(`FEHLER: andere Antworten als 200/304 in: ${failures.map(r => r.label).join(', ')}`)
  if (slow.length > 0) console.error(`ZU LANGSAM (Alltag p95 > ${P95_LIMIT_MS} ms, Ansturm p99 > ${BURST_P99_LIMIT_MS} ms): ${slow.map(r => r.label).join(', ')}`)
  process.exit(failures.length > 0 || slow.length > 0 ? 1 : 0)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
