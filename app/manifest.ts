// app/manifest.ts
import type { MetadataRoute } from 'next'
import { APP_NAME } from './lib/app'

/**
 * Web-App-Manifest: macht das Tool installierbar (Startbildschirm/App-Fenster) - wie Seating. Gedacht
 * für Planung und Moderation, darum startet die App im Admin-Bereich. Gäste brauchen keine
 * Installation, die Gästeansicht funktioniert im Browser.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'Ablauf großer Events mit Live-Prognose',
    lang: 'de',
    start_url: '/admin',
    scope: '/',
    display: 'standalone',
    // Tailwind gray-50 bzw. blue-600 - dieselben Farben wie die Oberfläche, damit Start-Bildschirm
    // und Statusleiste nahtlos in die App übergehen.
    background_color: '#f9fafb',
    theme_color: '#2563eb',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Vollflächig, damit Android das Symbol frei zuschneiden kann (Kreis, abgerundetes Quadrat ...).
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Events', url: '/admin/events', description: 'Eigene und freigegebene Events' },
      { name: 'Neues Event', short_name: 'Neu', url: '/admin/events/new', description: 'Einen neuen Ablauf anlegen' },
    ],
  }
}
