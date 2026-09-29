import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  BASE_URL, cookieOf, createAccount, createEventRecord, createItemRecord, createTrackRecord, login, prisma, SUMMER_DAY, uniqueSlug
} from './helpers'
import { zonedDateToUtc } from '../../app/lib/timezone'

// Gästeansicht, Tafel, Polling-Endpunkt, Reihen-Übersicht, QR-Code und Team-Ansicht (Phase 3, docs/KONZEPT.md
// Abschnitt 5). Kern der Phase: TEAM-/SECRET-Inhalte und interne Notizen erscheinen nie in HTML oder JSON für
// Gäste - geprüft an der rohen Antwort, jeweils mit Positivkontrolle.

const MINUTE = 60_000

/** Jetzt, auf die Minute abgerundet - Planzeiten in den Tests liegen so auf vollen Minuten. */
function minuteNow(): number {
  return Math.floor(Date.now() / MINUTE) * MINUTE
}

/** Heute (Berlin) als Eventtag. */
function today(): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())
  return zonedDateToUtc(day)!
}

function berlin(date: Date | number): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

/** Alles, was Gäste zu sehen bekommen: HTML und RSC-Daten von Seite und Tafel, dazu das JSON des Endpunkts. */
async function everythingForGuests(request: APIRequestContext, slug: string, cookie?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = cookie ? { cookie } : {}
  const result: Record<string, string> = {}
  for (const path of [`/${slug}`, `/${slug}/tafel`]) {
    result[`${path} (HTML)`] = await (await request.get(path, { headers })).text()
    result[`${path} (RSC)`] = await (await request.get(path, { headers: { ...headers, RSC: '1' } })).text()
  }
  result[`/api/view/${slug}`] = await (await request.get(`/api/view/${slug}`, { headers })).text()
  return result
}

async function publishedWithOneItem(title = 'Trauung') {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'PUBLISHED', date: today(), title: 'Hochzeit Sommer' })
  const track = await createTrackRecord(event.id)
  const item = await createItemRecord(event, track.id, { title, start: new Date(minuteNow() + 60 * MINUTE), durationMin: 45, sortOrder: 1, location: 'Kirche' })
  return { owner, event, track, item }
}

test('Entwurf und Archiv: 404 ohne Zugriff (Seite, Tafel, JSON), Vorschau für Konten mit Zugriff; sonst für alle', async ({ page, request, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { title: 'Geheimes Fest', date: SUMMER_DAY })
  const track = await createTrackRecord(event.id)
  await createItemRecord(event, track.id, { title: 'Punkt im Entwurf', start: '14:00', sortOrder: 1 })

  for (const status of ['DRAFT', 'ARCHIVED'] as const) {
    await prisma.event.update({ where: { id: event.id }, data: { status } })
    for (const path of [`/${event.slug}`, `/${event.slug}/tafel`, `/api/view/${event.slug}`]) {
      const response = await request.get(path)
      expect(response.status(), `${status} ${path}`).toBe(404)
      const body = await response.text()
      expect(body, `${status} ${path}`).not.toContain('Geheimes Fest')
      expect(body, `${status} ${path}`).not.toContain('Punkt im Entwurf')
    }
  }

  // Vorschau für das besitzende Konto - mit Hinweis, und der Stand landet nicht im Browser-Speicher.
  const ownerPage = await browser.newPage()
  await login(ownerPage, owner.email)
  expect((await ownerPage.goto(`/${event.slug}`))?.status()).toBe(200)
  await expect(ownerPage.getByText('Vorschau: Dieses Event ist „Archiviert“')).toBeVisible()
  await expect(ownerPage.getByText('Punkt im Entwurf')).toBeVisible()
  expect(await ownerPage.evaluate(slug => localStorage.getItem(`zeitplan-ablauf:${slug}`), event.slug)).toBeNull()
  const preview = await ownerPage.request.get(`/api/view/${event.slug}`, { headers: { cookie: await cookieOf(ownerPage) } })
  expect(preview.status()).toBe(200)
  await ownerPage.close()

  // Positivkontrolle: veröffentlicht, live und beendet sieht es jede*r, ohne Vorschau-Hinweis.
  for (const status of ['PUBLISHED', 'LIVE', 'ENDED'] as const) {
    await prisma.event.update({ where: { id: event.id }, data: { status } })
    expect((await page.goto(`/${event.slug}`))?.status(), status).toBe(200)
    await expect(page.getByRole('heading', { name: 'Geheimes Fest' })).toBeVisible()
    await expect(page.getByText('Punkt im Entwurf')).toBeVisible()
    await expect(page.getByText('Vorschau:')).toHaveCount(0)
    expect((await request.get(`/${event.slug}/tafel`)).status(), status).toBe(200)
  }
  await expect(page.getByText('Das Event ist vorbei')).toBeVisible()
  // Gäste haben kein Konto - kein "Anmelden" in der Kopfzeile.
  await expect(page.getByRole('link', { name: 'Anmelden' })).toHaveCount(0)

  expect((await request.get('/gibt-es-nicht-xyz')).status()).toBe(404)
  expect((await request.get('/api/view/gibt-es-nicht-xyz')).status()).toBe(404)
})

