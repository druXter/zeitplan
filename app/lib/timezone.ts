// app/lib/timezone.ts

/**
 * Events speichern Zeiten in UTC, eingegeben und angezeigt werden sie in der Zeitzone des Events
 * (Event.timezone, vorerst immer Europe/Berlin). Ohne Zusatzbibliothek über Intl - der Server kann
 * dabei in jeder Zeitzone laufen, maßgeblich ist nur die des Events.
 */

export const DEFAULT_TIMEZONE = 'Europe/Berlin'

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** Abstand Ortszeit − UTC in Millisekunden zum Zeitpunkt utcMs. */
function offsetAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMs))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/**
 * Wandelt "2026-12-12T19:00" (Wert eines datetime-local-Feldes, Ortszeit des Events) in einen
 * UTC-Zeitpunkt. Null bei ungültiger Eingabe (Format oder Datum wie 31.02.).
 *
 * Zeitumstellung: Eine Uhrzeit, die es nicht gibt (Frühjahr, 02:30), rutscht eine Stunde nach
 * vorn (03:30 Sommerzeit); eine doppelte (Herbst, 02:30) gilt als die spätere (Winterzeit).
 */
export function zonedInputToUtc(value: string, timeZone: string = DEFAULT_TIMEZONE): Date | null {
  const match = LOCAL_PATTERN.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const check = new Date(wall)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null

  let utc = wall - offsetAt(wall, timeZone)
  const corrected = offsetAt(utc, timeZone)
  if (corrected !== wall - utc) utc = wall - corrected
  return new Date(utc)
}

/** Umkehrung für den Startwert eines datetime-local-Feldes. */
export function utcToZonedInput(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const local = new Date(date.getTime() + offsetAt(date.getTime(), timeZone))
  return local.toISOString().slice(0, 16)
}

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** "Samstag, 12. Dezember 2026, 19:00 Uhr" */
export function formatDateTime(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return `${formatDate(date, timeZone)}, ${formatTime(date, timeZone)} Uhr`
}

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

/** Frist kurz angeben: am selben Tag "heute, 15:07 Uhr", sonst vollständig. */
export function formatDeadline(date: Date, timeZone: string = DEFAULT_TIMEZONE, now = new Date()): string {
  return dayKey(date, timeZone) === dayKey(now, timeZone) ? `heute, ${formatTime(date, timeZone)} Uhr` : formatDateTime(date, timeZone)
}

/**
 * Zeitraum eines Events: am selben Tag "Samstag, 12. Dezember 2026, 19:00–23:30 Uhr",
 * sonst beide Zeitpunkte vollständig.
 */
export function formatRange(start: Date, end: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  if (dayKey(start, timeZone) === dayKey(end, timeZone)) {
    return `${formatDateTime(start, timeZone).replace(/ Uhr$/, '')}–${formatTime(end, timeZone)} Uhr`
  }
  return `${formatDateTime(start, timeZone)} bis ${formatDateTime(end, timeZone)}`
}

/** Kurz für Listen: "12.12.2026, 19:00" */
export function formatShort(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return `${dayKey(date, timeZone)}, ${formatTime(date, timeZone)}`
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Tag eines Events ("2026-10-24", Wert eines date-Feldes) als Beginn dieses Tages in der Zeitzone des
 * Events (00:00 Ortszeit) in UTC. Null bei ungültiger Eingabe.
 */
export function zonedDateToUtc(value: string, timeZone: string = DEFAULT_TIMEZONE): Date | null {
  return DATE_PATTERN.test(value) ? zonedInputToUtc(`${value}T00:00`, timeZone) : null
}

/** Umkehrung für den Startwert eines date-Feldes. */
export function utcToZonedDate(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return utcToZonedInput(date, timeZone).slice(0, 10)
}

/** "Samstag, 24. Oktober 2026" */
export function formatDate(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

/**
 * Zeitpunkt als ISO-8601 mit dem Versatz der Zeitzone: "2026-10-25T02:30:00+01:00". Eindeutig (auch in der
 * doppelten Stunde der Zeitumstellung) und trotzdem lesbar - für Export-Dateien.
 */
export function toZonedIso(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const offsetMin = Math.round(offsetAt(date.getTime(), timeZone) / 60_000)
  const local = new Date(date.getTime() + offsetMin * 60_000).toISOString().slice(0, 19)
  const abs = Math.abs(offsetMin)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local}${offsetMin < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** Ganze Kalendertage zwischen zwei Eventtagen (Beginn des Tages als UTC-Zeitpunkt, siehe zonedDateToUtc). */
export function daysBetween(from: Date, to: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const day = (date: Date) => {
    const [year, month, dayOfMonth] = utcToZonedDate(date, timeZone).split('-').map(Number)
    return Date.UTC(year, month - 1, dayOfMonth)
  }
  return Math.round((day(to) - day(from)) / (24 * 60 * 60 * 1000))
}

/**
 * Verschiebt einen Zeitpunkt um ganze Kalendertage und behält dabei die Uhrzeit in der Zeitzone bei (14:00
 * bleibt 14:00, auch über eine Zeitumstellung hinweg) - für Duplizieren, Import und ein geändertes
 * Eventdatum. Eine Uhrzeit, die es am Zieltag nicht gibt oder doppelt gibt, löst zonedInputToUtc auf.
 */
export function shiftDays(date: Date, days: number, timeZone: string = DEFAULT_TIMEZONE): Date {
  if (days === 0) return date
  const local = utcToZonedInput(date, timeZone)
  const [year, month, dayOfMonth] = local.slice(0, 10).split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1, dayOfMonth + days)).toISOString().slice(0, 10)
  return zonedInputToUtc(`${target}${local.slice(10)}`, timeZone) ?? date
}

/** "14:00" in der Zeitzone des Events. */
export function formatClock(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return formatTime(date, timeZone)
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/**
 * Uhrzeit eines Programmpunkts: "14:00", an einem anderen Tag als dem Eventtag mit Wochentag ("So 00:45") -
 * für Abläufe über Mitternacht. eventDate: Beginn des Eventtags (siehe zonedDateToUtc). Auch im Browser nutzbar;
 * die Wochentage stehen hier fest, weil Node und Browser sie per Intl unterschiedlich abkürzen ("So"/"So.") und
 * die Seite sonst beim Hydrieren abweicht.
 */
export function formatItemClock(date: Date, eventDate: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const time = formatTime(date, timeZone)
  const day = utcToZonedDate(date, timeZone)
  if (day === utcToZonedDate(eventDate, timeZone)) return time
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  return `${WEEKDAYS[new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay()]} ${time}`
}

/** Dauer: "45 Min", "2 Std", "1 Std 30 Min". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} Min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours} Std` : `${hours} Std ${minutes % 60} Min`
}
