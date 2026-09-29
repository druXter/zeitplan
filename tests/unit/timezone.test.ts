import { describe, expect, it } from 'vitest'
import {
  daysBetween, formatClock, formatDate, formatDuration, formatItemClock, formatDateTime, formatDeadline, formatRange, shiftDays, toZonedIso, utcToZonedDate, utcToZonedInput,
  zonedDateToUtc, zonedInputToUtc
} from '../../app/lib/timezone'

describe('zonedInputToUtc', () => {
  it('rechnet Winter- und Sommerzeit in Berlin um', () => {
    expect(zonedInputToUtc('2026-12-12T19:00')?.toISOString()).toBe('2026-12-12T18:00:00.000Z')
    expect(zonedInputToUtc('2026-07-01T19:00')?.toISOString()).toBe('2026-07-01T17:00:00.000Z')
  })

  it('schiebt eine nicht existierende Uhrzeit (Frühjahr) eine Stunde vor', () => {
    // 29.03.2026, 02:30 gibt es in Berlin nicht - gemeint ist 03:30 Sommerzeit.
    expect(zonedInputToUtc('2026-03-29T02:30')?.toISOString()).toBe('2026-03-29T01:30:00.000Z')
  })

  it('nimmt bei doppelter Uhrzeit (Herbst) die spätere', () => {
    // 25.10.2026, 02:30 gibt es zweimal - die spätere ist 02:30 Winterzeit = 01:30 UTC.
    expect(zonedInputToUtc('2026-10-25T02:30')?.toISOString()).toBe('2026-10-25T01:30:00.000Z')
  })

  it('lehnt ungültige Eingaben ab', () => {
    for (const value of ['', '2026-02-31T10:00', '2026-13-01T10:00', '2026-01-01T24:00', '2026-01-01 10:00', '2026-01-01T10:00:00', 'morgen']) {
      expect(zonedInputToUtc(value), value).toBeNull()
    }
  })

  it('funktioniert mit anderen Zeitzonen', () => {
    expect(zonedInputToUtc('2026-12-12T19:00', 'America/New_York')?.toISOString()).toBe('2026-12-13T00:00:00.000Z')
  })
})

describe('utcToZonedInput', () => {
  it('ist die Umkehrung von zonedInputToUtc', () => {
    for (const value of ['2026-12-12T19:00', '2026-07-01T00:15', '2026-03-29T03:30', '2026-10-25T01:59']) {
      expect(utcToZonedInput(zonedInputToUtc(value) as Date)).toBe(value)
    }
  })
})

describe('Anzeige', () => {
  it('formatiert Zeitpunkte und Zeiträume in der Event-Zeitzone', () => {
    const start = new Date('2026-12-12T18:00:00Z')
    expect(formatDateTime(start)).toBe('Samstag, 12. Dezember 2026, 19:00 Uhr')
    expect(formatRange(start, new Date('2026-12-12T22:30:00Z'))).toBe('Samstag, 12. Dezember 2026, 19:00–23:30 Uhr')
    expect(formatRange(start, new Date('2026-12-13T02:00:00Z'))).toBe('Samstag, 12. Dezember 2026, 19:00 Uhr bis Sonntag, 13. Dezember 2026, 03:00 Uhr')
  })

  it('Frist am selben Tag kurz, sonst vollständig (Tagesgrenze in der Event-Zeitzone)', () => {
    const now = new Date('2026-12-12T22:30:00Z') // 23:30 in Berlin
    expect(formatDeadline(new Date('2026-12-12T22:50:00Z'), 'Europe/Berlin', now)).toBe('heute, 23:50 Uhr')
    expect(formatDeadline(new Date('2026-12-12T23:10:00Z'), 'Europe/Berlin', now)).toBe('Sonntag, 13. Dezember 2026, 00:10 Uhr')
  })
})

describe('Tag eines Events', () => {
  it('ist der Beginn des Tages in der Event-Zeitzone, auch am Tag der Zeitumstellung', () => {
    expect(zonedDateToUtc('2026-12-12')?.toISOString()).toBe('2026-12-11T23:00:00.000Z')
    expect(zonedDateToUtc('2026-07-01')?.toISOString()).toBe('2026-06-30T22:00:00.000Z')
    // 25.10.2026: Mitternacht ist noch Sommerzeit.
    expect(zonedDateToUtc('2026-10-25')?.toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(utcToZonedDate(zonedDateToUtc('2026-10-25') as Date)).toBe('2026-10-25')
    expect(formatDate(zonedDateToUtc('2026-10-24') as Date)).toBe('Samstag, 24. Oktober 2026')
  })

  it('lehnt ungültige Eingaben ab', () => {
    for (const value of ['', '2026-02-30', '2026-13-01', '24.10.2026', '2026-10-24T10:00']) {
      expect(zonedDateToUtc(value), value).toBeNull()
    }
  })
})

describe('Export und Verschieben', () => {
  it('ISO mit Versatz ist eindeutig, auch in der doppelten Stunde', () => {
    expect(toZonedIso(new Date('2026-06-20T12:00:00Z'))).toBe('2026-06-20T14:00:00+02:00')
    // 25.10.2026: 02:30 gibt es zweimal - einmal Sommer-, einmal Winterzeit.
    expect(toZonedIso(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-25T02:30:00+02:00')
    expect(toZonedIso(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-25T02:30:00+01:00')
    expect(new Date(toZonedIso(new Date('2026-10-25T01:30:00Z'))).toISOString()).toBe('2026-10-25T01:30:00.000Z')
  })

  it('Tage zwischen zwei Eventtagen', () => {
    expect(daysBetween(zonedDateToUtc('2026-06-20')!, zonedDateToUtc('2026-06-27')!)).toBe(7)
    expect(daysBetween(zonedDateToUtc('2026-10-24')!, zonedDateToUtc('2026-10-26')!)).toBe(2)
    expect(daysBetween(zonedDateToUtc('2026-06-27')!, zonedDateToUtc('2026-06-20')!)).toBe(-7)
  })

  it('verschiebt um Tage und behält die Uhrzeit, auch über die Zeitumstellung', () => {
    const summer = zonedInputToUtc('2026-10-24T14:00')!
    const winter = shiftDays(summer, 1)
    expect(utcToZonedInput(winter)).toBe('2026-10-25T14:00')
    expect(winter.getTime() - summer.getTime()).toBe(25 * 60 * 60 * 1000)
    expect(utcToZonedInput(shiftDays(zonedInputToUtc('2026-06-21T01:30')!, -1))).toBe('2026-06-20T01:30')
    const same = new Date('2026-10-25T00:30:00Z')
    expect(shiftDays(same, 0)).toBe(same)
  })

  it('Uhrzeit kurz', () => {
    expect(formatClock(new Date('2026-06-20T12:05:00Z'))).toBe('14:05')
  })
})

describe('Uhrzeit und Dauer eines Programmpunkts', () => {
  it('am Eventtag nur die Uhrzeit, danach mit Wochentag - auch in der Nacht der Zeitumstellung', () => {
    const day = zonedDateToUtc('2026-10-24')!
    expect(formatItemClock(new Date('2026-10-24T12:00:00Z'), day)).toBe('14:00')
    expect(formatItemClock(new Date('2026-10-24T22:45:00Z'), day)).toBe('So 00:45')
    expect(formatItemClock(new Date('2026-10-25T02:00:00Z'), day)).toBe('So 03:00')
  })

  it('Dauer', () => {
    expect(formatDuration(45)).toBe('45 Min')
    expect(formatDuration(120)).toBe('2 Std')
    expect(formatDuration(90)).toBe('1 Std 30 Min')
  })
})