test('keine TEAM-/SECRET-Inhalte und keine internen Notizen in HTML oder JSON für Gäste - die Team-Ansicht zeigt sie', async ({ page, request, browser }) => {
  const owner = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const event = await createEventRecord(owner.id, { status: 'LIVE', date: today(), title: 'Hochzeit mit Geheimnissen' })
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  const main = await createTrackRecord(event.id, { name: 'Ablauf', sortOrder: 1 })
  const teamTrack = await createTrackRecord(event.id, { name: 'SPURNAME-TECHNIK-XYZ', visibility: 'TEAM', sortOrder: 2 })
  const base = minuteNow()
  const at = (min: number) => new Date(base + min * MINUTE)

  await createItemRecord(event, main.id, { title: 'Trauung', start: at(-10), durationMin: 45, sortOrder: 1, location: 'Kirche St. Anna', description: 'Bitte pünktlich', internalNote: 'NOTIZ-TRAUUNG-XYZ' })
  const team = await createItemRecord(event, main.id, {
    title: 'TEAM-AUFBAU-XYZ', start: at(35), durationMin: 15, sortOrder: 2, visibility: 'TEAM', location: 'TEAM-ORT-XYZ', description: 'TEAM-BESCHREIBUNG-XYZ', internalNote: 'TEAM-NOTIZ-XYZ'
  })
  const secret = await createItemRecord(event, main.id, {
    title: 'GEHEIM-FLASHMOB-XYZ', start: at(50), durationMin: 10, sortOrder: 3, visibility: 'SECRET', location: 'GEHEIM-ORT-XYZ', description: 'GEHEIM-BESCHREIBUNG-XYZ', internalNote: 'GEHEIM-NOTIZ-XYZ', secretViewers: [moderator.id]
  })
  const onTeamTrack = await createItemRecord(event, teamTrack.id, { title: 'SPUR-LICHTPROBE-XYZ', start: at(0), sortOrder: 1, location: 'SPUR-ORT-XYZ' })
  const deferred = await createItemRecord(event, main.id, { title: 'ZURUECKGESTELLT-REDE-XYZ', start: at(60), sortOrder: 4, status: 'DEFERRED' })
  await createItemRecord(event, main.id, { title: 'Kutschfahrt', start: at(90), sortOrder: 5, status: 'CANCELLED', cancelReason: 'Regen', internalNote: 'AUSFALL-NOTIZ-XYZ' })
  await createItemRecord(event, main.id, { title: 'Sektempfang', start: at(100), sortOrder: 6, location: 'Garten' })

  const forbidden = [
    'NOTIZ-TRAUUNG-XYZ', 'TEAM-AUFBAU-XYZ', 'TEAM-ORT-XYZ', 'TEAM-BESCHREIBUNG-XYZ', 'TEAM-NOTIZ-XYZ',
    'GEHEIM-FLASHMOB-XYZ', 'GEHEIM-ORT-XYZ', 'GEHEIM-BESCHREIBUNG-XYZ', 'GEHEIM-NOTIZ-XYZ', 'SPURNAME-TECHNIK-XYZ',
    'SPUR-LICHTPROBE-XYZ', 'SPUR-ORT-XYZ', 'ZURUECKGESTELLT-REDE-XYZ', 'AUSFALL-NOTIZ-XYZ', 'Geheimer Punkt',
    team.id, secret.id, onTeamTrack.id, deferred.id, teamTrack.id, 'internalNote', moderator.email
  ]
  const responses = await everythingForGuests(request, event.slug)
  for (const [source, body] of Object.entries(responses)) {
    for (const text of forbidden) expect(body, `${text} in ${source}`).not.toContain(text)
    // Positivkontrolle: Die öffentlichen Punkte sind in jeder Antwort.
    for (const text of ['Trauung', 'Kutschfahrt']) expect(body, `${text} in ${source}`).toContain(text)
  }
  expect(responses[`/${event.slug} (HTML)`]).toContain('Kirche St. Anna')

  // Auch ein angemeldetes Konto mit Zugriff bekommt als "Gast" nur die Gästedaten.
  const ownerPage = await browser.newPage()
  await login(ownerPage, owner.email)
  for (const [source, body] of Object.entries(await everythingForGuests(ownerPage.request, event.slug, await cookieOf(ownerPage)))) {
    for (const text of forbidden) expect(body, `${text} in ${source} (Konto)`).not.toContain(text)
  }

  // Sichtbar für Gäste: ausgefallen durchgestrichen mit Grund.
  await page.goto(`/${event.slug}`)
  await expect(page.locator('[data-item-status="cancelled"]')).toContainText('Kutschfahrt')
  await expect(page.locator('[data-item-status="cancelled"]')).toContainText('Regen')

  // Team-Ansicht: Team-Punkte, Notizen, Team-Spur; geheimer Punkt für die Besitzerin nur als Platzhalter ...
  await ownerPage.goto(`/admin/events/${event.id}/team`)
  for (const text of ['TEAM-AUFBAU-XYZ', 'Notiz: NOTIZ-TRAUUNG-XYZ', 'SPUR-LICHTPROBE-XYZ', 'ZURUECKGESTELLT-REDE-XYZ', 'Grund: Regen']) {
    await expect(ownerPage.getByText(text)).toBeVisible()
  }
  await expect(ownerPage.getByText('Geheimer Punkt')).toBeVisible()
  expect(await ownerPage.content()).not.toContain('GEHEIM-FLASHMOB-XYZ')
  // ... für die eingetragene Moderatorin mit Inhalt.
  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  await modPage.goto(`/admin/events/${event.id}/team`)
  await expect(modPage.getByText('GEHEIM-FLASHMOB-XYZ')).toBeVisible()
  await expect(modPage.getByText('Notiz: GEHEIM-NOTIZ-XYZ')).toBeVisible()
  await ownerPage.close()
  await modPage.close()
})

