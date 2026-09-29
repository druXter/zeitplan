/**
 * Einteilung eines chronologischen Ablaufs in "Jetzt", "Als Nächstes", "Später" und "Vorbei" - für
 * Gästeansicht, Tafel und Team-Ansicht. Nur Darstellung: Ob ein Punkt läuft oder vorbei ist, hat vorher der
 * Prognose-Kern entschieden (Phase bzw. GuestStatus); hier kommt keine Uhr dazu. Rein und im Browser nutzbar.
 */
export type TimelineState = 'upcoming' | 'now' | 'past' | 'cancelled'

export type TimelineSections<T> = {
  now: T[]
  /** Die nächsten Punkte mit demselben (frühesten) Beginn, davor liegende Ausfälle eingeschlossen. */
  next: T[]
  later: T[]
  past: T[]
}

/**
 * items: chronologisch sortiert (wie toGuestView sie liefert). Ausgefallene Punkte haben keine eigene Phase -
 * sie zählen als vorbei, wenn ein späterer Punkt schon läuft oder vorbei ist, sonst als kommend.
 */
export function timelineSections<T>(items: T[], state: (item: T) => TimelineState, start: (item: T) => number): TimelineSections<T> {
  let lastReached = -1
  items.forEach((item, index) => {
    const s = state(item)
    if (s === 'now' || s === 'past') lastReached = index
  })

  const sections: TimelineSections<T> = { now: [], next: [], later: [], past: [] }
  const upcoming: T[] = []
  items.forEach((item, index) => {
    const s = state(item)
    if (s === 'now') sections.now.push(item)
    else if (s === 'past' || (s === 'cancelled' && index < lastReached)) sections.past.push(item)
    else upcoming.push(item)
  })

  const first = upcoming.find(item => state(item) !== 'cancelled')
  if (!first) {
    sections.later = upcoming
    return sections
  }
  const nextStart = start(first)
  let lastNext = upcoming.indexOf(first)
  upcoming.forEach((item, index) => { if (state(item) !== 'cancelled' && start(item) === nextStart) lastNext = Math.max(lastNext, index) })
  sections.next = upcoming.slice(0, lastNext + 1)
  sections.later = upcoming.slice(lastNext + 1)
  return sections
}
