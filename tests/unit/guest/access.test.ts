import { describe, expect, it } from 'vitest'
import type { EventStatus, GuestAccess } from '@prisma/client'
import { guestVisibility, needsAccountCheck } from '../../../app/lib/guest/access'

// Wer sieht Gästeansicht, Tafel und Polling-Endpunkt (docs/KONZEPT.md Abschnitt 4 und 6)?

const STATUSES: EventStatus[] = ['DRAFT', 'PUBLISHED', 'LIVE', 'ENDED', 'ARCHIVED']
const ACCESS: GuestAccess[] = ['PUBLIC', 'CODE', 'ACCOUNT', 'RSVP']

describe('guestVisibility', () => {
  it('veröffentlicht, live und beendet mit Zugang PUBLIC: für alle, ohne nach dem Konto zu fragen', () => {
    for (const status of ['PUBLISHED', 'LIVE', 'ENDED'] as const) {
      expect(needsAccountCheck({ status, access: 'PUBLIC' }), status).toBe(false)
      expect(guestVisibility({ status, access: 'PUBLIC' }, false), status).toBe('public')
      expect(guestVisibility({ status, access: 'PUBLIC' }, true), status).toBe('public')
    }
  })

  it('Entwurf und Archiv: nicht vorhanden für Gäste, Vorschau für Konten mit Zugriff - bei jedem Zugang', () => {
    for (const status of ['DRAFT', 'ARCHIVED'] as const) {
      for (const access of ACCESS) {
        expect(guestVisibility({ status, access }, false), `${status}/${access}`).toBe('hidden')
        expect(guestVisibility({ status, access }, true), `${status}/${access}`).toBe('preview')
      }
    }
  })

  it('geschützter Zugang: ohne Konto kein Inhalt (auch veröffentlicht), mit Zugriff Vorschau', () => {
    for (const status of ['PUBLISHED', 'LIVE', 'ENDED'] as const) {
      for (const access of ['CODE', 'ACCOUNT', 'RSVP'] as const) {
        expect(needsAccountCheck({ status, access })).toBe(true)
        expect(guestVisibility({ status, access }, false), `${status}/${access}`).toBe('protected')
        expect(guestVisibility({ status, access }, true), `${status}/${access}`).toBe('preview')
      }
    }
  })

  it('"public" nur mit Zugang PUBLIC und sichtbarem Status', () => {
    for (const status of STATUSES) for (const access of ACCESS) for (const account of [false, true]) {
      const visible = guestVisibility({ status, access }, account) === 'public'
      expect(visible, `${status}/${access}/${account}`).toBe(access === 'PUBLIC' && ['PUBLISHED', 'LIVE', 'ENDED'].includes(status))
    }
  })
})