test('Prognose für Gäste: laufender Punkt hervorgehoben, neue Uhrzeit mit „ca.“, gezeigter Beginn gespeichert', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'LIVE', date: today() })
  const track = await createTrackRecord(event.id)
  const base = minuteNow()
  // Trauung sollte vor 30 Min beginnen, hat vor 20 Min begonnen (10 Min später) und dauert 45 Min.
  await createItemRecord(event, track.id, { title: 'Trauung', start: new Date(base - 30 * MINUTE), durationMin: 45, sortOrder: 1, actualStart: new Date(base - 20 * MINUTE), status: 'RUNNING' })
  const sekt = await createItemRecord(event, track.id, { title: 'Sektempfang', start: new Date(base + 15 * MINUTE), durationMin: 30, sortOrder: 2 })
  // Weit weg (jenseits des Horizonts von 120 Min): Gäste sehen die Planzeit.
  const essen = await createItemRecord(event, track.id, { title: 'Abendessen', start: new Date(base + 180 * MINUTE), durationMin: 60, sortOrder: 3, isAnchor: true })

  await page.goto(`/${event.slug}`)
  const now = page.locator('[data-item-status="now"]')
  await expect(now).toContainText('Trauung')
  await expect(page.getByRole('heading', { name: 'Jetzt' })).toBeVisible()

  // Sektempfang rutscht um 10 Min: Gäste sehen die neue, auf 5 Min gerundete Uhrzeit mit "ca." - ohne "+10".
  const expected = Math.round((base + 25 * MINUTE) / (5 * MINUTE)) * 5 * MINUTE
  const sektRow = page.locator('li', { hasText: 'Sektempfang' })
  await expect(page.getByRole('heading', { name: 'Als Nächstes' })).toBeVisible()
  await expect(sektRow).toContainText(`neu:ca. ${berlin(expected)}`)
  await expect(sektRow).not.toContainText('+10')
  await expect(page.locator('li', { hasText: 'Abendessen' })).toContainText(berlin(base + 180 * MINUTE))
  await expect(page.locator('li', { hasText: 'Abendessen' })).not.toContainText('ca.')

  // Für die Hysterese gespeichert: der gezeigte Beginn.
  expect((await prisma.item.findUniqueOrThrow({ where: { id: sekt.id } })).guestShownStart?.getTime()).toBe(expected)
  expect((await prisma.item.findUniqueOrThrow({ where: { id: essen.id } })).guestShownStart?.getTime()).toBe(base + 180 * MINUTE)

  // Mit "+10 zeigen" steht die Abweichung dabei.
  await prisma.event.update({ where: { id: event.id }, data: { showDelayToGuests: true } })
  await page.reload()
  await expect(sektRow).toContainText(`ca. ${berlin(expected)}`)
  await expect(sektRow).toContainText(`+${Math.round((expected - (base + 15 * MINUTE)) / MINUTE)}`)
})

