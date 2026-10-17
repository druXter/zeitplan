import QRCode from 'qrcode'
import { requireUser } from '../../../../lib/auth'
import { baseUrl } from '../../../../lib/base-url'
import { loadEventOr404 } from '../../../../lib/events/store'
import { formatDate } from '../../../../lib/timezone'
import { isGuestVisibleStatus } from '../../../../lib/guest/access'
import { buttonClass, PrintButton } from '../../../../ui/kit'

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
    <div className="max-w-md space-y-4">
      <h2 className="text-lg font-semibold print:hidden">QR-Code zum Ausdrucken</h2>
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm print:border-0 print:shadow-none p-6 text-center space-y-3">
        <p className="text-2xl font-semibold">{event.title}</p>
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
        <a href={src} download={`qr-${event.slug}.svg`} className={buttonClass('secondary')}>QR-Code als SVG herunterladen</a>
      </div>
    </div>
  )
}
