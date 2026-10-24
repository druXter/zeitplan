// app/lib/mail.ts
import nodemailer from 'nodemailer'
import { renderMail } from 'suite-kit/web'

type RenderedMail = ReturnType<typeof renderMail>
import { APP_NAME } from './app'

// Gleicher Transporter-Aufbau wie in Seating und rsvp-app - laufen die Tools über dasselbe
// Postfach, deckt der dort abgeschlossene AVV auch diesen Versand ab. Mails gibt es nur für
// Einladungen und Passwort-Reset, Gäste bekommen keine (docs/KONZEPT.md Abschnitt 10).
// SMTP_HOST bewusst nicht vorausgesetzt: bleibt es leer, bricht der Versand unten früh ab
// statt einen kaputten Transporter zu nutzen. Die Konto-Funktionen funktionieren dann
// trotzdem - Einladungslinks werden dem einladenden Konto direkt auf dem Bildschirm
// angezeigt (siehe app/admin/users/page.tsx).
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export function isMailConfigured(): boolean {
  return !!process.env.SMTP_HOST
}

/** Marke im Kopf jeder Mail, wie in der Kopfzeile des Tools. */
export const MAIL_BRAND = { letter: 'Z', name: APP_NAME }

/**
 * Mail mit Anrede, Text, einem Knopf und Kleingedrucktem - aus den Bausteinen der Suite (renderMail aus suite-kit,
 * dieselbe Vorlage in allen Tools). HTML und Klartext aus demselben Inhalt, alles escapet.
 */
function layout(heading: string, body: string, buttonLabel: string, link: string, footer: string): RenderedMail {
  return renderMail({
    brand: MAIL_BRAND,
    heading,
    blocks: [{ kind: 'p', text: 'Hallo,' }, { kind: 'p', text: body }, { kind: 'button', label: buttonLabel, href: link }],
    footer
  })
}

/** Verschickt eine Mail, Absender ist immer SMTP_FROM. false, wenn SMTP fehlt oder der Versand scheitert. */
async function send(toEmail: string, subject: string, { html, text }: RenderedMail): Promise<boolean> {
  if (!isMailConfigured()) return false

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: toEmail,
      subject,
      text,
      html,
      envelope: { from: process.env.SMTP_USER || undefined, to: toEmail }
    })
    return true
  } catch (error) {
    console.error(`Fehler beim Senden einer Mail an ${toEmail}:`, error)
    return false
  }
}

/** Einladung zu einem neu angelegten Konto - der Link legt das erste Passwort fest. */
export async function sendInviteEmail(toEmail: string, link: string, validDays: number): Promise<boolean> {
  return send(
    toEmail,
    `Einladung zu ${APP_NAME}`,
    layout(
      `Einladung zu ${APP_NAME}`,
      `Für dich wurde ein Konto angelegt. Lege jetzt dein Passwort fest - der Link ist ${validDays} Tage gültig und nur einmal nutzbar.`,
      'Passwort festlegen',
      link,
      'Falls du damit nicht gerechnet hast, ignoriere diese Mail einfach.'
    )
  )
}

/** Passwort-Reset auf Wunsch des Kontoinhabers. */
export async function sendPasswordResetEmail(toEmail: string, link: string): Promise<boolean> {
  return send(
    toEmail,
    `Passwort zurücksetzen - ${APP_NAME}`,
    layout(
      'Passwort zurücksetzen',
      'Für dein Konto wurde ein neues Passwort angefordert. Der Link ist 1 Stunde gültig und nur einmal nutzbar.',
      'Neues Passwort festlegen',
      link,
      'Falls du das nicht warst, ignoriere diese Mail - dein Passwort bleibt unverändert.'
    )
  )
}
