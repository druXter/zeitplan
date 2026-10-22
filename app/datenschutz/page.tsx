// app/datenschutz/page.tsx
import Link from 'next/link'

// ENTWURF: Beschreibt, was dieses Tool tatsächlich speichert und verarbeitet. Er ersetzt keine
// Rechtsberatung - vor dem Einsatz mit Externen bitte einmal prüfen lassen und bei jeder
// Änderung der Datenverarbeitung mitpflegen. Stand: Phase 4 (Konten für Planung und Moderation,
// Einladungen, Events mit Freigaben, Programmpunkte mit internen Notizen und geheimen Punkten, Reihen,
// Export/Import, Drosselung, Löschfristen, installierbare App mit Service Worker, Gästeansicht und Tafel mit
// Offline-Stand im Browser, Phase 4: Live-Steuerung mit Verlauf, Phase 5: Zugangscode mit Gast-Sitzung und
// Drosselung, Zugang per Konto, Tafel-Link, Phase 6: Anmeldung mit Konten anderer Tools der Suite, Phase 7:
// Zugang über eine Zusage in rsvp-app; Abruf der Programmpunkte durch Schichten; Durchsagen, Protokollnotizen und
// Rückblick als CSV; Orte mit Adresse und Routen-Link, Zuständige je Punkt, Team-Link für Dienstleister, Druckansichten;
// Vorwarnung fürs Team per Push mit Push-Abo, Einstellung und Versandprotokoll; Protokoll von Sitzungen aus rsvp-app im
// Rückblick, nur angezeigt; Erinnerungen für Gäste per Push mit Push-Abo ohne Namen, gebunden an den Zugang).
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
    <main className="py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 p-8 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm text-gray-800 dark:text-gray-200 space-y-6">
        <h1 className="text-3xl font-semibold border-b pb-4">Datenschutzerklärung</h1>

        <div>
          <h2 className="font-semibold text-lg">1. Verantwortlicher</h2>
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
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Weitere Angaben findest du im <Link href="/impressum" className="underline">Impressum</Link>.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">2. Worum es geht</h2>
          <p className="mt-2">
            Mit dieser Anwendung planen Veranstalter*innen den Ablauf von Veranstaltungen (z. B. einer Hochzeit), und
            Moderator*innen melden während der Veranstaltung Verspätungen und Änderungen. Ein Konto brauchen nur Personen,
            die Veranstaltungen planen oder moderieren – Gäste nicht. Wir verarbeiten nur, was dafür nötig ist (Art. 6
            Abs. 1 lit. b und f DSGVO - Bereitstellung der Funktionen bzw. Betrieb und Sicherheit der Anwendung). Es gibt
            kein Tracking und keine Analyse-Werkzeuge.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">3. Konto (für Planung und Moderation)</h2>
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
          <h2 className="font-semibold text-lg">3a. Anmeldung mit dem Konto eines anderen Tools (optional)</h2>
          <p className="mt-2">
            Ist dies vom Betreiber eingerichtet, kannst du dich hier mit einem Konto eines verbundenen Tools anmelden
            (z.B. rsvp-app), und umgekehrt kann man sich dort mit einem Konto von hier anmelden. Das geschieht{' '}
            <strong>nur, wenn du es aktiv anstößt</strong>, und nur zwischen Tools, die der Betreiber ausdrücklich
            freigegeben hat.
          </p>
          <p className="mt-2">
            Dabei übermittelt das Tool, bei dem du angemeldet bist, an das andere Tool eine kurz gültige (etwa eine
            Minute), digital signierte Bestätigung mit <strong>deiner Konto-Kennung, E-Mail-Adresse, ggf. deinem
            Namen und deiner Rolle</strong>. Dein Passwort und deine Sitzung werden nie übermittelt. Wir speichern zu
            einem verknüpften Konto nur, welches Tool es ist und die Konto-Kennung dort. Je nach Einstellung legen wir
            beim ersten Mal ein Konto (ohne Passwort) für dich an, oder du verknüpfst ein bestehendes Konto selbst unter
            &quot;Mein Konto&quot;. Dort kannst du die Verknüpfung auch wieder entfernen. Ändert sich deine
            E-Mail-Adresse beim anderen Tool, übernehmen wir sie bei der nächsten Anmeldung, wenn dein Konto hier
            kein eigenes Passwort hat.
          </p>
          <p className="mt-2">
            Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (die von dir angestoßene Anmeldung).
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">4. Veranstaltungen und Freigaben</h2>
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
            Adresse bündeln. Zu einer Veranstaltung können <strong>Orte</strong> mit Name und Anschrift (z. B. Kirche und
            Feier-Location) gespeichert sein.
          </p>
          <p className="mt-2">
            Pro Programmpunkt kann das Team <strong>Zuständige</strong> eintragen (Konten mit Zugriff auf die
            Veranstaltung). Konten mit Zugriff sehen sie mit Name bzw. E-Mail-Adresse. Die Veranstalter*innen können
            außerdem einen <strong>Team-Link</strong> für Dienstleister (z. B. DJ oder Catering) einschalten: Wer ihn hat,
            sieht ohne Konto den Ablauf fürs Team mit internen Notizen und den <em>Namen</em> der Zuständigen (keine
            E-Mail-Adressen). Der Link lässt sich jederzeit ausschalten oder neu erzeugen; danach funktioniert der alte
            nicht mehr. Über den Team-Link speichern wir nichts über die Person, die ihn öffnet.
          </p>
          <p className="mt-2">
            <strong>Vorwarnung fürs Team (freiwillig):</strong> Wer mit Konto eine Vorwarnung für eine Veranstaltung
            einschaltet, für den speichern wir, wofür (eigene oder alle Punkte) und wie viele Minuten vorher. Damit jede
            Vorwarnung nur einmal kommt, speichern wir je Programmpunkt und Konto, wann sie verschickt wurde und für welchen
            Beginn; diese Einträge löschen wir nach 7 Tagen. Die Einstellung wird mit der Veranstaltung oder dem Konto
            gelöscht oder wenn du sie ausschaltest.
          </p>
          <p className="mt-2">
            Während der Veranstaltung melden Moderator*innen den Ablauf (Beginn, Ende, Verspätungen, Änderungen). Jede
            solche Meldung speichern wir im <strong>Verlauf</strong> mit dem Konto, das sie gemacht hat, dem Zeitpunkt
            und dem Stand vorher und nachher - damit das Team nachvollziehen und Meldungen rückgängig machen kann. Den
            Verlauf sehen nur Konten mit Zugriff auf die Veranstaltung; er wird mit ihr gelöscht. Wird ein Konto
            gelöscht, bleibt der Eintrag ohne Zuordnung zum Konto stehen.
          </p>
          <p className="mt-2">
            Eine <strong>Durchsage</strong> an die Gäste (ein kurzer Text mit Zeitpunkt und Ablaufzeit) speichern wir an
            der Veranstaltung, bis sie ersetzt oder entfernt wird; sie erscheint in der Ansicht für Gäste und steht
            zusätzlich mit dem meldenden Konto im Verlauf. Zu jedem Programmpunkt kann das Team eine
            <strong> Protokollnotiz</strong> festhalten (z. B. das Ergebnis eines Tagesordnungspunkts). Protokollnotizen
            sehen wie interne Notizen nur Konten mit Zugriff auf die Veranstaltung, nie Gäste; sie sind nicht Teil des
            Exports und werden mit der Veranstaltung gelöscht. Der <strong>Rückblick</strong> lässt sich als CSV-Datei
            herunterladen - für deren Weitergabe ist verantwortlich, wer sie herunterlädt.
          </p>
          <p className="mt-2">
            Ein <strong>Export</strong> als Datei enthält den Ablauf mit internen Notizen und Orten, aber keine Konten,
            E-Mail-Adressen, Zuständigen oder Freigaben; für die Weitergabe einer exportierten Datei ist verantwortlich, wer
            sie herunterlädt. Dasselbe gilt für den ausgedruckten <strong>Regieplan</strong> (mit internen Notizen und den
            Namen der Zuständigen).
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">5. Ablauf für Gäste</h2>
          <p className="mt-2">
            Die Seite mit dem Ablauf einer Veranstaltung (und die Anzeigetafel vor Ort) kannst du ohne Konto aufrufen.
            Ist sie öffentlich, speichern wir dabei nichts über dich und setzen keine Cookies. Damit die Seite aktuell
            bleibt, fragt dein Browser alle 20 bis 30 Sekunden den neuesten Stand ab, solange die Seite geöffnet ist.
          </p>
          <p className="mt-2">
            Ist der Ablauf mit einem <strong>Zugangscode</strong> geschützt (z. B. von der Einladung), merkt sich dein
            Browser nach der richtigen Eingabe den Zugang in einem Cookie (siehe Punkt 8). Bei uns liegt dazu nur ein
            Hash dieses Cookies, die Veranstaltung und das Ablaufdatum – kein Name, keine E-Mail-Adresse. Der Zugang
            endet einen Tag nach der Veranstaltung oder früher, wenn die Veranstalter*innen den Code ändern. Bei
            Veranstaltungen, die nur mit Konto sichtbar sind, gilt deine Anmeldung (Punkt 3).
          </p>
          <p className="mt-2">
            Ist der Ablauf mit einer Veranstaltung in <strong>rsvp-app</strong> verknüpft, öffnest du ihn über deine
            Zusage dort. rsvp-app übermittelt uns dabei nur eine Kennung deiner Zusage und der Veranstaltung (kein Name,
            keine E-Mail-Adresse); wir speichern sie zu deinem Zugang wie oben. Sagst du in rsvp-app ab, meldet rsvp-app
            uns das mit derselben Kennung, und wir beenden deinen Zugang.
          </p>
          <p className="mt-2">
            <strong>Protokoll von Sitzungen:</strong> Geben die Veranstalter*innen es in rsvp-app frei, zeigt der
            Rückblick einer verknüpften Veranstaltung, wer wann gekommen und gegangen ist (Name und Uhrzeit aus dem
            Einlass), und die Ergebnisse der Abstimmungen einer Sitzung im Abstimmungstool – bei namentlichen
            Abstimmungen mit den Namen, bei geheimen ohne. Sehen können das nur angemeldete Konten mit Zugriff auf die
            Veranstaltung. Wir rufen diese Angaben bei jedem Öffnen des Rückblicks frisch bei rsvp-app ab und speichern
            sie nicht. Rechtsgrundlage ist das berechtigte Interesse der Veranstalter*innen an einem vollständigen
            Protokoll (Art. 6 Abs. 1 lit. f DSGVO).
          </p>
          <p className="mt-2">
            Steht an einem Programmpunkt eine Adresse, öffnet <strong>„Route öffnen“</strong> einen Kartendienst (Google
            Maps oder einen von den Veranstalter*innen hinterlegten Link) in einem neuen Tab. Erst mit diesem Klick
            verbindet sich dein Browser mit dem Kartendienst, und es gilt dessen Datenschutzerklärung; vorher wird nichts
            von dort geladen.
          </p>
          <p className="mt-2">
            Damit du den Ablauf auch bei schlechtem Empfang siehst, merkt sich dein Browser den zuletzt geladenen Stand
            im <strong>lokalen Speicher</strong> (localStorage) deines Geräts – nur den Ablauf, wie ihn alle Gäste
            sehen, für höchstens fünf Veranstaltungen, keine personenbezogenen Daten. Diese Daten verlassen dein Gerät
            nicht; du kannst sie über die Website-Einstellungen deines Browsers jederzeit löschen.
          </p>
          <p className="mt-2">
            <strong>Erinnerungen aufs Handy (freiwillig):</strong> Bieten die Veranstalter*innen Erinnerungen an und
            schaltest du sie in der Ansicht des Ablaufs ein, speichern wir das Push-Abo deines Browsers (eine Adresse beim
            Push-Dienst des Browser-Herstellers und zwei Schlüssel) zu dieser Veranstaltung – keinen Namen, keine
            E-Mail-Adresse. Ist der Ablauf geschützt, verknüpfen wir das Abo mit deinem Zugang (Zugangscode, Zusage in
            rsvp-app oder Anmeldung); endet der Zugang, wird es gelöscht. Kurz vor Programmpunkten (und, wenn
            eingestellt, bei größeren Verschiebungen) schicken wir dir eine Mitteilung mit Titel, Uhrzeit und Ort des
            Punkts – nur, was ohnehin im Ablauf für Gäste steht. Damit jede Mitteilung nur einmal kommt, speichern wir je
            Programmpunkt, wann sie verschickt wurde (für alle Gäste gemeinsam, 7 Tage). Das Abo löschen wir, wenn du die
            Erinnerungen ausschaltest, die Veranstalter*innen sie oder den Zugang ändern, spätestens einen Tag nach der
            Veranstaltung. Zustellung und Verschlüsselung wie unter Punkt 8 beschrieben. Rechtsgrundlage ist deine
            Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die du jederzeit durch Ausschalten widerrufen kannst.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">6. Schutz vor Missbrauch (Drosselung)</h2>
          <p className="mt-2">
            Um das Erraten von Passwörtern und das massenhafte Auslösen von Mails zu verhindern, zählen wir
            fehlgeschlagene Anmeldeversuche, Passwort-Reset-Anfragen, falsch eingegebene Zugangscodes und das Einschalten
            von Erinnerungen für Gäste. Dazu wird
            deine <strong>IP-Adresse</strong> ausgelesen und – zusammen mit der eingegebenen E-Mail-Adresse bzw. der
            Veranstaltung – <strong>nur als nicht umkehrbarer Hash</strong> für ein kurzes Zeitfenster (15 Minuten bzw.
            1 Stunde) gespeichert; veraltete Zähler werden nach spätestens
            24 Stunden entfernt. Rechtsgrundlage ist unser berechtigtes Interesse an der Sicherheit der Anwendung (Art. 6
            Abs. 1 lit. f DSGVO).
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">7. E-Mails</h2>
          <p className="mt-2">
            Wir verschicken E-Mails nur für Kontofunktionen: die Einladung zu einem neuen Konto und einen auf Wunsch
            angeforderten Passwort-Reset. Gäste bekommen von diesem Dienst keine Mails. Werbung oder Newsletter gibt es nicht.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">8. Cookies</h2>
          <p className="mt-2">
            Wir setzen ausschließlich technisch notwendige Cookies ein (Art. 6 Abs. 1 lit. b/f DSGVO, § 25 Abs. 2 Nr. 2
            TDDDG) - eine Einwilligung ist dafür nicht erforderlich. Es gibt keine Tracking-, Analyse- oder
            Marketing-Cookies.
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li><code>__Host-session</code> - Anmeldung an deinem Konto (30 Tage)</li>
            <li><code>__Host-suite-state</code> - nur während einer Anmeldung über ein anderes Tool (höchstens 10 Minuten)</li>
            <li><code>invite_link</code> - nur kurz (2 Minuten), wenn ein Konto einen Einladungslink zum Weitergeben angezeigt bekommt</li>
            <li>
              <code>__Host-guest-…</code> - nur nach Eingabe eines Zugangscodes, je Veranstaltung eins: dein Zugang zum
              Ablauf, bis einen Tag nach der Veranstaltung
            </li>
          </ul>
          <p className="mt-2">
            Bei öffentlichen Abläufen bekommen Gäste keine Cookies. Den zuletzt geladenen Ablauf legt die Seite im lokalen
            Speicher deines Browsers ab (siehe Punkt 5) - ebenfalls technisch notwendig, damit die Seite ohne Verbindung
            weiter funktioniert.
          </p>
          <p className="mt-2">
            <strong>Installation als App:</strong> Der Zeitplan lässt sich auf dem Gerät als App installieren. Dafür
            registriert dein Browser einen Service Worker. Er speichert ausschließlich eine statische Seite
            (&quot;Du bist offline&quot;) zwischen - keine Abläufe, keine Konto- oder Verwaltungsseiten und keine
            personenbezogenen Daten. Ist die Verbindung weg, zeigt diese Seite den im Browser gemerkten Ablauf (Punkt 5) an. Er schickt nichts an uns und ist über die Website-Einstellungen deines Browsers
            jederzeit entfernbar.
          </p>
          <p className="mt-2">
            <strong>Push-Mitteilungen fürs Team (mit Konto, freiwillig):</strong> Schaltest du in der Team-Ansicht oder unter
            &quot;Mein Konto&quot; Mitteilungen auf einem Gerät ein, speichern wir das Push-Abo deines Browsers (eine Adresse
            beim Push-Dienst des Browser-Herstellers und zwei Schlüssel) verknüpft mit deinem Konto und deiner aktuellen
            Anmeldung. Meldest du dich ab, läuft die Anmeldung ab oder schaltest du Mitteilungen aus, wird das Abo gelöscht.
            Mitteilungen (die Vorwarnung aus Punkt 4: Titel, Zeit, Ort und interne Notiz eines Programmpunkts) werden über
            den Push-Dienst deines Browsers zugestellt (z.B. Google, Mozilla oder Apple, ggf. auch außerhalb der EU). Ihr
            Inhalt ist Ende-zu-Ende verschlüsselt - der Push-Dienst sieht nur, dass eine Nachricht an dein Gerät geht,
            nicht was darin steht. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die du jederzeit
            durch Ausschalten widerrufen kannst. Erinnerungen für Gäste (ohne Konto) siehe Punkt 5; sie gehen auf
            demselben Weg und ebenso verschlüsselt an den Push-Dienst deines Browsers.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">9. Empfänger und Auftragsverarbeiter</h2>
          <p className="mt-2">
            <strong>E-Mail-Versand:</strong> Einladungs- und Passwort-Reset-Mails versenden wir über den E-Mail-Server{' '}
            <code>{smtpHost}</code>. Mit dem Betreiber dieses Servers besteht, soweit es sich um einen externen Anbieter
            handelt, ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.
          </p>
          <p className="mt-2">
            <strong>rsvp-app:</strong> Bei Abläufen, die mit einer Veranstaltung in rsvp-app verknüpft sind, schickt
            rsvp-app uns die unter Punkt 5 genannten Kennungen und ob deine Zusage noch gilt (signiert, über eine
            verschlüsselte Verbindung). Wir schicken rsvp-app nur eine signierte Anfrage mit den Kennungen der
            Veranstaltung, wenn jemand den Rückblick öffnet, und erhalten das Protokoll von Sitzungen (siehe Punkt 5),
            sofern es dort freigegeben ist.
          </p>
          <p className="mt-2">
            <strong>Schichten:</strong> Ist ein Ablauf mit einem Event in der Anwendung „Schichten“ (Dienste für
            Helfer*innen) verknüpft, ruft diese die Programmpunkte ab – Titel, Spur und (voraussichtliche) Zeiten, ohne
            geheime Punkte, Notizen, Orte und ohne personenbezogene Daten.
          </p>
          <p className="mt-2">
            <strong>Andere Tools der Suite:</strong> Meldest du dich über ein anderes Tool an oder mit deinem Konto von hier
            bei einem anderen Tool, gehen die unter Punkt 3a genannten Angaben direkt an dieses Tool - nur an Tools, die
            der Betreiber freigegeben hat.
          </p>
          <p className="mt-2">
            <strong>Push-Dienste:</strong> Nur wenn du Mitteilungen einschaltest, geht eine verschlüsselte Nachricht an
            den Push-Dienst deines Browser-Herstellers (siehe Punkt 8). Welcher das ist, bestimmt dein Browser.
          </p>
          <p className="mt-2">
            <strong>Hosting:</strong> Diese Anwendung wird auf einem vom Verantwortlichen selbst betriebenen und
            administrierten Server gehostet. Es findet keine Weitergabe der Daten an einen externen Hosting-Anbieter
            statt.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">10. Speicherdauer</h2>
          <p className="mt-2">
            Ein Konto wird automatisch gelöscht, wenn du dich <strong>2 Jahre</strong> lang nicht mehr angemeldet
            hast und dir keine Veranstaltungen mehr gehören - inklusive Sitzungen, Verknüpfungen zu anderen Tools und
            Freigaben. Konten mit Admin-Rolle sind
            von dieser automatischen Löschung ausgenommen. Unabhängig davon kannst du jederzeit unter der oben genannten
            Adresse um frühere Löschung deines Kontos bitten.
          </p>
          <p className="mt-2">
            Sitzungen laufen nach 30 Tagen ab (mit ihnen die Push-Abos des Geräts), Einladungs- und Reset-Links nach 7 Tagen
            bzw. 1 Stunde, Gast-Zugänge einen Tag nach der Veranstaltung; sie werden dann entfernt. Drossel-Zähler siehe
            Punkt 6, verschickte Vorwarnungen und Erinnerungen nach 7 Tagen, Push-Abos für Erinnerungen an Gäste einen Tag
            nach der Veranstaltung.
          </p>
          <p className="mt-2">
            Veranstaltungen werden <strong>18 Monate nach ihrem Ende</strong> automatisch gelöscht, samt Ablauf,
            internen Notizen, Freigaben, Einstellungen zur Vorwarnung und Verlauf.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">11. Deine Rechte</h2>
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
          <h2 className="font-semibold text-lg">12. Datensicherheit</h2>
          <p className="mt-2">
            Die Übertragung erfolgt verschlüsselt (TLS/HTTPS). Anmelde-Cookies sind <code>httpOnly</code> gesetzt und
            damit per JavaScript nicht auslesbar. Passwörter, Sitzungs-Tokens und Einmal-Links werden nur als Hash
            gespeichert, Zugangscodes nur als Prüfwert mit geheimem Schlüssel (HMAC), sodass eine Kopie der Datenbank allein
            keinen Zugang zu Konten oder geschützten Abläufen ermöglicht.
          </p>
        </div>

        <div className="pt-6 border-t">
          <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline">
            &larr; Zurück zur Startseite
          </Link>
        </div>
      </div>
    </main>
  )
}
