'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { formString } from '../../lib/form'
import { canCreateEvents } from '../../lib/permissions'
import { canManageSeries, parseSeriesForm } from '../../lib/events/series'
import { SLUG_TAKEN, SlugTakenError, slugTaken } from '../../lib/planning/slug-store'

// Reihen (docs/KONZEPT.md Abschnitt 4): mehrere Events mit gemeinsamer Übersicht unter /<slug> (Phase 3).
// Anlegen darf, wer Events anlegen darf; ändern und löschen das besitzende Konto oder Admins. Die Adresse
// teilt sich den Namensraum mit den Events.

export type SeriesFormState = { errors: string[]; message?: string } | null

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function createSeries(_previous: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const user = await requireUser('/admin/series')
  if (!canCreateEvents(user)) redirect('/admin')
  const parsed = parseSeriesForm(formData)
  if (!parsed.ok) return { errors: parsed.errors }

  let seriesId: string
  try {
    seriesId = await prisma.$transaction(async tx => {
      if (await slugTaken(parsed.fields.slug, {}, tx)) throw new SlugTakenError()
      return (await tx.series.create({ data: { ...parsed.fields, ownerId: user.id } })).id
    })
  } catch (error) {
    if (error instanceof SlugTakenError || isUniqueViolation(error)) return { errors: [SLUG_TAKEN] }
    throw error
  }
  redirect(`/admin/series/${seriesId}?created=1`)
}

export async function updateSeries(_previous: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const user = await requireUser('/admin/series')
  const series = await prisma.series.findUnique({ where: { id: formString(formData, 'seriesId', 50) } })
  if (!series || !canManageSeries(user, series)) redirect('/admin/series')
  const parsed = parseSeriesForm(formData)
  if (!parsed.ok) return { errors: parsed.errors }

  try {
    await prisma.$transaction(async tx => {
      if (await slugTaken(parsed.fields.slug, { seriesId: series.id }, tx)) throw new SlugTakenError()
      await tx.series.update({ where: { id: series.id }, data: parsed.fields })
    })
  } catch (error) {
    if (error instanceof SlugTakenError || isUniqueViolation(error)) return { errors: [SLUG_TAKEN] }
    throw error
  }
  revalidatePath(`/admin/series/${series.id}`)
  return { errors: [], message: 'Reihe gespeichert.' }
}

/** Löscht die Reihe - ihre Events bleiben, nur die Zuordnung entfällt (SetNull). */
export async function deleteSeries(formData: FormData) {
  const user = await requireUser('/admin/series')
  const series = await prisma.series.findUnique({ where: { id: formString(formData, 'seriesId', 50) } })
  if (!series || !canManageSeries(user, series)) redirect('/admin/series')
  await prisma.series.delete({ where: { id: series.id } })
  redirect('/admin/series?deleted=1')
}
