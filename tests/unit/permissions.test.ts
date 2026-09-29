import { describe, expect, it } from 'vitest'
import {
  canAddRemoveItems, canCreateEvents, canEditItem, canEditPlan, canInviteUsers, canManageEvent, eventLevel, safeEqual, seesItemContent
} from '../../app/lib/permissions'
import type { CurrentUser } from '../../app/lib/auth'

describe('safeEqual', () => {
  it('vergleicht korrekt, auch bei unterschiedlicher Länge', () => {
    expect(safeEqual('geheim', 'geheim')).toBe(true)
    expect(safeEqual('geheim', 'geheiM')).toBe(false)
    expect(safeEqual('geheim', 'geheim2')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})

describe('canCreateEvents', () => {
  const user = (role: CurrentUser['role']): CurrentUser => ({ id: '1', email: 'a@b.de', name: null, role, hasPassword: true })
  it('erlaubt Admins und Creators, nicht Moderator*innen', () => {
    expect(canCreateEvents(user('ADMIN'))).toBe(true)
    expect(canCreateEvents(user('CREATOR'))).toBe(true)
    expect(canCreateEvents(user('MODERATOR'))).toBe(false)
    expect(canInviteUsers(user('ADMIN'))).toBe(true)
    expect(canInviteUsers(user('CREATOR'))).toBe(true)
    expect(canInviteUsers(user('MODERATOR'))).toBe(false)
  })
})

describe('eventLevel', () => {
  const user = (role: CurrentUser['role'], id = 'u1'): CurrentUser => ({ id, email: 'a@b.de', name: null, role, hasPassword: true })
  it('Besitzer*in und Admin sind owner, Freigabe ergibt moderator, sonst nichts', () => {
    expect(eventLevel(user('CREATOR'), { ownerId: 'u1' }, false)).toBe('owner')
    expect(eventLevel(user('ADMIN', 'x'), { ownerId: 'u1' }, false)).toBe('owner')
    expect(eventLevel(user('ADMIN', 'x'), { ownerId: null }, false)).toBe('owner')
    expect(eventLevel(user('MODERATOR', 'm'), { ownerId: 'u1' }, true)).toBe('moderator')
    expect(eventLevel(user('CREATOR', 'c'), { ownerId: 'u1' }, true)).toBe('moderator')
    expect(eventLevel(user('CREATOR', 'c'), { ownerId: 'u1' }, false)).toBeNull()
    expect(eventLevel(user('MODERATOR', 'm'), { ownerId: null }, false)).toBeNull()
  })
})

describe('Plan bearbeiten und SECRET', () => {
  const off = { modsMayEditPlan: false }
  const on = { modsMayEditPlan: true }

  it('owner plant immer, Moderator*innen nur mit Schalter', () => {
    expect(canEditPlan('owner', off)).toBe(true)
    expect(canEditPlan('moderator', off)).toBe(false)
    expect(canEditPlan('moderator', on)).toBe(true)
  })

  it('Punkte anlegen/löschen: vor dem Event mit "Plan bearbeiten", live nur mit "Einschübe und Löschen"', () => {
    const event = (status: string, modsMayEditPlan: boolean, modsMayInsert: boolean) => ({ status, modsMayEditPlan, modsMayInsert })
    expect(canAddRemoveItems('owner', event('LIVE', false, false))).toBe(true)
    expect(canAddRemoveItems('moderator', event('DRAFT', false, true))).toBe(false)
    expect(canAddRemoveItems('moderator', event('DRAFT', true, false))).toBe(true)
    expect(canAddRemoveItems('moderator', event('LIVE', true, false))).toBe(false)
    expect(canAddRemoveItems('moderator', event('LIVE', false, true))).toBe(true)
  })

  it('Einstellungen, Spuren und Freigaben bleiben bei owner - auch mit Schalter', () => {
    expect(canManageEvent('owner')).toBe(true)
    expect(canManageEvent('moderator')).toBe(false)
  })

  it('SECRET-Inhalt nur für eingetragene Konten, auch nicht für owner', () => {
    expect(seesItemContent({ visibility: 'PUBLIC' }, false)).toBe(true)
    expect(seesItemContent({ visibility: 'TEAM' }, false)).toBe(true)
    expect(seesItemContent({ visibility: 'SECRET' }, false)).toBe(false)
    expect(seesItemContent({ visibility: 'SECRET' }, true)).toBe(true)
  })

  it('geheime Punkte ändern nur eingetragene Konten mit Planrecht', () => {
    const secret = { visibility: 'SECRET' as const }
    expect(canEditItem('owner', off, secret, false)).toBe(false)
    expect(canEditItem('owner', off, secret, true)).toBe(true)
    expect(canEditItem('moderator', off, secret, true)).toBe(false)
    expect(canEditItem('moderator', on, secret, true)).toBe(true)
    expect(canEditItem('moderator', on, { visibility: 'TEAM' }, false)).toBe(true)
  })
})
