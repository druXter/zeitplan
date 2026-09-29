// app/admin/events/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Prisma, type EventStatus, type GuestAccess } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { requireUser, type CurrentUser } from '../../lib/auth'
import { formString, normalizeEmail } from '../../lib/form'
import { canCreateEvents, canManageEvent } from '../../lib/permissions'
import { loadEventForUser } from '../../lib/events/store'
import { allowedStatusChanges, DEFAULT_EVENT_OPTIONS, parseEventForm, parseEventOptions, type EventFields, type EventOptions } from '../../lib/events/settings'
import { buildExport, IMPORT_MAX_BYTES, materializePlan, parseExport, type MaterializedPlan } from '../../lib/planning/exchange'
import { WEDDING_TEMPLATE } from '../../lib/planning/template'
import { createEventFromPlan, EMPTY_PLAN } from '../../lib/planning/create'
import { bumpLiveVersion, loadPlan } from '../../lib/planning/store'
import { SLUG_TAKEN, SlugTakenError, slugTaken } from '../../lib/planning/slug-store'
import { daysBetween, shiftDays, utcToZonedDate } from '../../lib/timezone'
import { accessCodeConfigured, accessCodeHmac, displayLinkConfigured, validateAccessCode } from '../../lib/guest/tokens'

// Die Berechtigung prüft JEDE Aktion selbst (über loadEventForUser -> eventLevel), nie nur die Seite.
// owner: Besitzer*in oder Admin - Einstellungen, Schalter, Status, Freigaben, Löschen (canManageEvent).
// moderator: per Freigabe - sieht das Event; planen nur mit Schalter (app/admin/events/plan-actions.ts).

export type FormState = { errors: string[]; message?: string } | null

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** Legt ein Event aus einem geprüften Plan an und leitet zur Übersicht - oder meldet eine vergebene Adresse. */
async function createAndOpen(user: CurrentUser, fields: EventFields, options: EventOptions, plan: MaterializedPlan, notice: string): Promise<FormState> {
  let eventId: string
  try {
    eventId = await createEventFromPlan(user.id, fields, options, plan)
  } catch (error) {
    if (error instanceof SlugTakenError || isUniqueViolation(error)) return { errors: [SLUG_TAKEN] }
    throw error
  }
  redirect(`/admin/events/${eventId}?${notice}=1`)
}

/**
 * Neues Event (Titel, Adresse, Tag, Beschreibung) - leer mit einer Spur "Ablauf" oder mit der Vorlage
 * "Hochzeit" auf dem gewählten Tag. Neue Events sind immer Entwurf.
 */
export async function createEvent(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events/new')
  if (!canCreateEvents(user)) redirect('/admin/events')

  const parsed = parseEventForm(formData)
  if (!parsed.ok) return { errors: parsed.errors }

  if (formData.get('template') === 'wedding') {
    const template = parseExport(WEDDING_TEMPLATE)
    if (!template.ok) throw new Error('Vorlage "Hochzeit" ist ungültig')
    return createAndOpen(user, parsed.fields, template.plan.settings, materializePlan(template.plan, parsed.fields.date), 'created')
  }
  return createAndOpen(user, parsed.fields, DEFAULT_EVENT_OPTIONS, EMPTY_PLAN, 'created')
}

/**
 * Import einer Ablauf-Datei als NEUES Event (nie überschreibend). Titel und Tag aus dem Formular, sonst aus
 * der Datei; die Punkte rutschen auf den gewählten Tag. Dieselben Rechte wie "Neues Event".
 */
export async function importEvent(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events/new')
  if (!canCreateEvents(user)) redirect('/admin/events')

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { errors: ['Datei: Bitte wähle eine Datei aus.'] }
  if (file.size > IMPORT_MAX_BYTES) return { errors: ['Datei: Die Datei ist zu groß (höchstens 900 KB).'] }
  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch {
    return { errors: ['Datei: Die Datei enthält kein gültiges JSON.'] }
  }
  const imported = parseExport(json)
  if (!imported.ok) return { errors: imported.errors.map(error => `Datei: ${error}`) }

  const form = new FormData()
  form.set('title', formString(formData, 'title', 200) || imported.plan.title || '')
  form.set('slug', formString(formData, 'slug', 100))
  form.set('description', imported.plan.description)
  form.set('date', formString(formData, 'date', 20) || utcToZonedDate(imported.plan.date))
  const parsed = parseEventForm(form)
  if (!parsed.ok) return { errors: parsed.errors }

  return createAndOpen(user, parsed.fields, imported.plan.settings, materializePlan(imported.plan, parsed.fields.date), 'imported')
}

