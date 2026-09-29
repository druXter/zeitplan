import { expect, test } from '@playwright/test'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { createAccount, createEventRecord, prisma } from './helpers'

test('Cron-Endpunkt lehnt fehlendes, leeres und falsches Secret ab', async ({ request }) => {
  for (const query of ['', '?secret=', '?secret=falsch', `?secret=${TEST_CRON_SECRET}x`]) {
    const response = await request.get(`/api/cron/cleanup${query}`)
    expect(response.status(), query).toBe(401)
  }
})

test('Cron-Endpunkt räumt auf: inaktive Konten (außer Admins), abgelaufene Sitzungen und Links', async ({ request }) => {
  const longAgo = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000)
  const inactive = await createAccount('CREATOR')
  const inactiveAdmin = await createAccount('ADMIN')
  const active = await createAccount('CREATOR')
  await prisma.user.updateMany({ where: { id: { in: [inactive.id, inactiveAdmin.id] } }, data: { lastLoginAt: longAgo } })
  await prisma.user.update({
    where: { id: active.id },
    data: { resetTokenHash: 'abgelaufen-' + active.id, resetTokenExpiresAt: new Date(Date.now() - 1000) }
  })
  await prisma.session.create({ data: { tokenHash: 'alt-' + active.id, userId: active.id, expiresAt: new Date(Date.now() - 1000) } })

  const response = await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)
  expect(response.status()).toBe(200)

  expect(await prisma.user.findUnique({ where: { id: inactive.id } })).toBeNull()
  expect(await prisma.user.findUnique({ where: { id: inactiveAdmin.id } })).not.toBeNull()
  const kept = await prisma.user.findUnique({ where: { id: active.id } })
  expect(kept?.resetTokenHash).toBeNull()
  expect(await prisma.session.count({ where: { userId: active.id } })).toBe(0)
})

test('Cron löscht Events 18 Monate nach ihrem Tag, jüngere bleiben; Konten mit Events bleiben', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const month = 30 * 24 * 60 * 60 * 1000
  const old = await createEventRecord(owner.id, { date: new Date(Date.now() - 19 * month) })
  await prisma.eventAccess.create({ data: { eventId: old.id, userId: (await createAccount('MODERATOR')).id } })
  const recent = await createEventRecord(owner.id, { date: new Date(Date.now() - 17 * month) })
  await prisma.user.update({ where: { id: owner.id }, data: { lastLoginAt: new Date(Date.now() - 3 * 365 * 24 * 3600_000) } })

  const response = await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)
  expect(response.status()).toBe(200)
  expect(await prisma.event.count({ where: { id: old.id } })).toBe(0)
  expect(await prisma.eventAccess.count({ where: { eventId: old.id } })).toBe(0)
  expect(await prisma.event.count({ where: { id: recent.id } })).toBe(1)
  expect(await prisma.user.count({ where: { id: owner.id } })).toBe(1)
})
