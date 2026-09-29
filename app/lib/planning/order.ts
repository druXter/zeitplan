import { isActive } from '../schedule'

const MINUTE = 60_000

type Placeable = { id: string; sortOrder: number; plannedStart: Date }

/**
 * Reihenfolge einer Spur, wenn ein Punkt (neu oder mit geändertem Beginn bzw. neuer Spur) nach seinem Beginn
 * einsortiert wird: vor den ersten Punkt, der später beginnt; bei gleichem Beginn hinter die vorhandenen. Die
 * übrigen Punkte behalten ihre Reihenfolge untereinander - auch wenn sie (nach einem Einschub im Live-Betrieb)
 * nicht nach Uhrzeit sortiert sind. Ergebnis: lückenlos 1..n für die ganze Spur, die Server Action speichert
 * nur geänderte Werte.
 */
export function placeInTrack(track: Placeable[], item: Placeable): { id: string; sortOrder: number }[] {
  const others = track.filter(i => i.id !== item.id).sort((a, b) => a.sortOrder - b.sortOrder)
  let index = others.findIndex(other => other.plannedStart.getTime() > item.plannedStart.getTime())
  if (index === -1) index = others.length
  const ordered = [...others.slice(0, index), item, ...others.slice(index)]
  return ordered.map((entry, position) => ({ id: entry.id, sortOrder: position + 1 }))
}

/** Nächste freie Position am Ende einer Spur. */
export function nextSortOrder(track: { sortOrder: number }[]): number {
  return track.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1
}

type RowSource = Placeable & { trackId: string; plannedDurationMin: number; status: Parameters<typeof isActive>[0]['status'] }

export type PlanRow<T extends RowSource> = {
  item: T
  end: Date
  /**
   * Abstand zum vorherigen aktiven Punkt derselben Spur in Minuten: > 0 Puffer, < 0 Überschneidung, 0 nahtlos,
   * null beim ersten Punkt der Spur und bei zurückgestellten/ausgefallenen Punkten.
   */
  gapMin: number | null
  /** Nachbarn unter den aktiven Punkten derselben Spur - Ziel von "nach oben"/"nach unten" (swapAdjacent). */
  previousId: string | null
  nextId: string | null
}

/**
 * Zeilen der Planungsliste: pro Spur in der Reihenfolge der Kette (sortOrder), mit Puffer bzw. Überschneidung
 * zum Vorgänger und den Nachbarn fürs Umsortieren. Für den Tab "Alle" sortiert allRows die Zeilen danach
 * chronologisch.
 */
export function trackRows<T extends RowSource>(items: T[]): PlanRow<T>[] {
  const byTrack = new Map<string, T[]>()
  for (const item of items) byTrack.set(item.trackId, [...(byTrack.get(item.trackId) ?? []), item])

  const rows = new Map<string, PlanRow<T>>()
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder)
    const active = list.filter(isActive)
    for (const item of list) {
      const index = active.indexOf(item)
      const previous = index > 0 ? active[index - 1] : null
      const next = index >= 0 && index < active.length - 1 ? active[index + 1] : null
      const end = new Date(item.plannedStart.getTime() + item.plannedDurationMin * MINUTE)
      const gapMin = previous
        ? Math.round((item.plannedStart.getTime() - previous.plannedStart.getTime()) / MINUTE) - previous.plannedDurationMin
        : null
      rows.set(item.id, { item, end, gapMin, previousId: previous?.id ?? null, nextId: next?.id ?? null })
    }
  }
  return [...byTrack.values()].flat().map(item => rows.get(item.id)!)
}

/** Alle Spuren chronologisch zusammengeführt (Beginn, dann Reihenfolge der Spuren, dann Kette). */
export function allRows<T extends RowSource>(items: T[], trackOrder: string[]): PlanRow<T>[] {
  const rank = new Map(trackOrder.map((id, index) => [id, index]))
  return trackRows(items).sort((a, b) =>
    a.item.plannedStart.getTime() - b.item.plannedStart.getTime() ||
    (rank.get(a.item.trackId) ?? 0) - (rank.get(b.item.trackId) ?? 0) ||
    a.item.sortOrder - b.item.sortOrder
  )
}