test('Polling-Endpunkt: ETag und 304, neuer Inhalt nach Änderung in der Datenbank, keine Caches', async ({ request }) => {
  const { event, item } = await publishedWithOneItem('Alter Titel')
  const first = await request.get(`/api/view/${event.slug}`)
  expect(first.status()).toBe(200)
  const etag = first.headers()['etag']
  expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/)
  expect(first.headers()['cache-control']).toBe('no-store')
  expect(first.headers()['x-robots-tag']).toBe('noindex, nofollow')
  expect(first.headers()['x-frame-options']).toBe('DENY')
  const body = await first.json()
  expect(body.items.map((i: { title: string }) => i.title)).toEqual(['Alter Titel'])
  expect(Object.keys(body.items[0]).sort()).toEqual([
    'approximate', 'cancelReason', 'delayMin', 'description', 'id', 'location', 'plannedStart', 'shownStart', 'status', 'title', 'track'
  ])

  const unchanged = await request.get(`/api/view/${event.slug}`, { headers: { 'If-None-Match': etag } })
  expect(unchanged.status()).toBe(304)
  expect(unchanged.headers()['etag']).toBe(etag)

  await prisma.item.update({ where: { id: item.id }, data: { title: 'Neuer Titel' } })
  const changed = await request.get(`/api/view/${event.slug}`, { headers: { 'If-None-Match': etag } })
  expect(changed.status()).toBe(200)
  expect(changed.headers()['etag']).not.toBe(etag)
  expect((await changed.json()).items[0].title).toBe('Neuer Titel')

  // Auch eine geänderte Einstellung (ohne Änderung an den Punkten) ergibt einen neuen Stand.
  await prisma.event.update({ where: { id: event.id }, data: { title: 'Neuer Eventtitel' } })
  expect((await request.get(`/api/view/${event.slug}`, { headers: { 'If-None-Match': changed.headers()['etag'] } })).status()).toBe(200)
})

