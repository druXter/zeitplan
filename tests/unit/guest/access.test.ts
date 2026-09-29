import { describe, expect, it } from 'vitest'
import type { EventStatus, GuestAccess } from '@prisma/client'
import { guestSessionExpiresAt, guestVisibility, needsAccountCheck, sessionMatchesAccess } from '../../../app/lib/guest/access'

// Wer sieht Gästeansicht, Tafel und Polling-Endpunkt (docs/KONZEPT.md Abschnitt 4 und 6)?

const STATUSES: EventStatus[] = ['DRAFT', 'PUBLISHED', 'LIVE', 'ENDED', 'ARCHIVED']
const ACCESS: GuestAccess[] = ['PUBLIC', 'CODE', 'ACCOUNT', 'RSVP']
const CREDENTIALS = [
  { accountAccess: false, guestAccess: false },
  { accountAccess: false, guestAccess: true },
  { accountAccess: true, guestAccess: false },
  { accountAccess: true, guestAccess: true }
]
const NONE = { accountAccess: false, guestAccess: false }
const ACCOUNT = { accountAccess: true, guestAccess: false }
const GUEST = { accountAccess: false, guestAccess: true }

describe('guestVisibility', () => {
  it('veröffentlicht, live und beendet mit Zugang PUBLIC: für alle, ohne nach Konto oder Sitzung zu fragen', () => {
    for (const status of ['PUBLISHED', 'LIVE', 'ENDED'] as const) {
      expect(needsAccountCheck({ status, access: 'PUBLIC' }), status).toBe(false)
      for (const credentials of CREDENTIALS) expect(guestVisibility({ status, access: 'PUBLIC' }, credentials), status).toBe('public')
    }
  })

  it('Entwurf und Archiv: nicht vorhanden für Gäste - auch mit Gast-Sitzung oder Tafel-Link -, Vorschau für Konten mit Zugriff', () => {
    for (const status of ['DRAFT', 'ARCHIVED'] as const) {
      for (const access of ACCESS) {
        expect(guestVisibility({ status, access }, NONE), `${status}/${access}`).toBe('hidden')
        expect(guestVisibility({ status, access }, GUEST), `${status}/${access}`).toBe('hidden')
        expect(guestVisibility({ status, access }, ACCOUNT), `${status}/${access}`).toBe('preview')
      }
    }
  })

  it('geschützter Zugang: ohne Zugang kein Inhalt, mit gültigem Zugang wie für Gäste, mit Zugriff Vorschau', () => {
    for (const status of ['PUBLISHED', 'LIVE', 'ENDED'] as const) {
      for (const access of ['CODE', 'ACCOUNT', 'RSVP'] as const) {
        expect(needsAccountCheck({ status, access })).toBe(true)
        expect(guestVisibility({ status, access }, NONE), `${status}/${access}`).toBe('protected')
        expect(guestVisibility({ status, access }, GUEST), `${status}/${access}`).toBe('guest')
        expect(guestVisibility({ status, access }, ACCOUNT), `${status}/${access}`).toBe('preview')
      }
    }
  })

  it('Inhalt ("public"/"guest") nur mit sichtbarem Status und entweder PUBLIC oder gültigem Zugang', () => {
    for (const status of STATUSES) for (const access of ACCESS) for (const credentials of CREDENTIALS) {
      const visibility = guestVisibility({ status, access }, credentials)
      const content = visibility === 'public' || visibility === 'guest'
      const visible = ['PUBLISHED', 'LIVE', 'ENDED'].includes(status)
      expect(content, `${status}/${access}/${JSON.stringify(credentials)}`).toBe(visible && (access === 'PUBLIC' || (credentials.guestAccess && !credentials.accountAccess)))
    }
  })
})

describe('sessionMatchesAccess', () => {
  it('Code-Sitzungen nur bei CODE, rsvp-Sitzungen nur bei RSVP - nach einem Wechsel gilt keine alte Sitzung', () => {
    expect(sessionMatchesAccess('CODE', { rsvpId: null })).toBe(true)
    expect(sessionMatchesAccess('CODE', { rsvpId: 'r1' })).toBe(false)
    expect(sessionMatchesAccess('RSVP', { rsvpId: 'r1' })).toBe(true)
    expect(sessionMatchesAccess('RSVP', { rsvpId: null })).toBe(false)
    for (const access of ['PUBLIC', 'ACCOUNT'] as const) {
      expect(sessionMatchesAccess(access, { rsvpId: null })).toBe(false)
      expect(sessionMatchesAccess(access, { rsvpId: 'r1' })).toBe(false)
    }
  })
})

describe('guestSessionExpiresAt', () => {
  const DAY = 24 * 60 * 60 * 1000
  it('bis Eventende + 1 Tag', () => {
    const now = new Date('2026-06-20T10:00:00Z')
    const end = new Date('2026-06-21T05:00:00Z')
    expect(guestSessionExpiresAt(end, now).getTime()).toBe(end.getTime() + DAY)
  })

  it('nach dem Ende (Rückblick): einen Tag ab jetzt', () => {
    const now = new Date('2026-06-25T10:00:00Z')
    expect(guestSessionExpiresAt(new Date('2026-06-21T05:00:00Z'), now).getTime()).toBe(now.getTime() + DAY)
  })
})