/**
 * Kopie eines Events auf einen neuen Tag - über denselben Weg wie Export und Import, damit die SECRET-Regel
 * gilt: Kopiert wird nur, was das Konto sieht; geheime Punkte ohne Eintrag werden zum Platzhalter mit Zeit und
 * Dauer. Kein Live-Stand, keine Freigaben, Schalter aus. Wer Events anlegen darf und das Event sieht.
 */
export async function duplicateEvent(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || !canCreateEvents(user)) redirect('/admin/events')

  const parsed = parseEventForm(formData)
  if (!parsed.ok) return { errors: parsed.errors }

  const { tracks, items } = await loadPlan(event.id, user.id)
  const copy = parseExport(buildExport(event, tracks, items))
  if (!copy.ok) return { errors: copy.errors.map(error => `Ablauf: ${error}`) }
  return createAndOpen(user, parsed.fields, copy.plan.settings, materializePlan(copy.plan, parsed.fields.date), 'duplicated')
}

/**
 * Titel, Adresse, Tag, Beschreibung, Reihe. Nur owner. Ein neuer Tag verschiebt alle Punkte um dieselbe Zahl
 * an Kalendertagen (Uhrzeiten bleiben) - nicht, solange das Event live ist.
 */
export async function updateEventSettings(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || !canManageEvent(event.level)) redirect('/admin/events')

  const parsed = parseEventForm(formData)
  if (!parsed.ok) return { errors: parsed.errors }

  const seriesInput = formString(formData, 'seriesId', 50)
  let seriesId: string | null = seriesInput || null
  if (seriesId && seriesId !== event.seriesId) {
    const series = await prisma.series.findUnique({ where: { id: seriesId }, select: { ownerId: true } })
    if (!series || (user.role !== 'ADMIN' && series.ownerId !== user.id)) seriesId = event.seriesId
  }

  const days = daysBetween(event.date, parsed.fields.date, event.timezone)
  if (days !== 0 && event.status === 'LIVE') return { errors: ['Datum: Während das Event live ist, lässt sich der Tag nicht ändern.'] }

  let shifted = 0
  try {
    shifted = await prisma.$transaction(async tx => {
      if (await slugTaken(parsed.fields.slug, { eventId: event.id }, tx)) throw new SlugTakenError()
      await tx.event.update({ where: { id: event.id }, data: { ...parsed.fields, seriesId, liveVersion: { increment: 1 } } })
      if (days !== 0) {
        const items = await tx.item.findMany({ where: { eventId: event.id }, select: { id: true, plannedStart: true, originalStart: true } })
        for (const item of items) {
          await tx.item.update({
            where: { id: item.id },
            data: {
              plannedStart: shiftDays(item.plannedStart, days, event.timezone),
              ...(item.originalStart ? { originalStart: shiftDays(item.originalStart, days, event.timezone) } : {}),
              version: { increment: 1 }
            }
          })
        }
        return items.length
      }
      return 0
    })
  } catch (error) {
    if (error instanceof SlugTakenError || isUniqueViolation(error)) return { errors: [SLUG_TAKEN] }
    throw error
  }
  revalidatePath(`/admin/events/${event.id}`)
  return { errors: [], message: shifted > 0 ? 'Einstellungen gespeichert, alle Punkte auf den neuen Tag verschoben.' : 'Einstellungen gespeichert.' }
}

/** Prognose, Anzeige für Gäste und die Schalter für Moderator*innen (Abschnitt 2 und 7). Nur owner. */
export async function updateEventOptions(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || !canManageEvent(event.level)) redirect('/admin/events')

  const parsed = parseEventOptions(formData)
  if (!parsed.ok) return { errors: parsed.errors }
  await prisma.$transaction(async tx => {
    await tx.event.update({ where: { id: event.id }, data: { ...parsed.options, modsMayEditPlan: parsed.modsMayEditPlan, modsMayInsert: parsed.modsMayInsert } })
    await bumpLiveVersion(event.id, tx)
  })
  return { errors: [], message: 'Einstellungen gespeichert.' }
}

// Zugang RSVP kommt mit der Anbindung an rsvp-app (Phase 7b).
const SELECTABLE_ACCESS: GuestAccess[] = ['PUBLIC', 'CODE', 'ACCOUNT']

/**
 * Zugang der Gäste (docs/KONZEPT.md Abschnitt 6). Nur owner. Der Zugangscode wird nur als HMAC gespeichert und
 * danach nie wieder angezeigt; ein leeres Feld behält den bisherigen. Ändern sich Zugang oder Code, enden alle
 * Gast-Sitzungen des Events - wer den alten Code hatte, muss den neuen eingeben.
 */
