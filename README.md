# Zeitplan

Ablauf großer Events (z. B. einer Hochzeit) mit Live-Prognose wie auf einer Abfahrtstafel: Moderator\*innen melden
Verspätungen, Tausch und Ausfall, Gäste sehen immer den zu erwartenden Ablauf. Tool der
[App-Suite](https://github.com/druXter/suite-kit) und wie alle Tools **eigenständig zuerst** – eigene Datenbank, eigene
Konten, eigenes Deployment. Die Anbindung an rsvp-app und die Konto-Föderation über `suite-kit` sind optionale Zusätze.

Fachliche Grundlage und Fahrplan: [docs/KONZEPT.md](docs/KONZEPT.md). Referenz für alles Gemeinsame ist
[Seating](https://github.com/druXter/seating).

## Stand

| Phase | Inhalt | Stand |
| --- | --- | --- |
| 0 | Gerüst: Konten, Rollen, Einladungen, Events mit Freigaben, Sicherheits-Header, Slugs, PWA, Impressum/Datenschutz, Docker, Unit- und E2E-Setup | ✅ umgesetzt |
| 1 | Prognose-Kern als reine Funktionen (`project`, `swapAdjacent`, `insertAfter`, `toGuestView`) | offen |
| 2 | Datenmodell komplett und Planung (Punkte, Spuren, Anker, Sichtbarkeit, Reihen, Import/Export, Vorlage) | offen |
| 3 | Gästeansicht, Tafel, Polling-Endpunkt, QR-Code, Reihen-Übersicht, Team-Ansicht | offen |
| 4 | Live-Steuerung | offen |
| 5 | Zugang per Code und Konto, Gast-Sitzungen, Tafel-Link | offen |
| 6 | Konto-Föderation über `suite-kit` | offen |
| 7 | Anbindung an rsvp-app (Zugang `RSVP`) | offen |
| 8 | Abschluss, Test auf echtem Handy und Fernseher, Lasttest | offen |

Bisher gibt es nur das Gerüst: Anmelden, Konten einladen, Events anlegen und freigeben. Programmpunkte, die
Gästeansicht und die Live-Steuerung folgen mit den nächsten Phasen.

## Konten

Konten gibt es nur für Planung und Moderation. Gäste brauchen nie ein Konto.

### Rollen

Gleiche Rollen wie in Seating und den anderen Tools der Suite, aber eigenständig vergeben:

| Rolle | Darf |
| --- | --- |
| **ADMIN** | alles: alle Events, Konten anlegen/löschen, Rollen vergeben |
| **CREATOR** | eigene Events anlegen, planen und freigeben, Moderator\*innen einladen |
| **MODERATOR** | legt nichts selbst an, arbeitet nur in freigegebenen Events (z. B. der Trauzeuge) |

### Erstes Konto und weitere Konten

Es gibt keine öffentliche Registrierung. Das allererste Konto entsteht auf dem Server:

```bash
node create-user.js deine-email@domain.de ADMIN                              # lokal, Passwort wird verdeckt abgefragt
node create-user.js deine-email@domain.de ADMIN --invite                     # stattdessen Einmal-Link (7 Tage)
docker compose run --rm zeitplan node create-user.js deine-email@domain.de ADMIN --invite
```

Weitere Konten lädt man unter `/admin/users` ein: Die Person bekommt einen Einmal-Link (7 Tage gültig) und legt ihr
Passwort **selbst** fest. Ohne `SMTP_HOST` zeigt die Seite den Link dem einladenden Konto einmalig zum Weitergeben an. Nur
Admins vergeben die Rollen CREATOR/ADMIN; Creator laden ausschließlich Moderator\*innen ein. Admin-Konten lassen sich in
der Oberfläche bewusst weder ändern noch löschen (Schutz vor Aussperren) und haben keinen Passwort-Reset per Mail – das
geht nur per `create-user.js`. Wird ein Konto gelöscht, gehen seine Events an den löschenden Admin über.

Die Anmeldung mit Konten anderer Tools der Suite (Föderation) kommt mit Phase 6.

## Events

Unter `/admin/events` legen Creator und Admins Events an, Moderator\*innen sehen dort die ihnen freigegebenen.

* **Anlegen:** Titel, Adresse (Vorschlag aus dem Titel), Datum, Beschreibung. Neue Events sind ein Entwurf.
* **Adresse** (`/<adresse>`, dort erscheint ab Phase 3 die Gästeansicht): Kleinbuchstaben, Ziffern, Bindestriche;
  reservierte Namen (alle Pfade des Tools, `app/lib/slugs.ts`) und vergebene Adressen werden abgelehnt.
* **Datum:** der Tag, an dem der Ablauf beginnt – gespeichert als Beginn dieses Tages in der Zeitzone des Events
  (vorerst immer Europe/Berlin) als UTC-Zeitpunkt. Uhrzeiten stehen später nur an den Programmpunkten, ebenfalls als
  absolute Zeitpunkte – nie als „HH:MM“ (Mitternacht, Zeitumstellung).
* **Freigaben:** Besitzer\*in oder Admin gibt das Event per E-Mail-Adresse einem bestehenden Konto frei. Freigegebene
  Konten sehen das Event und steuern später den Ablauf live; Einstellungen ändern, löschen und weiter freigeben können
  sie nicht. Ob sie auch den Plan bearbeiten oder Punkte einschieben dürfen, legen ab Phase 2/4 zwei Schalter pro Event
  fest. Admins sehen alle Events.
* **Löschen:** nur Besitzer\*in oder Admin, samt Freigaben.

## Als App installieren (PWA)

Wie Seating ist Zeitplan eine Progressive Web App: Im Browser (Chrome/Edge/Android: „Installieren“ bzw. „Als App
installieren“ auf der Start- und der Verwaltungsseite; iPhone/iPad: Safari → Teilen → „Zum Home-Bildschirm“) lässt es
sich mit eigenem Symbol und ohne Browserleiste starten. Gedacht für Planung und Moderation – die App startet im
Admin-Bereich. Gäste brauchen das nicht, die Gästeansicht funktioniert im Browser.

* **Manifest** (`app/manifest.ts`): Name, Farben, Icons (auch maskierbar für Android), Shortcuts zu „Events“ und
  „Neues Event“.
* **Logo:** Uhr mit hervorgehobenem Abschnitt („der laufende Programmpunkt“) – im Stil der anderen Tools (Symbol auf
  blauem Kreis). Quelle `app/icon.svg`; daraus gerendert `app/favicon.ico` (16/32/48), `app/apple-icon.png` (180,
  vollflächig) und `public/icons/` (192, 512, maskierbar 512 mit Inhalt in der sicheren Zone).
* **Service Worker** (`public/sw.js`) ist bewusst minimal: Er macht die App installierbar und zeigt ohne Verbindung eine
  Offline-Seite (`public/offline.html`). **Es wird nichts Persönliches zwischengespeichert** – Navigationen gehen immer
  ans Netz, Server Actions, `/api/*` und fremde Herkunft fasst er nicht an; im Cache liegt nur die statische
  Offline-Seite. Ändert sich `offline.html`, `VERSION` in `sw.js` erhöhen. Den letzten Stand der Gästeansicht bei
  schlechtem Empfang (Phase 3) merkt sich die Gästeansicht selbst, nicht der Worker.
* `sw.js` wird nie zwischengespeichert (Header in `next.config.ts`). Registriert wird der Worker nur in der Produktion
  (`app/ui/pwa-register.tsx`).
* Bewusst **keine Push-Benachrichtigungen**.

## Sicherheit

Übernommen aus Seating (Referenzimplementierung der Suite, siehe README von `suite-kit`):

* **Passwörter:** scrypt (`node:crypto`, N=2^15, r=8, p=3) mit eingebetteten Parametern; alte Hashes werden beim
  nächsten Login automatisch erneuert. Mindestens 10 Zeichen, keine Zeichenklassen-Regeln, Abgleich gegen naheliegende
  Fälle – serverseitig geprüft, nicht nur per `minLength` im Browser.
* **Passwort-Raten:** Drosselung pro IP (20 Versuche) **und** pro Ziel-E-Mail (10 Versuche) in 15 Minuten
  (`app/lib/throttle.ts`). Der Versuch wird **vor** der Prüfung atomar reserviert, sodass auch viele gleichzeitige
  Anfragen das Limit nicht umgehen. Keine dauerhafte Kontosperre. Gleiche Meldung und gleiche Rechenzeit für bekannte
  und unbekannte Adressen. „Passwort vergessen“ antwortet immer neutral und schickt höchstens 3 Mails pro Adresse und
  Stunde. Gespeichert werden nur SHA-256-Hashes von IP und E-Mail.
* **`TRUST_PROXY_HOPS`** muss zur Proxy-Kette passen – messen, nicht raten (Anleitung in `.env.example`).
* **Sitzungen:** zufälliger Token im Cookie `__Host-session` (HttpOnly, Secure, SameSite=Lax, ohne Domain-Attribut),
  in der Datenbank nur als SHA-256-Hash. Neue Sitzung bei jedem Login, ein Passwortwechsel beendet alle anderen
  Sitzungen. Einladungs-/Reset-Links: einmalig, befristet, nur als Hash; das bloße Öffnen (GET) verbraucht sie nicht.
* **Berechtigungen** prüft jede Server Action selbst (`loadEventForUser` → `eventLevel` in `app/lib/permissions.ts`),
  nie nur die Oberfläche. Server Actions prüfen zusätzlich den Origin (CSRF, Next.js-Standard).
* **Header** (`next.config.ts`): `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS für alle Seiten. **Keine
  Seite ist einbettbar** (`frame-ancestors 'none'`, `X-Frame-Options: DENY`) – anders als in Seating auch nicht die
  künftige Gästeansicht. Login, Konto und Verwaltung zusätzlich `X-Robots-Tag: noindex` und `Cache-Control: no-store`;
  Reset-Links `Referrer-Policy: no-referrer`. Die Reihenfolge der Regeln ist wichtig (die spätere gewinnt, ein Header
  lässt sich nur überschreiben, nicht entfernen) und in der Datei kommentiert.
* **Reservierte Adressen:** Events (und später Reihen) liegen unter `/<slug>`. Alle Pfade des Tools stehen in
  `app/lib/slugs.ts`; ein Test schlägt fehl, sobald eine neue Route oder eine Datei unter `public/` dort fehlt.
* **Grenze:** Geheime Programmpunkte (`SECRET`, ab Phase 2) sehen in der Oberfläche nur eingetragene Konten – auch nicht
  Besitzer\*in oder Admin. Gegenüber dem Betreiber mit Zugriff auf die Datenbank gibt es aber **keine echte
  Geheimhaltung**.

## Automatische Löschung

Ein externer Scheduler (z. B. Uptime Kuma) ruft **einmal täglich** auf:

`GET https://zeitplan.deine-domain.de/api/cron/cleanup?secret=<CRON_SECRET>`

Ein leeres oder fehlendes `CRON_SECRET` lässt niemanden durch. Gelöscht werden (suite-weit gleiche Fristen): Events
18 Monate nach ihrem Ende (samt Freigaben; als Ende gilt vorerst der Eventtag plus Spielraum für Feiern über
Mitternacht), Konten nach 2 Jahren ohne Anmeldung (Admin-Konten und Konten, denen noch Events gehören, ausgenommen),
abgelaufene Sitzungen, Einladungs-/Reset-Links und Drossel-Zähler.

## Setup

```bash
npm install
cp .env.example .env    # Werte eintragen, siehe Kommentare in der Datei (lokal TRUST_PROXY_HOPS=0)
npx prisma db push      # legt prisma/dev.db an, erzeugt den Prisma-Client
node create-user.js deine-email@domain.de ADMIN
npm run dev             # http://localhost:3800
```

Es gibt keinen `migrations`-Ordner – wie in den anderen Tools der Suite ausschließlich per `npx prisma db push`.

## Tests

```bash
npm test            # Unit-Tests (vitest): Passwort, Drossel-IP und -Regeln, Formular-Helfer, Slugs (inkl. Test auf
                    # fehlende Routen), Cron-Secret, Zeitzonen (Zeitumstellung, Eventtag), Event-Rechte, Event-Formular
npm run test:e2e    # Playwright gegen eine frisch gebaute Instanz auf http://127.0.0.1:3801
npm run build
npm run lint
```

Die E2E-Tests löschen und erzeugen bei jedem Lauf ihre eigene Datenbank `prisma/test.db` (nie die Entwicklungs- oder
Produktivdaten), bauen mit `next build` und starten `next start` – sie prüfen also das, was auch in Produktion läuft.
Übernommen aus Seating und geprüft werden u. a.: Sicherheits-Header je Pfadgruppe (auch für die künftigen Pfade der
Gästeansicht und Tafel), Session-Cookie und Hash in der Datenbank, Session-Fixation, Open Redirect, gleiche Meldung und
Antwortzeit bei unbekannten Adressen, Sperre beim 11. Versuch pro E-Mail und 21. pro IP, erfundene
`X-Forwarded-For`-Einträge, 30 gleichzeitige Versuche, Passwortwechsel, Einladung per Link und per Mail (einmalig, GET
verbraucht nichts), gefälschte Formular-POSTs ohne Berechtigung und mit fremdem Origin – jeweils **mit
Positivkontrolle**, dass derselbe POST als berechtigtes Konto wirkt. Für Events: Anlegen (Eventtag in UTC), Adresse
(reserviert, ungültig, vergeben), Einstellungen, Freigabe (Moderator\*in ohne und mit Freigabe, keine Einstellungen,
kein Löschen und Weiterfreigeben, Entziehen), fremde Konten, Moderator\*innen legen nichts an, Umhängen beim
Kontolöschen, Löschfristen. Installierbare App: Manifest, Icons, `sw.js`-Header, Worker speichert nur die
Offline-Seite.

Mails fängt ein Test-SMTP ab (`tests/e2e/mail-server.ts`, Port 2527, Pakete `smtp-server` und `mailparser`, nur für die
Tests), der sie als `.eml` in `data/test-mails` ablegt; Empfänger unter `@nomail.test` lehnt er ab (gescheiterter
Versand). Zur Sichtprüfung eignet sich Mailpit (`docker run --rm -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025
axllent/mailpit`, dann `SMTP_HOST=127.0.0.1 SMTP_PORT=1025`).

Voraussetzung: Chromium für Playwright (`npx playwright install chromium`, einmalig).

## Deployment

Docker Compose, gleiches Prinzip wie bei den anderen Tools:

```bash
mkdir -p data && sudo chown 1000:1000 data   # einmalig, siehe unten
docker compose up -d --build
docker compose run --rm zeitplan node create-user.js deine-email@domain.de ADMIN --invite
```

* Der Container läuft **nicht als root**, sondern als Nutzer `node` (UID 1000). Das gemountete Verzeichnis `./data`
  (SQLite-Datenbank) muss ihm gehören – legt Docker es selbst an, gehört es root und der Start scheitert.
* Installiert wird mit `npm ci` exakt nach `package-lock.json`. Das gemeinsame Paket `suite-kit` kommt direkt von
  GitHub, das Dockerfile installiert dafür `git`.
* Beim Start synchronisiert `prisma db push` das Schema, dann startet `next start` auf Port 3000 im Container.
  Voreingestellt ist Host-Port 3008 (3005–3007 sind von rsvp-app, Abstimmungstool und Seating belegt).
* **Vor jedem Update die Daten sichern** (`data/prod.db` kopieren).

## Umgebungsvariablen

Siehe `.env.example` (mit Erklärungen). Kurzüberblick:

| Variable | Zweck |
| --- | --- |
| `DATABASE_URL` | SQLite-Datei (in Docker per Compose gesetzt) |
| `BASE_URL` | öffentliche Adresse ohne Slash – für Links in Mails, später Gästelink, QR-Code und Kennung in der Suite |
| `TRUST_PROXY_HOPS` | Anzahl eigener Reverse Proxys (für die IP der Drosselung) |
| `CRON_SECRET` | Schutz des Aufräum-Endpunkts |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Mailversand für Einladungen und Passwort-Reset (optional) |
| `IMPRESSUM_*` | Angaben für Impressum und Datenschutzerklärung |

## Ports

| Zweck | Port |
| --- | --- |
| Entwicklung (`npm run dev`) | 3800 (`localhost`) |
| E2E-Testinstanz | 3801 (`127.0.0.1`) |
| Test-SMTP der E2E-Tests | 2527 |
| Docker (Host) | 3008 |