test('Gästeansicht aktualisiert sich nach einer Änderung in der Datenbank; ohne Verbindung bleibt der Stand mit Hinweis', async ({ page, context }) => {
  const { event, item } = await publishedWithOneItem('Alter Titel')
  await page.clock.install()
  await page.goto(`/${event.slug}`)
  await expect(page.getByText('Alter Titel')).toBeVisible()

  await prisma.item.update({ where: { id: item.id }, data: { title: 'Neuer Titel' } })
  await page.clock.fastForward(31_000)
  await expect(page.getByText('Neuer Titel')).toBeVisible()
  await expect(page.getByText('Alter Titel')).toHaveCount(0)

  // Ohne Verbindung: letzter Stand bleibt stehen, mit "Stand: HH:MM, keine Verbindung".
  await context.setOffline(true)
  await page.clock.fastForward(31_000)
  await expect(page.getByText(/^Stand: \d{2}:\d{2}, keine Verbindung$/)).toBeVisible()
  await expect(page.getByText('Neuer Titel')).toBeVisible()

  // Wieder online (sofort beim Zurückkehren): Hinweis weg.
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText(/keine Verbindung/)).toHaveCount(0)

  // Wird das Event zurück zum Entwurf gesetzt, verschwindet der Ablauf auch aus der offenen Seite.
  await prisma.event.update({ where: { id: event.id }, data: { status: 'DRAFT' } })
  await page.clock.fastForward(31_000)
  await expect(page.getByText('Dieser Ablauf ist gerade nicht verfügbar.')).toBeVisible()
  await expect(page.getByText('Neuer Titel')).toHaveCount(0)
  expect(await page.evaluate(slug => localStorage.getItem(`zeitplan-ablauf:${slug}`), event.slug)).toBeNull()
})

test('ohne Verbindung neu geladen: die Offline-Seite zeigt den gemerkten Stand der Gästeansicht', async ({ page, context }) => {
  const { event } = await publishedWithOneItem('Gemerkter Punkt')
  await page.goto(`/${event.slug}`)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
  const stored = await page.evaluate(slug => JSON.parse(localStorage.getItem(`zeitplan-ablauf:${slug}`) ?? 'null'), event.slug)
  expect(stored.payload.items[0].title).toBe('Gemerkter Punkt')

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Hochzeit Sommer' })).toBeVisible()
  await expect(page.getByText(/^Stand: \d{2}:\d{2}, keine Verbindung$/)).toBeVisible()
  await expect(page.getByText('Gemerkter Punkt')).toBeVisible()
  await expect(page.getByText('Kirche')).toBeVisible()

  // Andere Seiten (ohne gemerkten Stand) zeigen weiter die normale Offline-Seite.
  await page.goto('/anderes-event-ohne-stand')
  await expect(page.getByRole('heading', { name: 'Du bist offline' })).toBeVisible()
  await context.setOffline(false)
})

async function boardFits(page: Page) {
  return page.evaluate(() => {
    const board = document.querySelector('[data-board]') as HTMLElement
    const rows = [...board.querySelectorAll('li')].map(li => li.getBoundingClientRect().bottom)
    return {
      boardOverflow: board.scrollHeight > board.clientHeight,
      pageScroll: document.scrollingElement!.scrollHeight > window.innerHeight,
      rowsInside: rows.every(bottom => bottom <= window.innerHeight),
      rows: rows.length
    }
  })
}

