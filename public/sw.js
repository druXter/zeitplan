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

const VERSION = 'v2'
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
