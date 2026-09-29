// app/datenschutz/page.tsx
import Link from 'next/link'

// ENTWURF: Beschreibt, was dieses Tool tatsächlich speichert und verarbeitet. Er ersetzt keine
// Rechtsberatung - vor dem Einsatz mit Externen bitte einmal prüfen lassen und bei jeder
// Änderung der Datenverarbeitung mitpflegen. Stand: Phase 4 (Konten für Planung und Moderation,
// Einladungen, Events mit Freigaben, Programmpunkte mit internen Notizen und geheimen Punkten, Reihen,
// Export/Import, Drosselung, Löschfristen, installierbare App mit Service Worker, Gästeansicht und Tafel mit
// Offline-Stand im Browser, Phase 4: Live-Steuerung mit Verlauf). Mit den folgenden Phasen kommen
// Gast-Sitzungen, Föderation und die Anbindung an rsvp-app dazu - dann hier ergänzen.
//
// Liest Verantwortlichen- und Infrastruktur-Angaben zur Laufzeit aus der (nicht
// versionierten) .env, analog zu app/impressum/page.tsx - force-dynamic verhindert, dass
// Next die Platzhalter beim Docker-Build dauerhaft in die statische HTML einbrennt.
export const dynamic = 'force-dynamic'

export default function DatenschutzPage() {
  const name = process.env.IMPRESSUM_NAME || '[Dein Vorname] [Dein Nachname]'
  const street = process.env.IMPRESSUM_STREET || '[Deine Straße und Hausnummer]'
  const zip = process.env.IMPRESSUM_ZIP || '[PLZ]'
  const city = process.env.IMPRESSUM_CITY || '[Ort]'
  const email = process.env.IMPRESSUM_EMAIL || '[Deine E-Mail-Adresse]'
  const phone = process.env.IMPRESSUM_PHONE || '[Deine Telefonnummer - Optional]'
  const smtpHost = process.env.SMTP_HOST || '[E-Mail-Server noch nicht konfiguriert]'

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow text-gray-800 space-y-6">
        <h1 className="text-3xl font-bold border-b pb-4">Datenschutzerklärung</h1>

        <div>
          <h2 className="font-bold text-lg">1. Verantwortlicher</h2>
          <p className="mt-2">
            Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) für die Datenverarbeitung auf dieser
            Website ist:
          </p>
          <p className="mt-2">
            {name}<br />
            {street}<br />
            {zip} {city}<br />
            E-Mail: {email}<br />
            Telefon: {phone}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Weitere Angaben findest du im <Link href="/impressum" className="underline">Impressum</Link>.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">2. Worum es geht</h2>
          <p className="mt-2">
            Mit dieser Anwendung planen Veranstalter*innen den Ablauf von Veranstaltungen (z. B. einer Hochzeit), und
            Moderator*innen melden während der Veranstaltung Verspätungen und Änderungen. Ein Konto brauchen nur Personen,
            die Veranstaltungen planen oder moderieren – Gäste nicht. Wir verarbeiten nur, was dafür nötig ist (Art. 6
            Abs. 1 lit. b und f DSGVO - Bereitstellung der Funktionen bzw. Betrieb und Sicherheit der Anwendung). Es gibt
            kein Tracking und keine Analyse-Werkzeuge.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">3. Konto (für Planung und Moderation)</h2>
          <p className="mt-2">Für ein Konto speichern wir:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>E-Mail-Adresse, optional einen Namen, deine Rolle, den Zeitpunkt der Anlage und der letzten Anmeldung,</li>
            <li>dein Passwort ausschließlich als <strong>Hash</strong> (scrypt) - niemals im Klartext,</li>
            <li>
              deine Anmelde-Sitzungen (nur ein Hash des Sitzungs-Tokens und das Ablaufdatum, 30 Tage) sowie
              Einmal-Links für Einladung und Passwort-Reset (ebenfalls nur als Hash, befristet).
            </li>
          </ul>
          <p className="mt-2">
            Konten werden nicht öffentlich registriert, sondern von einer berechtigten Person eingeladen. Die eingeladene
            Person legt ihr Passwort selbst über den Einladungslink fest.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">4. Veranstaltungen und Freigaben</h2>
          <p className="mt-2">
            Für eine Veranstaltung speichern wir Titel, Adresse der Seite für Gäste, Datum, Beschreibung, Status, das Konto,
            dem sie gehört, und die Konten, für die sie freigegeben wurde (z. B. Moderator*innen). Sehen können die
            Veranstaltung in der Verwaltung nur das besitzende Konto, die freigegebenen Konten und Administrator*innen. Wird
            ein Konto gelöscht, gehen seine Veranstaltungen an eine*n Administrator*in über.
          </p>
          <p className="mt-2">
            Zum <strong>Ablauf</strong> einer Veranstaltung speichern wir die Programmpunkte mit Titel, Ort, Beschreibung,
            Zeiten und optional einer <strong>internen Notiz</strong> für das Team (z. B. eine Ansprechperson). Interne
            Notizen sehen nur Konten mit Zugriff auf die Veranstaltung, nie Gäste. Bei <strong>geheimen Punkten</strong>{' '}
            (z. B. einer Überraschung) speichern wir zusätzlich, welche Konten den Inhalt sehen dürfen; alle anderen sehen
            nur Zeit und Dauer. Gegenüber dem Betreiber der Anwendung, der Zugriff auf die Datenbank hat, sind auch geheime
            Punkte nicht verborgen. Mehrere Veranstaltungen lassen sich zu einer <strong>Reihe</strong> mit Titel und
            Adresse bündeln.
          </p>
          <p className="mt-2">
            Während der Veranstaltung melden Moderator*innen den Ablauf (Beginn, Ende, Verspätungen, Änderungen). Jede
            solche Meldung speichern wir im <strong>Verlauf</strong> mit dem Konto, das sie gemacht hat, dem Zeitpunkt
            und dem Stand vorher und nachher - damit das Team nachvollziehen und Meldungen rückgängig machen kann. Den
            Verlauf sehen nur Konten mit Zugriff auf die Veranstaltung; er wird mit ihr gelöscht. Wird ein Konto
            gelöscht, bleibt der Eintrag ohne Zuordnung zum Konto stehen.
          </p>
          <p className="mt-2">
            Ein <strong>Export</strong> als Datei enthält den Ablauf mit internen Notizen, aber keine Konten, E-Mail-Adressen
            oder Freigaben; für die Weitergabe einer exportierten Datei ist verantwortlich, wer sie herunterlädt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">5. Ablauf für Gäste</h2>
          <p className="mt-2">
            Die Seite mit dem Ablauf einer Veranstaltung (und die Anzeigetafel vor Ort) kannst du ohne Konto und ohne
            Anmeldung aufrufen. Wir speichern dabei nichts über dich und setzen keine Cookies. Damit die Seite aktuell
            bleibt, fragt dein Browser alle 20 bis 30 Sekunden den neuesten Stand ab, solange die Seite geöffnet ist.
          </p>
          <p className="mt-2">
            Damit du den Ablauf auch bei schlechtem Empfang siehst, merkt sich dein Browser den zuletzt geladenen Stand
            im <strong>lokalen Speicher</strong> (localStorage) deines Geräts – nur den Ablauf, wie ihn alle Gäste
            sehen, für höchstens fünf Veranstaltungen, keine personenbezogenen Daten. Diese Daten verlassen dein Gerät
            nicht; du kannst sie über die Website-Einstellungen deines Browsers jederzeit löschen.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">6. Schutz vor Missbrauch (Drosselung)</h2>
          <p className="mt-2">
            Um das Erraten von Passwörtern und das massenhafte Auslösen von Mails zu verhindern, zählen wir
            fehlgeschlagene Anmeldeversuche und Passwort-Reset-Anfragen. Dazu wird deine <strong>IP-Adresse</strong>{' '}
            ausgelesen und zusammen mit der eingegebenen E-Mail-Adresse <strong>nur als nicht umkehrbarer Hash</strong>{' '}
            für ein kurzes Zeitfenster (15 Minuten bzw. 1 Stunde) gespeichert; veraltete Zähler werden nach spätestens
            24 Stunden entfernt. Rechtsgrundlage ist unser berechtigtes Interesse an der Sicherheit der Anwendung (Art. 6
            Abs. 1 lit. f DSGVO).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">7. E-Mails</h2>
          <p className="mt-2">
            Wir verschicken E-Mails nur für Kontofunktionen: die Einladung zu einem neuen Konto und einen auf Wunsch
            angeforderten Passwort-Reset. Gäste bekommen von diesem Dienst keine Mails. Werbung oder Newsletter gibt es nicht.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">8. Cookies</h2>
          <p className="mt-2">
            Wir setzen ausschließlich technisch notwendige Cookies ein (Art. 6 Abs. 1 lit. b/f DSGVO, § 25 Abs. 2 Nr. 2
            TDDDG) - eine Einwilligung ist dafür nicht erforderlich. Es gibt keine Tracking-, Analyse- oder
            Marketing-Cookies.
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li><code>__Host-session</code> - Anmeldung an deinem Konto (30 Tage)</li>
            <li><code>invite_link</code> - nur kurz (2 Minuten), wenn ein Konto einen Einladungslink zum Weitergeben angezeigt bekommt</li>
          </ul>
          <p className="mt-2">
            Gäste bekommen keine Cookies. Den zuletzt geladenen Ablauf legt die Seite im lokalen Speicher deines Browsers
            ab (siehe Punkt 5) - ebenfalls technisch notwendig, damit die Seite ohne Verbindung weiter funktioniert.
          </p>
          <p className="mt-2">
            <strong>Installation als App:</strong> Der Zeitplan lässt sich auf dem Gerät als App installieren. Dafür
            registriert dein Browser einen Service Worker. Er speichert ausschließlich eine statische Seite
            (&quot;Du bist offline&quot;) zwischen - keine Abläufe, keine Konto- oder Verwaltungsseiten und keine
            personenbezogenen Daten. Ist die Verbindung weg, zeigt diese Seite den im Browser gemerkten Ablauf (Punkt 5) an. Er schickt nichts an uns und ist über die Website-Einstellungen deines Browsers
            jederzeit entfernbar.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">9. Empfänger und Auftragsverarbeiter</h2>
          <p className="mt-2">
            <strong>E-Mail-Versand:</strong> Einladungs- und Passwort-Reset-Mails versenden wir über den E-Mail-Server{' '}
            <code>{smtpHost}</code>. Mit dem Betreiber dieses Servers besteht, soweit es sich um einen externen Anbieter
            handelt, ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.
          </p>
          <p className="mt-2">
            <strong>Hosting:</strong> Diese Anwendung wird auf einem vom Verantwortlichen selbst betriebenen und
            administrierten Server gehostet. Es findet keine Weitergabe der Daten an einen externen Hosting-Anbieter
            statt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">10. Speicherdauer</h2>
          <p className="mt-2">
            Ein Konto wird automatisch gelöscht, wenn du dich <strong>2 Jahre</strong> lang nicht mehr angemeldet
            hast und dir keine Veranstaltungen mehr gehören - inklusive Sitzungen und Freigaben. Administrator-Konten sind
            von dieser automatischen Löschung ausgenommen. Unabhängig davon kannst du jederzeit unter der oben genannten
            Adresse um frühere Löschung deines Kontos bitten.
          </p>
          <p className="mt-2">
            Sitzungen laufen nach 30 Tagen ab, Einladungs- und Reset-Links nach 7 Tagen bzw. 1 Stunde und werden dann
            entfernt. Drossel-Zähler siehe Punkt 6.
          </p>
          <p className="mt-2">
            Veranstaltungen werden <strong>18 Monate nach ihrem Ende</strong> automatisch gelöscht, samt Ablauf,
            internen Notizen, Freigaben und Verlauf.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">11. Deine Rechte</h2>
          <p className="mt-2">
            Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO),
            Einschränkung der Verarbeitung (Art. 18 DSGVO), Datenübertragbarkeit (Art. 20 DSGVO) und Widerspruch (Art.
            21 DSGVO). Bitte kontaktiere uns dafür über die oben genannte Adresse. Dein Passwort kannst du jederzeit
            unter &quot;Mein Konto&quot; selbst ändern.
          </p>
          <p className="mt-2">
            Unabhängig davon hast du das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, wenn du der
            Ansicht bist, dass die Verarbeitung deiner Daten gegen die DSGVO verstößt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">12. Datensicherheit</h2>
          <p className="mt-2">
            Die Übertragung erfolgt verschlüsselt (TLS/HTTPS). Anmelde-Cookies sind <code>httpOnly</code> gesetzt und
            damit per JavaScript nicht auslesbar. Passwörter, Sitzungs-Tokens und Einmal-Links werden nur als Hash
            gespeichert, sodass eine Kopie der Datenbank allein keinen Zugang zu Konten ermöglicht.
          </p>
        </div>

        <div className="pt-6 border-t">
          <Link href="/" className="text-blue-600 hover:underline">
            &larr; Zurück zur Startseite
          </Link>
        </div>
      </div>
    </main>
  )
}
