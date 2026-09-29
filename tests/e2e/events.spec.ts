import { expect, test, type Page } from '@playwright/test'
import {
  createAccount, createEventRecord, locationOf, login, pageAlert, prisma, readForm, submitForm, uniqueSlug
} from './helpers'

// Events und Freigaben (Phase 0, nach dem Vorbild von Seating): Anlegen, Einstellungen, Freigeben,
// Löschen. Jeder Angriffsfall mit Positivkontrolle durch ein berechtigtes Konto. Anders als in Seating
// ändert eine Freigabe nichts an den Einstellungen (docs/KONZEPT.md Abschnitt 7).

async function loggedIn(page: Page, role: 'ADMIN' | 'CREATOR' | 'MODERATOR' = 'CREATOR') {
  const user = await createAccount(role)
  await login(page, user.email)
  return user
}

test('Event anlegen: Adresse aus dem Titel, Tag in UTC, Entwurf', async ({ page }) => {
  const user = await loggedIn(page)
  const title = `Hochzeit ${Date.now()}`

  await page.goto('/admin/events/new')
  await page.getByLabel('Titel').fill(title)
  await expect(page.getByLabel('Adresse')).toHaveValue(`hochzeit-${title.split(' ')[1]}`)
  await page.getByLabel('Datum').fill('2026-10-24')
  await page.getByRole('button', { name: 'Event anlegen' }).click()
  await expect(page).toHaveURL(/\/admin\/events\/[a-z0-9]+\?created=1$/)
  await expect(page.getByText('Event angelegt.')).toBeVisible()
  await expect(page.getByText('Samstag, 24. Oktober 2026')).toBeVisible()

  const event = await prisma.event.findFirstOrThrow({ where: { ownerId: user.id } })
  expect(event).toMatchObject({ title, status: 'DRAFT', timezone: 'Europe/Berlin' })
  // Mitternacht in Berlin (Sommerzeit) als UTC-Zeitpunkt.
  expect(event.date.toISOString()).toBe('2026-10-23T22:00:00.000Z')
})

test('Adresse: reserviert, ungültig und doppelt werden serverseitig abgelehnt', async ({ page }) => {
  const user = await loggedIn(page)
  const taken = await createEventRecord(user.id, { slug: uniqueSlug('vergeben') })

  async function tryCreate(slug: string) {
    await page.goto('/admin/events/new')
    await page.getByLabel('Titel').fill('Test')
    await page.getByLabel('Adresse').evaluate(el => el.removeAttribute('pattern'))
    await page.getByLabel('Adresse').fill(slug)
    await page.getByLabel('Datum').fill('2026-10-24')
    await page.getByRole('button', { name: 'Event anlegen' }).click()
  }

  await tryCreate('admin')
  await expect(pageAlert(page)).toContainText('reserviert')
  await tryCreate('tafel')
  await expect(pageAlert(page)).toContainText('reserviert')
  await tryCreate('Mit Leerzeichen')
  await expect(pageAlert(page)).toContainText('Kleinbuchstaben')
  await tryCreate(taken.slug)
  await expect(pageAlert(page)).toContainText('schon vergeben')
  expect(await prisma.event.count({ where: { ownerId: user.id } })).toBe(1)
})

test('Einstellungen speichern', async ({ page }) => {
  const user = await loggedIn(page)
  const event = await createEventRecord(user.id, { slug: uniqueSlug('einstellungen') })

  await page.goto(`/admin/events/${event.id}`)
  await page.getByLabel('Titel').fill('Polterabend')
  await page.getByLabel('Datum').fill('2026-10-25')
  await page.getByLabel('Beschreibung (optional)').fill('Im Garten')
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible()

  const saved = await prisma.event.findUniqueOrThrow({ where: { id: event.id } })
  expect(saved).toMatchObject({ title: 'Polterabend', description: 'Im Garten', slug: event.slug })
  // Tag der Zeitumstellung: Mitternacht ist noch Sommerzeit.
  expect(saved.date.toISOString()).toBe('2026-10-24T22:00:00.000Z')
})

