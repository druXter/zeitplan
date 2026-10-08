import Link from 'next/link'
import QRCode from 'qrcode'
import { requireUser } from '../../../../lib/auth'
import { baseUrl } from '../../../../lib/base-url'
import { loadEventOr404 } from '../../../../lib/events/store'
import { formatDate } from '../../../../lib/timezone'
import { isGuestVisibleStatus } from '../../../../lib/guest/access'
import PrintButton from '../../../../ui/print-button'

export const dynamic = 'force-dynamic'

/**
 * QR-Code zur Gästeansicht zum Ausdrucken (Tischkarten, Menükarte - docs/KONZEPT.md Abschnitt 5). Als SVG direkt
 * im Server erzeugt (Paket qrcode, wie in rsvp-app): gestochen scharf in jeder Druckgröße, zum Herunterladen
 * für eigene Layouts. Der Code enthält nur die öffentliche Adresse /<slug>.
 */
export default async function QrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/qr`)
  const event = await loadEventOr404(id, user)
  const url = `${baseUrl()}/${event.slug}`
  const svg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

  return (
    <main className="bg-gray-50 dark:bg-gray-900 print:bg-white py-6 px-4">
      <div className="max-w-md mx-auto space-y-4 text-gray-900 dark:text-gray-100">
        <p className="text-sm print:hidden"><Link href={`/admin/events/${event.id}`} className="text-blue-700 dark:text-blue-300 hover:underline">{event.title}</Link></p>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow print:shadow-none p-6 text-center space-y-3">
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-gray-700 dark:text-gray-300">{formatDate(event.date, event.timezone)}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data:-URL, next/image bringt hier nichts */}
          <img src={src} alt={`QR-Code: ${url}`} className="mx-auto w-64 h-64" />
          <p className="font-medium">Der Ablauf – immer aktuell</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 break-all">{url}</p>
        </div>
        {!isGuestVisibleStatus(event.status) && (
          <p className="text-sm text-amber-900 dark:text-amber-200 print:hidden">Hinweis: Gäste sehen den Ablauf erst, wenn das Event veröffentlicht ist.</p>
        )}
        <div className="flex flex-wrap gap-2 text-sm print:hidden">
          <PrintButton />
          <a href={src} download={`qr-${event.slug}.svg`} className="py-2 px-3 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900">QR-Code als SVG herunterladen</a>
        </div>
      </div>
    </main>
  )
}
