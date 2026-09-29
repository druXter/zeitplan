import { expect, test } from '@playwright/test'

// Prüft die Header-Regeln aus next.config.ts - insbesondere die Reihenfolge (spätere Regel
// gewinnt): sensible Bereiche müssen ihre strengeren Werte behalten. Übernommen aus Seating: nur die
// Gästeansicht bzw. Reihen-Übersicht /<slug> ist einbettbar, alles andere nicht.

const PUBLIC = ['/', '/impressum', '/datenschutz']
const PRIVATE = ['/login', '/login/continue', '/forgot-password', '/reset-password', '/account', '/admin', '/admin/users', '/admin/events', '/admin/events/new', '/admin/events/x',
  '/admin/events/import', '/admin/events/x/plan', '/admin/events/x/items/new', '/admin/events/x/export', '/admin/events/x/team', '/admin/events/x/live',
  '/admin/events/x/qr', '/admin/series', '/admin/series/x']
// Einbettbar: nur /<slug> (Gästeansicht, Reihen-Übersicht).
const EMBEDDABLE = ['/irgendein-event']
// Tafel, Polling-Endpunkt und Dateien der App - ohne Einbetten.
const GUEST = ['/irgendein-event/tafel', '/api/view/irgendein-event', '/.well-known/suite-identity', '/manifest.webmanifest', '/icon.svg', '/apple-icon.png', '/favicon.ico']

async function headersOf(request: import('@playwright/test').APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 })
  return response.headers()
}

test('allgemeine Sicherheits-Header auf jeder Seite', async ({ request }) => {
  for (const path of [...PUBLIC, ...PRIVATE, ...EMBEDDABLE, ...GUEST, '/gibt-es/nicht', '/api/cron/cleanup']) {
    const h = await headersOf(request, path)
    expect(h['x-content-type-options'], path).toBe('nosniff')
    expect(h['strict-transport-security'], path).toBe('max-age=31536000')
    expect(h['permissions-policy'], path).toContain('camera=()')
  }
})

test('kein Einbetten - außer der Gästeansicht, auch nicht für Tafel und Endpunkt', async ({ request }) => {
  for (const path of [...PUBLIC, ...PRIVATE, ...GUEST, '/gibt-es/nicht', '/api/cron/cleanup', '/offline.html']) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'")
    expect(h['x-frame-options'], path).toBe('DENY')
  }
})

test('Gästeansicht /<slug> ist einbettbar: frame-ancestors *, kein X-Frame-Options', async ({ request }) => {
  for (const path of EMBEDDABLE) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toBe('frame-ancestors *')
    expect(h['x-frame-options'], path).toBeUndefined()
  }
})

test('öffentliche Seiten: normale Referrer-Policy, indexierbar', async ({ request }) => {
  for (const path of PUBLIC) {
    const h = await headersOf(request, path)
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
    expect(h['x-robots-tag'], path).toBeUndefined()
  }
})

test('sensible Seiten: noindex, kein Caching, kein Einbetten', async ({ request }) => {
  // Auch die Weiterleitung ohne Sitzung (/admin -> /login) trägt die Header.
  for (const path of PRIVATE) {
    const h = await headersOf(request, path)
    expect(h['x-robots-tag'], path).toBe('noindex, nofollow')
    expect(h['cache-control'], path).toContain('no-store')
    expect(h['content-security-policy'], path).toBe("frame-ancestors 'none'")
  }
})

test('Einmal-Links und Tafel-Links gehen nicht per Referer weiter', async ({ request }) => {
  const h = await headersOf(request, '/reset-password?token=abc')
  expect(h['referrer-policy']).toBe('no-referrer')
  expect(h['x-robots-tag']).toBe('noindex, nofollow')
  // Die Tafel eines geschützten Events trägt ihren Schlüssel in der URL - und bleibt dabei nicht einbettbar.
  const board = await headersOf(request, '/irgendein-event/tafel?k=abc')
  expect(board['referrer-policy']).toBe('no-referrer')
  expect(board['x-frame-options']).toBe('DENY')
  // Die Gästeansicht selbst behält die normale Referrer-Policy.
  expect((await headersOf(request, '/irgendein-event'))['referrer-policy']).toBe('strict-origin-when-cross-origin')
})

test('Föderations-Pfade: Referrer-Policy überschreibt die allgemeine Regel, kein Caching', async ({ request }) => {
  for (const path of ['/api/suite/authorize', '/api/suite/login', '/api/suite/callback']) {
    const h = await headersOf(request, path)
    expect(h['referrer-policy'], path).toBe('no-referrer')
    expect(h['x-content-type-options'], path).toBe('nosniff')
    expect(h['cache-control'], path).toContain('no-store')
    expect(h['x-frame-options'], path).toBe('DENY')
  }
  // Das Discovery-Dokument ist öffentlich und darf kurz gecacht werden.
  const discovery = await headersOf(request, '/.well-known/suite-identity')
  expect(discovery['cache-control']).toBe('public, max-age=300')
})
