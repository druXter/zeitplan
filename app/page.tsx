// app/page.tsx
import Link from 'next/link'
import { APP_NAME } from './lib/app'
import InstallHint from './ui/install-hint'

/**
 * Startseite. Gäste kommen über den Link oder QR-Code zu ihrem Event (/<slug>) und sehen diese
 * Seite normalerweise nie - sie verrät deshalb bewusst keine Liste von Events.
 */
export default function HomePage() {
  return (
    <main className="bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow space-y-4 text-gray-900 dark:text-gray-100">
        <h1 className="text-2xl font-bold">{APP_NAME}</h1>
        <p className="text-gray-700 dark:text-gray-300">
          Der Ablauf eures Events – mit aktueller Prognose wie auf einer Abfahrtstafel.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Du bist Gast? Nutze bitte den Link oder QR-Code, den du von den Veranstalter*innen bekommen hast.
        </p>
        <p className="text-sm">
          <Link href="/login" className="text-blue-700 dark:text-blue-300 hover:underline">Anmelden für Planung und Moderation</Link>
        </p>
        <InstallHint />
      </div>
    </main>
  )
}
