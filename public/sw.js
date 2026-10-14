// public/sw.js
// Bewusst schlanker Service Worker (wie in Seating) - er macht die App installierbar und
// zeigt bei fehlender Verbindung eine freundliche Offline-Seite statt der Fehlerseite des Browsers.
//
// NICHTS Persönliches wird zwischengespeichert: Seiten dieses Tools enthalten Konto-Daten, interne
// Notizen, geheime Programmpunkte und Team-Abläufe. Ein Cache davon würde auf einem geteilten Gerät
// auch nach dem Abmelden lesbar bleiben. Deshalb gilt:
//   - Navigationen gehen IMMER ans Netz (kein Cache, kein "stale"), nur bei einem Netzwerkfehler
//     kommt die vorab geladene Offline-Seite.
//   - Alles andere (Server Actions/POST, /api/* inkl. Polling, RSC-Anfragen, Bilder, fremde Herkunft)
//     fasst dieser Worker gar nicht an - der Browser verhält sich wie ohne Service Worker.
// Im Cache liegt ausschließlich die statische Offline-Seite. Ändert sich /offline.html, VERSION erhöhen.
// Den letzten Stand der Gästeansicht bei schlechtem Empfang (docs/KONZEPT.md Abschnitt 5) merkt sich die
// Gästeansicht selbst im Browser (localStorage) - nicht dieser Worker. Wird sie ohne Verbindung neu geladen,
// liest die Offline-Seite diesen Stand und zeigt ihn an.
//
// Push-Mitteilungen (Vorwarnung fürs Team, Idee L17, app/lib/push.ts): Der Worker zeigt sie nur an und öffnet beim
// Antippen die mitgeschickte Adresse - ausschließlich auf dieser Herkunft, fremde Adressen werden ignoriert. Gleiche
// Tags (ein Punkt) ersetzen eine ältere Mitteilung, statt sich zu stapeln.

const VERSION = 'v3'
const CACHE = `zeitplan-offline-${VERSION}`
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('zeitplan-offline-') && key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.mode !== 'navigate' || request.method !== 'GET') return

  const url = new URL(request.url)
  // /api/* (u.a. Export-Downloads und später der Anmelde-Ablauf mit anderen Tools, der auf fremde
  // Domains weiterleitet) gehört dem Browser.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  event.respondWith((async () => {
    try {
      return await fetch(request)
    } catch {
      return (await caches.match(OFFLINE_URL)) || Response.error()
    }
  })())
})

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    // Unlesbarer Inhalt: trotzdem eine (neutrale) Mitteilung zeigen - Browser verlangen das bei userVisibleOnly.
  }
  const options = {
    body: message.body || '',
    icon: '/icons/icon-192.png',
    data: { url: typeof message.url === 'string' ? message.url : '/admin' }
  }
  if (typeof message.tag === 'string') {
    options.tag = message.tag
    options.renotify = true
  }
  event.waitUntil(self.registration.showNotification(message.title || 'Zeitplan', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data && event.notification.data.url || '/admin', self.location.origin)
  if (target.origin !== self.location.origin) return
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((client) => client.url === target.href)
    if (open) return open.focus()
    return self.clients.openWindow(target.href)
  })())
})
