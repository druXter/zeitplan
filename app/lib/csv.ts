// app/lib/csv.ts

/**
 * CSV für Tabellenprogramme (Semikolon, CRLF, BOM für Excel). Zellen, die mit =, +, -, @, Tab oder CR beginnen,
 * bekommen ein vorangestelltes ' - sonst führte eine Tabellenkalkulation eingegebenen Text (Titel, Notizen) als
 * Formel aus (CSV-Injection). Zahlen (auch negative Abweichungen) bleiben Zahlen.
 */
function cell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return '﻿' + [header, ...rows].map(row => row.map(cell).join(';')).join('\r\n') + '\r\n'
}
