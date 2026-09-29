import { prisma } from '../prisma'
import { validateSlug } from '../slugs'
import { GUEST_VISIBLE_STATUSES } from './access'

/**
 * Reihen-Übersicht /<reihen-slug> (docs/KONZEPT.md Abschnitt 5): Titel, Datum und Link der Events, die Gäste
 * sehen können (veröffentlicht, live, beendet) - Entwürfe und Archiv fehlen. Mehr verrät die Reihe nicht; ob ein
 * Event einen Zugang verlangt, prüft dessen eigene Seite.
 */
export async function loadPublicSeries(slug: string) {
  if (validateSlug(slug) !== null) return null
  return prisma.series.findUnique({
    where: { slug },
    select: {
      title: true,
      events: {
        where: { status: { in: [...GUEST_VISIBLE_STATUSES] } },
        orderBy: { date: 'asc' },
        select: { slug: true, title: true, date: true, timezone: true }
      }
    }
  })
}
