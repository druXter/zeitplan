import { describe, expect, it } from 'vitest'
import { buildReview, formatDeviation, placeByTime, reviewTable, type ReviewCsvItem } from '../../app/lib/review/review'
import { toCsv } from 'suite-kit/web'
import { at, hhmm } from './schedule/fixtures'

let order = 0

function entry(overrides: Partial<ReviewCsvItem> & { id: string; plan: string; min: number }): ReviewCsvItem {
  const { plan, min, ...rest } = overrides
  order++
  return {
    trackId: 'main', sortOrder: order, status: 'PLANNED', insertedLive: false,
    plannedStart: at(plan), plannedDurationMin: min, originalStart: at(plan), originalDurationMin: min,
    actualStart: null, actualEnd: null, title: rest.id, visibility: 'PUBLIC', cancelReason: null, resultNote: null,
    ...rest
  }
}

/** Sitzung mit Tagesordnung: TOP 1 pünktlich, TOP 2 überzogen, TOP 3 vertagt, TOP 4 abgesetzt, Einschub, TOP 5 verlegt. */
function meeting(): ReviewCsvItem[] {
  return [
    entry({ id: 'top1', plan: '18:00', min: 10, actualStart: at('18:02'), actualEnd: at('18:12'), status: 'DONE' }),
    entry({ id: 'top2', plan: '18:10', min: 30, actualStart: at('18:12'), actualEnd: at('18:57'), status: 'DONE', resultNote: 'Antrag angenommen (12/3/1)' }),
    entry({ id: 'top3', plan: '18:40', min: 20, status: 'DEFERRED' }),
    entry({ id: 'top4', plan: '19:00', min: 15, status: 'CANCELLED', cancelReason: 'Antrag zurückgezogen' }),
    entry({ id: 'dringend', plan: '18:57', min: 5, originalStart: null, originalDurationMin: null, insertedLive: true, actualStart: at('18:57'), actualEnd: at('19:05'), status: 'DONE' }),
    entry({ id: 'top5', plan: '19:30', min: 20, originalStart: at('19:15'), actualStart: at('19:30'), actualEnd: at('19:41'), status: 'DONE' })
  ]
}

describe('buildReview (Idee L24, Rückblick)', () => {
  it('vergleicht je Punkt Ursprungsplan und Ist - chronologisch nach tatsächlichem Beginn', () => {
    const { rows } = buildReview(meeting(), ['main'])
    expect(rows.map(r => r.item.id)).toEqual(['top1', 'top2', 'top3', 'dringend', 'top4', 'top5'])
    const top2 = rows.find(r => r.item.id === 'top2')!
    expect(top2).toMatchObject({ outcome: 'done', baseDurationMin: 30, actualDurationMin: 45, startDeviationMin: 2, durationDeviationMin: 15, moved: false })
    expect(hhmm(top2.baseEnd!)).toBe('18:40')
  })

  it('Einschübe haben keinen Plan, verlegte Punkte zählen gegen den Ursprungsplan', () => {
    const { rows } = buildReview(meeting(), ['main'])
    expect(rows.find(r => r.item.id === 'dringend')).toMatchObject({ baseStart: null, startDeviationMin: null, durationDeviationMin: null, actualDurationMin: 8 })
    expect(rows.find(r => r.item.id === 'top5')).toMatchObject({ moved: true, startDeviationMin: 15, durationDeviationMin: -9 })
  })

  it('fasst zusammen: Zeitraum, Abweichung am Ende, Zählung, wo überzogen wurde', () => {
    const { summary } = buildReview(meeting(), ['main'])
    expect(summary.frozen).toBe(true)
    expect([hhmm(summary.plannedStart!), hhmm(summary.plannedEnd!), hhmm(summary.actualStart!), hhmm(summary.actualEnd!)]).toEqual(['18:00', '19:35', '18:02', '19:41'])
    expect(summary.endDeviationMin).toBe(6)
    expect(summary.counts).toEqual({ done: 4, running: 0, cancelled: 1, deferred: 1, skipped: 0, inserted: 1 })
    expect(summary.overruns).toEqual([{ id: 'top2', minutes: 15 }])
  })

  it('ohne Ursprungsplan ist der aktuelle Plan die Grundlage; solange etwas läuft, gibt es keine End-Abweichung', () => {
    const items = [
      entry({ id: 'a', plan: '14:00', min: 30, originalStart: null, originalDurationMin: null, actualStart: at('14:05') }),
      entry({ id: 'b', plan: '14:30', min: 30, originalStart: null, originalDurationMin: null })
    ]
    const { rows, summary } = buildReview(items, ['main'])
    expect(summary.frozen).toBe(false)
    expect(rows.map(r => [r.outcome, r.startDeviationMin])).toEqual([['running', 5], ['skipped', null]])
    expect(summary.endDeviationMin).toBeNull()
  })

  it('formatiert Abweichungen mit Vorzeichen', () => {
    expect([formatDeviation(5), formatDeviation(-10), formatDeviation(0)]).toEqual(['+5', '−10', '±0'])
  })
})

describe('reviewTable + toCsv', () => {
  it('eine Zeile je Punkt, Zahlen als Zahlen, Text gegen Formeln geschützt', () => {
    const items = meeting()
    items[1].resultNote = '=HYPERLINK("x")'
    const { rows } = buildReview(items, ['main'])
    const table = reviewTable(rows, date => `2026-06-20 ${hhmm(date)}`, () => 'Tagesordnung')
    expect(table.rows).toHaveLength(6)
    expect(table.rows[1]).toEqual([
      '2026-06-20 18:10', '2026-06-20 18:40', 30, '2026-06-20 18:12', '2026-06-20 18:57', 45, 2, 15,
      'Tagesordnung', 'top2', 'öffentlich', 'stattgefunden', null, null, null, '=HYPERLINK("x")'
    ])
    const csv = toCsv([table.header, ...table.rows])
    expect(csv.startsWith('﻿Beginn geplant;')).toBe(true)
    expect(csv).toContain(';"\'=HYPERLINK(""x"")"\r\n')
    expect(csv).toContain(';-9;') // negative Abweichung bleibt eine Zahl
    expect(csv).toContain('zurückgestellt, nicht nachgeholt')
  })
})

describe('placeByTime (Idee L7, Protokoll aus rsvp-app)', () => {
  it('ordnet dem Punkt zu, der lief; Pausen, vorher und nachher landen außerhalb', () => {
    const { rows } = buildReview(meeting(), ['main'])
    const entries = ['17:50', '18:05', '18:12', '18:30', '18:58', '19:10', '19:35', '20:00'].map(time => ({ at: at(time), time }))
    const { byItem, outside } = placeByTime(rows, entries)
    expect(byItem.get('top1')?.map(e => e.time)).toEqual(['18:05'])
    // 18:12: TOP 1 endet, TOP 2 beginnt - der zuletzt begonnene gewinnt
    expect(byItem.get('top2')?.map(e => e.time)).toEqual(['18:12', '18:30'])
    expect(byItem.get('dringend')?.map(e => e.time)).toEqual(['18:58'])
    expect(byItem.get('top5')?.map(e => e.time)).toEqual(['19:35'])
    expect(outside.map(e => e.time)).toEqual(['17:50', '19:10', '20:00'])
  })
})
