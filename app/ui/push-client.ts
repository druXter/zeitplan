// app/ui/push-client.ts
// Gemeinsame Browser-Helfer für Push-Mitteilungen: Team (app/ui/push-toggle.tsx) und Gäste (app/[slug]/reminder-toggle.tsx).

/** Kann dieser Browser Push? Auf iPhone/iPad nur als installierte App (iOS 16.4+). */
export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4)
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
}

export async function registration() {
  // Derselbe Worker wie für die Installierbarkeit (app/ui/pwa-register.tsx) - register ist
  // idempotent; hier auch in der Entwicklung, sonst ließe sich Push nicht ausprobieren.
  return navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
}
