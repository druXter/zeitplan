import { expect, test } from '@playwright/test'

// Prüft die Header-Regeln aus next.config.ts - insbesondere die Reihenfolge (spätere Regel
// gewinnt): sensible Bereiche müssen ihre strengeren Werte behalten. Übernommen aus Seating; anders
// als dort ist hier nichts einbettbar (auch nicht die künftige Gästeansicht /<slug>).

const PUBLIC = ['/', '/impressum', '/datenschutz']
const PRIVATE = ['/login', '/forgot-password', '/reset-password', '/account', '/admin', '/admin/users', '/admin/events', '/admin/events/new', '/admin/events/x',
  '/admin/events/import', '/admin/events/x/plan', '/admin/events/x/items/new', '/admin/events/x/export', '/admin/series', '/admin/series/x']
// Pfade der Gästeansicht und der Tafel (ab Phase 3) - schon jetzt ohne Einbetten.
const GUEST = ['/irgendein-event', '/irgendein-event/tafel']

async function headersOf(request: import('@playwright/test').APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 })
  return response.headers()
}

test('allgemeine Sicherheits-Header auf jeder Seite', async ({ request }) => {
  for (const path of [...PUBLIC, ...PRIVATE, ...GUEST, '/gibt-es/nicht', '/api/cron/cleanup']) {
    const h = await headersOf(request, path)
    expect(h['x-content-type-options'], path).toBe('nosniff')
    expect(h['strict-transport-security'], path).toBe('max-age=31536000')
    expect(h['permissions-policy'], path).toContain('camera=()')
  }
})

test('kein Einbetten - auf keiner Seite, auch nicht für Gästeansicht und Tafel', async ({ request }) => {
  for (const path of [...PUBLIC, ...PRIVATE, ...GUEST, '/api/cron/cleanup', '/offline.html']) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'")
    expect(h['x-frame-options'], path).toBe('DENY')
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

test('Einmal-Links gehen nicht per Referer weiter', async ({ request }) => {
  const h = await headersOf(request, '/reset-password?token=abc')
  expect(h['referrer-policy']).toBe('no-referrer')
  expect(h['x-robots-tag']).toBe('noindex, nofollow')
})