test('Tafel: auf 1920×1080 ohne Scrollen, jetzt und die nächsten Punkte, Uhr', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'LIVE', date: today(), title: 'Hochzeit von Kim und Alex mit einem wirklich sehr langen Titel für die Tafel' })
  const a = await createTrackRecord(event.id, { name: 'Gäste', sortOrder: 1 })
  const b = await createTrackRecord(event.id, { name: 'Brautpaar', sortOrder: 2 })
  const base = minuteNow()
  const long = 'mit einem ausgesprochen langen Titel, der auf keiner Tafel in eine Zeile passt und trotzdem nicht scrollen darf'
  await createItemRecord(event, a.id, { title: `Sektempfang ${long}`, start: new Date(base - 10 * MINUTE), durationMin: 40, sortOrder: 1, location: 'Garten hinter dem Haus', actualStart: new Date(base - 10 * MINUTE), status: 'RUNNING' })
  await createItemRecord(event, b.id, { title: `Fotoshooting ${long}`, start: new Date(base - 5 * MINUTE), durationMin: 40, sortOrder: 1, location: 'Am See', actualStart: new Date(base - 5 * MINUTE), status: 'RUNNING' })
  for (let i = 0; i < 10; i++) {
    await createItemRecord(event, a.id, { title: `Programmpunkt ${i + 1} ${long}`, start: new Date(base + (40 + i * 30) * MINUTE), durationMin: 30, sortOrder: i + 2, location: `Ort ${i + 1}` })
  }

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport)
    await page.goto(`/${event.slug}/tafel`)
    await expect(page.getByRole('heading', { name: 'Jetzt' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Als Nächstes' })).toBeVisible()
    await expect(page.getByLabel('Uhrzeit')).toHaveText(/^\d{2}:\d{2}$/)
    await expect(page.locator('[data-item-status="now"]')).toHaveCount(2)
    // Jetzt zwei laufende Punkte, darunter die nächsten drei.
    await expect(page.locator('[data-board] li')).toHaveCount(5)
    await expect(page.locator('[data-board]')).toContainText('Programmpunkt 3')
    await expect(page.locator('[data-board]')).not.toContainText('Programmpunkt 4')
    expect(await boardFits(page), `${viewport.width}×${viewport.height}`).toEqual({ boardOverflow: false, pageScroll: false, rowsInside: true, rows: 5 })
    // Kopf- und Fußzeile liegen unter der Tafel; kein Anmelde-Link auf der Tafel.
    await expect(page.getByRole('link', { name: 'Anmelden' })).toHaveCount(0)
  }

  // Nur ein laufender Punkt (zwei Zeilen Titel): darunter die nächsten vier - passt ebenfalls.
  await prisma.item.updateMany({ where: { eventId: event.id, title: { startsWith: 'Fotoshooting' } }, data: { actualEnd: new Date(), status: 'DONE' } })
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport)
    await page.goto(`/${event.slug}/tafel`)
    await expect(page.locator('[data-item-status="now"]')).toHaveCount(1)
    await expect(page.locator('[data-board]')).toContainText('Programmpunkt 4')
    expect(await boardFits(page), `${viewport.width}×${viewport.height}, ein Punkt`).toEqual({ boardOverflow: false, pageScroll: false, rowsInside: true, rows: 5 })
  }
})

test('Reihen-Übersicht: nur Events, die Gäste sehen können, mit Link; Event verweist zurück', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const series = await prisma.series.create({ data: { slug: uniqueSlug('reihe'), title: 'Hochzeitswochenende', ownerId: owner.id } })
  const polterabend = await createEventRecord(owner.id, { title: 'Polterabend', status: 'ENDED', date: SUMMER_DAY, seriesId: series.id })
  await createEventRecord(owner.id, { title: 'Die Hochzeit', status: 'LIVE', date: new Date(SUMMER_DAY.getTime() + 24 * 60 * MINUTE), seriesId: series.id })
  await createEventRecord(owner.id, { title: 'Brunch im Entwurf', status: 'DRAFT', seriesId: series.id })
  await createEventRecord(owner.id, { title: 'Archiviertes Grillen', status: 'ARCHIVED', seriesId: series.id })

  const response = await page.goto(`/${series.slug}`)
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Hochzeitswochenende' })).toBeVisible()
  const links = page.getByRole('main').getByRole('link')
  await expect(links).toHaveCount(2)
  await expect(links.nth(0)).toContainText('Polterabend')
  await expect(links.nth(0)).toContainText('Samstag, 20. Juni 2026')
  await expect(links.nth(1)).toContainText('Die Hochzeit')
  const html = await response!.text()
  expect(html).not.toContain('Brunch im Entwurf')
  expect(html).not.toContain('Archiviertes Grillen')

  await links.nth(0).click()
  await expect(page).toHaveURL(`${BASE_URL}/${polterabend.slug}`)
  await page.getByRole('link', { name: 'Hochzeitswochenende' }).click()
  await expect(page).toHaveURL(`${BASE_URL}/${series.slug}`)
  expect((await page.request.get(`/${series.slug}/tafel`)).status()).toBe(404)
})

