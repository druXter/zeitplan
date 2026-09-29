import { DEFAULT_EVENT_OPTIONS } from '../events/settings'
import { EXPORT_FORMAT, EXPORT_SCHEMA_VERSION, type ExportItem, type PlanExport } from './exchange'

// Kurzform für die Punkte der Vorlage: Beginn als Ortszeit am Vorlagentag (Sommerzeit, +02:00).
function at(key: string, track: string, time: string, durationMin: number, title: string, extra: Partial<ExportItem> = {}): ExportItem {
  const nextDay = time < '06:00'
  return {
    key,
    track,
    title,
    visibility: 'PUBLIC',
    isAnchor: false,
    mayStartEarly: false,
    start: `2026-06-${nextDay ? '21' : '20'}T${time}:00+02:00`,
    durationMin,
    waitsFor: [],
    ...extra
  }
}

/**
 * Mitgelieferte Vorlage "Hochzeit" (docs/KONZEPT.md Abschnitt 4) im Export-Format - sie läuft beim Anlegen durch
 * dieselbe Prüfung wie jeder Import (tests/unit/planning/template.test.ts) und landet auf dem gewählten Eventtag.
 * Zeigt nebenbei die Möglichkeiten: Puffer, Anker, Team-Spur, interne Notizen, Zusammenführung zweier Spuren
 * (Torte wartet auf das Fotoshooting) und einen geheimen Punkt, den nur das anlegende Konto sieht.
 */
export const WEDDING_TEMPLATE: PlanExport = {
  format: EXPORT_FORMAT,
  schemaVersion: EXPORT_SCHEMA_VERSION,
  title: 'Hochzeit',
  description: '',
  date: '2026-06-20',
  timezone: 'Europe/Berlin',
  settings: DEFAULT_EVENT_OPTIONS,
  tracks: [
    { key: 'ablauf', name: 'Ablauf', visibility: 'PUBLIC' },
    { key: 'brautpaar', name: 'Brautpaar', visibility: 'PUBLIC' },
    { key: 'team', name: 'Team', visibility: 'TEAM' }
  ],
  items: [
    at('ankunft', 'ablauf', '13:30', 30, 'Ankunft der Gäste'),
    at('trauung', 'ablauf', '14:00', 45, 'Trauung', { location: 'Trauort' }),
    at('sekt', 'ablauf', '14:45', 45, 'Sektempfang & Gratulation'),
    at('gruppenfoto', 'ablauf', '15:30', 30, 'Gruppenfoto'),
    at('torte', 'ablauf', '16:30', 15, 'Anschnitt der Hochzeitstorte', { waitsFor: ['shooting'] }),
    at('kaffee', 'ablauf', '16:45', 75, 'Kaffee & Kuchen'),
    at('essen', 'ablauf', '18:30', 120, 'Abendessen', { isAnchor: true, internalNote: 'Beginn mit dem Catering vereinbart' }),
    at('reden', 'ablauf', '20:45', 30, 'Reden', { internalNote: 'Reihenfolge der Reden, Mikrofon 2' }),
    at('tanz', 'ablauf', '21:15', 15, 'Eröffnungstanz', { internalNote: 'Song: …' }),
    at('ueberraschung', 'ablauf', '21:30', 15, 'Überraschung der Trauzeug*innen', { visibility: 'SECRET' }),
    at('party', 'ablauf', '21:45', 180, 'Party'),
    at('snack', 'ablauf', '00:45', 30, 'Mitternachtssnack'),
    at('ausklang', 'ablauf', '01:15', 105, 'Ausklang'),
    at('shooting', 'brautpaar', '16:00', 30, 'Fotoshooting Brautpaar'),
    at('aufbau', 'team', '11:00', 150, 'Aufbau & Deko', { visibility: 'TEAM', internalNote: 'Ansprechperson der Location eintragen' }),
    at('technik', 'team', '13:00', 30, 'Technik-Check', { visibility: 'TEAM', internalNote: 'Mikrofone, Musik, Fernseher für die Tafel' }),
    at('abbau', 'team', '03:00', 60, 'Abbau', { visibility: 'TEAM' })
  ]
}