test('Freigabe: Moderator*in sieht das Event erst mit Freigabe - ändert, löscht und teilt aber nie', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const event = await createEventRecord(owner.id, { slug: uniqueSlug('freigabe') })
  const moderator = await createAccount('MODERATOR')
  const modPage = await browser.newPage()
  await login(modPage, moderator.email)

  // Formulare als Besitzer*in lesen (frischer Seitenaufruf, siehe readForm).
  await page.goto(`/admin/events/${event.id}`)
  const settings = await readForm(page, 'form:has(input[name="title"])')
  const share = await readForm(page, 'form:has(input[name="email"])')
  const remove = await readForm(page, 'form:has(button:text("Event löschen"))')

  // Ohne Freigabe: keine Seite, nicht in der Liste, keine Aktion.
  expect((await modPage.goto(`/admin/events/${event.id}`))?.status()).toBe(404)
  await modPage.goto('/admin/events')
  await expect(modPage.getByRole('link', { name: 'Testevent' })).toHaveCount(0)
  await submitForm(modPage, settings, { title: 'Übernommen' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe('Testevent')

  // Freigeben über die Oberfläche.
  await page.getByPlaceholder('E-Mail-Adresse des Kontos').fill(moderator.email)
  await page.getByRole('button', { name: 'Freigeben' }).click()
  await expect(page.getByText('Freigabe hinzugefügt.')).toBeVisible()

  await modPage.goto('/admin/events')
  await modPage.getByRole('link', { name: 'Testevent' }).click()
  await expect(modPage.getByRole('heading', { name: 'Freigegeben für dich' })).toBeVisible()
  await expect(modPage.getByRole('button', { name: 'Einstellungen speichern' })).toHaveCount(0)
  await expect(modPage.getByRole('heading', { name: 'Freigaben' })).toHaveCount(0)
  await expect(modPage.getByRole('heading', { name: 'Event löschen' })).toHaveCount(0)

  // Auch mit Freigabe wirken Einstellungen, Weiter-Freigeben und Löschen nicht (nachgespielt).
  const third = await createAccount('CREATOR')
  await submitForm(modPage, settings, { title: 'Von Moderation geändert' })
  await submitForm(modPage, share, { email: third.email })
  await submitForm(modPage, remove)
  const stored = await prisma.event.findUnique({ where: { id: event.id } })
  expect(stored?.title).toBe('Testevent')
  expect(await prisma.eventAccess.count({ where: { eventId: event.id, userId: third.id } })).toBe(0)

  // Positivkontrolle: dieselben POSTs als Besitzer*in wirken.
  await submitForm(page, settings, { title: 'Von Besitzer*in geändert' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe('Von Besitzer*in geändert')
  await submitForm(page, share, { email: third.email })
  expect(await prisma.eventAccess.count({ where: { eventId: event.id, userId: third.id } })).toBe(1)

  // Freigabe entziehen - danach wieder kein Zugriff.
  await page.goto(`/admin/events/${event.id}`)
  await page.getByRole('listitem').filter({ hasText: moderator.email }).getByRole('button', { name: 'Entfernen' }).click()
  await expect(page.getByText('Freigabe entfernt.')).toBeVisible()
  expect((await modPage.goto(`/admin/events/${event.id}`))?.status()).toBe(404)

  const deleted = await submitForm(page, remove)
  expect(locationOf(deleted)?.pathname).toBe('/admin/events')
  expect(await prisma.event.count({ where: { id: event.id } })).toBe(0)
  expect(await prisma.eventAccess.count({ where: { eventId: event.id } })).toBe(0)
})

test('Freigabe nur an bestehende Konten, nicht an die Besitzer*in selbst', async ({ page }) => {
  const owner = await loggedIn(page)
  const event = await createEventRecord(owner.id)
  await page.goto(`/admin/events/${event.id}`)

  await page.getByPlaceholder('E-Mail-Adresse des Kontos').fill('niemand@example.test')
  await page.getByRole('button', { name: 'Freigeben' }).click()
  await expect(pageAlert(page)).toContainText('kein Konto')

  await page.getByPlaceholder('E-Mail-Adresse des Kontos').fill(owner.email)
  await page.getByRole('button', { name: 'Freigeben' }).click()
  await expect(pageAlert(page)).toContainText('gehört das Event bereits')
  expect(await prisma.eventAccess.count({ where: { eventId: event.id } })).toBe(0)
})

test('Fremdes Konto: Seite 404, nachgespielte Aktionen wirkungslos, Admin darf alles', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const event = await createEventRecord(owner.id)
  await page.goto(`/admin/events/${event.id}`)
  const settings = await readForm(page, 'form:has(input[name="title"])')
  const share = await readForm(page, 'form:has(input[name="email"])')
  const unshareTarget = await createAccount('MODERATOR')
  const access = await prisma.eventAccess.create({ data: { eventId: event.id, userId: unshareTarget.id } })
  const unshare = await readForm(page, 'form:has(input[name="accessId"])')

  const stranger = await browser.newPage()
  const strangerAccount = await createAccount('CREATOR')
  await login(stranger, strangerAccount.email)
  expect((await stranger.goto(`/admin/events/${event.id}`))?.status()).toBe(404)
  await submitForm(stranger, settings, { title: 'Gekapert' })
  await submitForm(stranger, share, { email: strangerAccount.email })
  await submitForm(stranger, unshare)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe('Testevent')
  expect(await prisma.eventAccess.count({ where: { eventId: event.id, userId: strangerAccount.id } })).toBe(0)
  expect(await prisma.eventAccess.count({ where: { id: access.id } })).toBe(1)

  // Nicht angemeldet: Weiterleitung zum Login, keine Änderung.
  const anonymous = await browser.newPage()
  expect(locationOf(await submitForm(anonymous, settings, { title: 'Anonym' }))?.pathname).toBe('/login')
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe('Testevent')

  // Positivkontrolle: Admin ohne Freigabe.
  const admin = await browser.newPage()
  await login(admin, (await createAccount('ADMIN')).email)
  expect((await admin.goto(`/admin/events/${event.id}`))?.status()).toBe(200)
  await submitForm(admin, settings, { title: 'Vom Admin' })
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title).toBe('Vom Admin')
  await submitForm(admin, unshare)
  expect(await prisma.eventAccess.count({ where: { id: access.id } })).toBe(0)
})

test('Moderator*innen können keine Events anlegen - weder über die Seite noch nachgespielt', async ({ page, browser }) => {
  const creator = await loggedIn(page)
  await page.goto('/admin/events/new')
  const create = await readForm(page, 'form:has(input[name="title"])')

  const modPage = await browser.newPage()
  const moderator = await createAccount('MODERATOR')
  await login(modPage, moderator.email)
  await modPage.goto('/admin/events/new')
  await expect(modPage).toHaveURL(/\/admin\/events$/)
  await expect(modPage.getByRole('link', { name: 'Neues Event' })).toHaveCount(0)

  const slug = uniqueSlug('moderation')
  await submitForm(modPage, create, { title: 'Von Moderation', slug, date: '2026-10-24' })
  expect(await prisma.event.count({ where: { slug } })).toBe(0)

  // Positivkontrolle: derselbe POST als Creator legt das Event an.
  await submitForm(page, create, { title: 'Vom Creator', slug, date: '2026-10-24' })
  expect((await prisma.event.findUniqueOrThrow({ where: { slug } })).ownerId).toBe(creator.id)
})

test('Konto löschen: Events gehen an den löschenden Admin über', async ({ page }) => {
  const admin = await loggedIn(page, 'ADMIN')
  const creator = await createAccount('CREATOR')
  const event = await createEventRecord(creator.id)
  await page.goto('/admin/users')
  const deleteForm = await readForm(page, 'form:has(button:text("Löschen"))')
  await submitForm(page, deleteForm, { userId: creator.id })
  expect(await prisma.user.findUnique({ where: { id: creator.id } })).toBeNull()
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).ownerId).toBe(admin.id)
})
