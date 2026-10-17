// app/ui/account-nav.tsx
import Link from 'next/link'
import { getCurrentUser } from '../lib/auth'
import { canCreateEvents, canInviteUsers } from '../lib/permissions'
import { logoutUser } from '../auth-actions'
import { AppHeader, menuItemClass, menuSeparatorClass } from './kit'
import HeaderGate from './header-gate'

const ROLE_LABELS = { ADMIN: 'Administrator*in', CREATOR: 'Creator', MODERATOR: 'Moderator*in' } as const

/**
 * Kopfzeile aller Seiten (AppHeader aus suite-kit/ui, wie in allen Tools der Suite):
 * Marke, für angemeldete Konten die Navigation (Events, bei Creator und Admins Reihen, bei Admins und Creator Konten)
 * und das Konto-Menü (Mein Konto, Abmelden), sonst nur „Anmelden“. Beim Drucken und eingebettet ausgeblendet, auf
 * Seiten für Gäste siehe HeaderGate.
 *
 * Nur Anzeige: Sie entscheidet nichts über Zugriffe (das tun die Seiten und Server Actions selbst) - ein Layout wird
 * bei der Navigation nicht neu geprüft und darf deshalb keine Schutzfunktion haben.
 */
export default async function AccountNav() {
  const user = await getCurrentUser()
  return (
    <HeaderGate signedIn={user !== null}>
      <AppHeader
        className="embed-hidden"
        brand={{ letter: 'Z', name: 'Zeitplan', href: user ? '/admin' : '/' }}
        nav={user ? [
          { href: '/admin', label: 'Events', match: ['/admin/events'], exactOr: '/admin' },
          ...(canCreateEvents(user) ? [{ href: '/admin/series', label: 'Reihen' }] : []),
          ...(canInviteUsers(user) ? [{ href: '/admin/users', label: 'Konten' }] : [])
        ] : []}
        account={user && {
          name: user.name || user.email,
          detail: <>{user.email}<br />{ROLE_LABELS[user.role]}</>,
          menu: <>
            <Link href="/account" className={menuItemClass}>Mein Konto</Link>
            <form action={logoutUser} className={menuSeparatorClass}>
              <button type="submit" className={menuItemClass}>Abmelden</button>
            </form>
          </>
        }}
        login={{ href: '/login' }}
      />
    </HeaderGate>
  )
}