export async function updateGuestAccess(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || !canManageEvent(event.level)) redirect('/admin/events')

  const access = formString(formData, 'access', 20) as GuestAccess
  if (!SELECTABLE_ACCESS.includes(access)) return { errors: ['Zugang: Bitte wähle einen Zugang aus.'] }

  const code = formString(formData, 'code', 200)
  let codeHmac = event.accessCodeHmac
  if (access === 'CODE') {
    if (!accessCodeConfigured()) return { errors: ['Zugangscode: Auf dem Server fehlt ACCESS_CODE_SECRET (siehe .env.example).'] }
    if (code) {
      const error = validateAccessCode(code)
      if (error) return { errors: [`Zugangscode: ${error}`] }
      codeHmac = accessCodeHmac(event.id, code)
    } else if (!codeHmac) {
      return { errors: ['Zugangscode: Bitte lege einen Code fest.'] }
    }
  } else if (code) {
    return { errors: ['Zugangscode: Einen Code gibt es nur beim Zugang „mit Zugangscode“.'] }
  }

  const changed = access !== event.access || codeHmac !== event.accessCodeHmac
  await prisma.$transaction(async tx => {
    await tx.event.update({ where: { id: event.id }, data: { access, accessCodeHmac: codeHmac } })
    if (changed) await tx.guestSession.deleteMany({ where: { eventId: event.id } })
  })
  revalidatePath(`/admin/events/${event.id}`)
  if (access === 'CODE' && code) {
    return { errors: [], message: `Gespeichert. Der Zugangscode lautet „${code}“ – notiere ihn jetzt, er wird nicht noch einmal angezeigt.` }
  }
  return { errors: [], message: changed ? 'Zugang gespeichert.' : 'Keine Änderung.' }
}

/**
 * Neuer Tafel-Link: displayTokenVersion + 1 macht alle bisherigen Links ungültig (z. B. wenn ein Foto des
 * Fernsehers mit der Adresse herumgeht). Nur owner.
 */
export async function regenerateDisplayLink(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || !canManageEvent(event.level) || !displayLinkConfigured()) redirect('/admin/events')

  await prisma.event.update({ where: { id: event.id }, data: { displayTokenVersion: { increment: 1 } } })
  redirect(`/admin/events/${event.id}?display=1`)
}

/** Entwurf, veröffentlicht, archiviert (allowedStatusChanges). LIVE/ENDED setzt die Live-Steuerung. Nur owner. */
export async function changeEventStatus(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || !canManageEvent(event.level)) redirect('/admin/events')

  const target = formString(formData, 'status', 20) as EventStatus
  if (!allowedStatusChanges(event.status).includes(target)) redirect(`/admin/events/${event.id}`)
  await prisma.$transaction(async tx => {
    // Nur wenn sich der Status seit dem Laden nicht geändert hat (zwei Klicks, zwei Konten).
    const updated = await tx.event.updateMany({ where: { id: event.id, status: event.status }, data: { status: target } })
    if (updated.count > 0) await bumpLiveVersion(event.id, tx)
  })
  redirect(`/admin/events/${event.id}?status=1`)
}

/**
 * Gibt das Event einem weiteren BESTEHENDEN Konto frei (wie in Seating). Nur owner. Legt nie ein
 * Konto an - wer noch keins hat, wird erst unter /admin/users eingeladen. "Nicht gefunden" verrät
 * eingeloggten Besitzer*innen, ob eine Adresse ein Konto hat - das ist beabsichtigt, sonst wäre
 * Freigeben kaum bedienbar.
 */
export async function shareEvent(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || !canManageEvent(event.level)) redirect('/admin/events')

  const email = normalizeEmail(formString(formData, 'email', 254))
  const target = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null
  if (!target) redirect(`/admin/events/${event.id}?shareError=notfound`)
  if (target.id === event.ownerId) redirect(`/admin/events/${event.id}?shareError=owner`)

  await prisma.eventAccess.upsert({
    where: { eventId_userId: { eventId: event.id, userId: target.id } },
    update: {},
    create: { eventId: event.id, userId: target.id }
  })
  redirect(`/admin/events/${event.id}?shared=1`)
}

/** Nimmt eine Freigabe zurück. Nur owner des betroffenen Events. */
export async function unshareEvent(formData: FormData) {
  const user = await requireUser('/admin/events')
  const access = await prisma.eventAccess.findUnique({ where: { id: formString(formData, 'accessId', 50) }, select: { id: true, eventId: true } })
  if (!access) redirect('/admin/events')
  const event = await loadEventForUser(access.eventId, user)
  if (!event || !canManageEvent(event.level)) redirect('/admin/events')

  await prisma.eventAccess.delete({ where: { id: access.id } })
  redirect(`/admin/events/${event.id}?unshared=1`)
}

/** Löscht das Event samt Freigaben, Spuren, Punkten, Verlauf und Gast-Sitzungen (Cascade). Nur owner. */
export async function deleteEvent(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || !canManageEvent(event.level)) redirect('/admin/events')

  await prisma.event.delete({ where: { id: event.id } })
  redirect('/admin/events?deleted=1')
}