test('Geschützter Zugang: ohne Konto kein Inhalt - auch nicht über den Polling-Endpunkt; Vorschau mit Zugriff', async ({ request, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'PUBLISHED', access: 'CODE', date: SUMMER_DAY, title: 'Geschützte Hochzeit' })
  const track = await createTrackRecord(event.id)
  await createItemRecord(event, track.id, { title: 'GESCHUETZTER-PUNKT-XYZ', start: '14:00', sortOrder: 1, location: 'GESCHUETZTER-ORT-XYZ' })

  const api = await request.get(`/api/view/${event.slug}`)
  expect(api.status()).toBe(403)
  for (const [source, body] of Object.entries(await everythingForGuests(request, event.slug))) {
    expect(body, source).not.toContain('GESCHUETZTER-PUNKT-XYZ')
    expect(body, source).not.toContain('GESCHUETZTER-ORT-XYZ')
  }
  const page = await browser.newPage()
  await page.goto(`/${event.slug}`)
  await expect(page.getByText('Dieser Ablauf ist nur mit Zugang sichtbar.')).toBeVisible()

  // Positivkontrolle: das besitzende Konto sieht die Vorschau, auch über den Endpunkt.
  await login(page, owner.email)
  await page.goto(`/${event.slug}`)
  await expect(page.getByText('Vorschau: Gäste sehen diesen Ablauf nur mit Zugang.')).toBeVisible()
  await expect(page.getByText('GESCHUETZTER-PUNKT-XYZ')).toBeVisible()
  expect((await page.request.get(`/api/view/${event.slug}`, { headers: { cookie: await cookieOf(page) } })).status()).toBe(200)
  await page.close()
})

test('QR-Code und Links in der Verwaltung: für Konten mit Zugriff, kodiert die Gästeadresse', async ({ page, browser }) => {
  const { owner, event } = await publishedWithOneItem()
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}`)
  await expect(page.getByLabel('Link für Gäste')).toHaveValue(`${BASE_URL}/${event.slug}`)
  await expect(page.getByLabel('Link für die Anzeigetafel (Beamer, TV)')).toHaveValue(`${BASE_URL}/${event.slug}/tafel`)
  await page.getByRole('link', { name: 'QR-Code zum Ausdrucken' }).click()
  await expect(page.getByText(`${BASE_URL}/${event.slug}`)).toBeVisible()
  const src = await page.getByRole('img', { name: /^QR-Code:/ }).getAttribute('src')
  expect(src).toMatch(/^data:image\/svg\+xml;base64,/)
  expect(Buffer.from(src!.split(',')[1], 'base64').toString()).toContain('<svg')
  await expect(page.getByRole('link', { name: 'QR-Code als SVG herunterladen' })).toHaveAttribute('download', `qr-${event.slug}.svg`)

  // Fremdes Konto: 404 für QR-Code und Team-Ansicht.
  const stranger = await createAccount('CREATOR')
  const other = await browser.newPage()
  await login(other, stranger.email)
  for (const path of [`/admin/events/${event.id}/qr`, `/admin/events/${event.id}/team`]) {
    expect((await other.goto(path))?.status(), path).toBe(404)
  }
  await other.close()
})

test('Team-Ansicht: minutengenau, Konflikte mit Ankern, für freigegebene Moderator*innen', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const moderator = await createAccount('MODERATOR')
  const event = await createEventRecord(owner.id, { status: 'PUBLISHED', date: SUMMER_DAY, title: 'Konfliktfest' })
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  const track = await createTrackRecord(event.id)
  await createItemRecord(event, track.id, { title: 'Kaffee und Kuchen', start: '16:30', durationMin: 100, sortOrder: 1, internalNote: 'Torte kommt 16:15' })
  await createItemRecord(event, track.id, { title: 'Abendessen', start: '18:00', durationMin: 90, sortOrder: 2, isAnchor: true })

  await login(page, moderator.email)
  await page.goto(`/admin/events/${event.id}`)
  await page.getByRole('link', { name: 'Team-Ansicht' }).click()
  await expect(page.getByRole('heading', { name: /Team-Ansicht/ })).toBeVisible()
  await expect(page.getByText('„Kaffee und Kuchen“ überschneidet „Abendessen“ um 10 Min – kürzen?')).toBeVisible()
  await expect(page.getByText('Notiz: Torte kommt 16:15')).toBeVisible()
  const kaffee = page.locator('li[data-item]', { hasText: 'Kaffee und Kuchen' })
  await expect(kaffee).toContainText('16:30')
  await expect(kaffee).toContainText('bis 18:10')
  await expect(page.locator('li[data-item]', { hasText: 'Abendessen' })).toContainText('Anker')
})
