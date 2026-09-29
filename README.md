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
| 1 | Prognose-Kern als reine Funktionen (`project`, `swapAdjacent`, `insertAfter`, `toGuestView`) | ✅ umgesetzt |
| 2 | Datenmodell komplett und Planung (Punkte, Spuren, Anker, Sichtbarkeit, Reihen, Import/Export, Vorlage) | ✅ umgesetzt |
| 3 | Gästeansicht, Tafel, Polling-Endpunkt, QR-Code, Reihen-Übersicht, Team-Ansicht | ✅ umgesetzt |
| 4 | Live-Steuerung | offen |
| 5 | Zugang per Code und Konto, Gast-Sitzungen, Tafel-Link | offen |
| 6 | Konto-Föderation über `suite-kit` | offen |
| 7 | Anbindung an rsvp-app (Zugang `RSVP`) | offen |
| 8 | Abschluss, Test auf echtem Handy und Fernseher, Lasttest | offen |

Bisher gibt es das Gerüst (Anmelden, Konten einladen, Events anlegen und freigeben), den rechnerischen Kern der
Prognose, die Planung (Programmpunkte, Spuren, geheime Punkte, Reihen, Import/Export, Vorlage „Hochzeit“) und die
Ansichten (Gästeansicht mit Prognose, Anzeigetafel, Reihen-Übersicht, QR-Code, Team-Ansicht). Die Live-Steuerung folgt
mit Phase 4 – bis dahin ändert sich die Prognose nur durch die Planung und die Uhr.

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

* **Anlegen:** Titel, Adresse (Vorschlag aus dem Titel), Datum, Beschreibung – leer (mit einer Spur „Ablauf“) oder mit
  der **Vorlage „Hochzeit“** (`app/lib/planning/template.ts`: Trauung, Empfang, Abendessen als Anker, Party bis nach
  Mitternacht, Spur „Brautpaar“ mit Zusammenführung, Team-Spur, ein geheimer Punkt). Neue Events sind ein Entwurf.
* **Adresse** (`/<adresse>`, dort liegt die Gästeansicht): Kleinbuchstaben, Ziffern, Bindestriche;
  reservierte Namen (alle Pfade des Tools, `app/lib/slugs.ts`) und vergebene Adressen werden abgelehnt – Events und
  Reihen teilen sich dabei einen Namensraum.
* **Datum:** der Tag, an dem der Ablauf beginnt – gespeichert als Beginn dieses Tages in der Zeitzone des Events
  (vorerst immer Europe/Berlin) als UTC-Zeitpunkt. Uhrzeiten stehen nur an den Programmpunkten, ebenfalls als absolute
  Zeitpunkte – nie als „HH:MM“ (Mitternacht, Zeitumstellung). Ein neues Datum verschiebt alle Punkte um dieselbe Zahl
  von Kalendertagen, die Uhrzeiten bleiben (nicht, solange das Event live ist).
* **Status:** Entwurf ↔ veröffentlicht, archivieren. „Live“ und „Beendet“ setzt die Live-Steuerung (Phase 4).
* **Ablauf und Gäste:** Rundung, Hysterese, Horizont und „+10 zeigen“ für die Gästeanzeige, Fortschreiben mit
  Nachfrage und Deckel für die Prognose (Standardwerte aus dem Konzept).
* **Freigaben:** Besitzer\*in oder Admin gibt das Event per E-Mail-Adresse einem bestehenden Konto frei. Freigegebene
  Konten sehen das Event mit internen Notizen und steuern später den Ablauf live; Einstellungen ändern, löschen und
  weiter freigeben können sie nicht. Admins sehen alle Events.
* **Rechte der Moderator\*innen** – zwei Schalter pro Event, beide standardmäßig aus:
  * *Plan bearbeiten:* Punkte ändern, verschieben, anlegen und löschen (vor und nach dem Event). Spuren, Einstellungen,
    Schalter und Freigaben bleiben bei Besitzer\*in und Admin.
  * *Einschübe und Löschen während des Events:* Punkte anlegen und löschen, solange das Event live ist.
* **Duplizieren:** Kopie auf einen neuen Tag mit gleichen Uhrzeiten – Spuren, Punkte, Abhängigkeiten und Einstellungen,
  aber ohne Live-Stand, Freigaben und Schalter.
* **Export/Import:** Der Ablauf als JSON (`format: "zeitplan-event"`, `schemaVersion: 1`, Zeiten als ISO 8601 mit
  Versatz). Ein Import legt immer ein **neues** Event an; die Datei wird vollständig geprüft (Grenzen, Verweise,
  „wartet auf“ ohne Schleifen) und landet auf dem gewählten Tag.
* **Löschen:** nur Besitzer\*in oder Admin, samt Ablauf und Freigaben.

## Planung

Unter `/admin/events/<id>/plan` (für alle Konten mit Zugriff; bearbeiten nur mit Recht):

* **Spuren** als Tabs „Alle / Spur 1 / Spur 2“ – parallele Abläufe mit eigener Kette, öffentlich oder nur fürs Team.
  „Alle“ zeigt alles chronologisch mit Spur-Kennzeichnung. Spuren anlegen, umbenennen, umsortieren und (leer) löschen
  darf nur Besitzer\*in oder Admin.
* **Programmpunkte:** Titel, Ort, Beschreibung für Gäste, **interne Notiz** (nur Team), Beginn, Dauer (das Ende wird
  angezeigt), Spur, Anker, „darf früher beginnen“, Sichtbarkeit und „wartet auf“ (Zusammenführung, auch über Spuren).
  Neue und zeitlich geänderte Punkte werden nach ihrem Beginn einsortiert.
* **Puffer und Überschneidungen** stehen als eigene Zeile zwischen zwei Punkten einer Spur; Konflikte mit Ankern und
  Schleifen bei „wartet auf“ meldet die Seite oben (berechnet mit dem Prognose-Kern).
* **Umsortieren** per „nach oben“/„nach unten“: tauscht mit dem Nachbarn wie im Live-Betrieb (`swapAdjacent`) – der
  nach oben geholte Punkt übernimmt den Beginn, der andere folgt mit demselben Abstand. Anker verschiebt man über ihre
  Uhrzeit.
* **Sichtbarkeit:** öffentlich, nur Team, oder **geheim** mit Kontenliste (nur Konten mit Zugriff aufs Event). Geheime
  Punkte sehen und ändern nur eingetragene Konten – auch nicht Besitzer\*in oder Admin; alle anderen sehen „Geheimer
  Punkt“ mit Zeit und Dauer. Das gilt auch für Export und Duplizieren (dort als Platzhalter), Fehlermeldungen und die
  Auswahl bei „wartet auf“.
* **Gleichzeitige Änderungen:** Jeder Punkt hat eine Version; wer einen veralteten Stand speichert, bekommt einen
  Hinweis statt die Änderung eines anderen zu überschreiben. Tauschen ist absichtsbasiert (beide Punkte werden genannt).
  Jede Änderung erhöht `liveVersion` des Events.

Die Planungsregeln stehen als reine Funktionen unter `app/lib/planning/` (Formular, SECRET-Filter `redactItem`,
Reihenfolge, Export/Import, Vorlage), Rechte in `app/lib/permissions.ts`.

## Reihen

Unter `/admin/series` bündeln Creator und Admins mehrere Events (Polterabend, Hochzeit, Brunch) zu einer Reihe mit
eigener Adresse; unter `/<reihen-adresse>` sehen Gäste Titel, Datum und Link der veröffentlichten, laufenden und
beendeten Events (Entwürfe und Archiv fehlen). Zuordnen lassen sich nur eigene Reihen
(Admins: alle), in den Einstellungen des Events. Löschen einer Reihe lässt ihre Events stehen.

## Ansichten

| Ansicht | Adresse | Für |
| --- | --- | --- |
| Gästeansicht | `/<adresse>` | Gäste – jede\*r mit Link (Zugang `PUBLIC`) |
| Anzeigetafel | `/<adresse>/tafel` | Beamer oder Fernseher vor Ort |
| Reihen-Übersicht | `/<reihen-adresse>` | Gäste |
| Team-Ansicht | `/admin/events/<id>/team` | alle Konten mit Zugriff aufs Event |
| QR-Code | `/admin/events/<id>/qr` | zum Ausdrucken (Tischkarten, Menükarte) |

* **Sichtbar** sind Gästeansicht und Tafel für veröffentlichte, laufende und beendete Events (Rückblick). Entwürfe und
  archivierte Events ergeben 404 – Konten mit Zugriff sehen stattdessen eine Vorschau mit Hinweis. Events mit Zugang
  per Code, Konto oder rsvp-app zeigen Gästen bis Phase 5 nur den Titel („nur mit Zugang sichtbar“).
* **Gästeansicht:** „Jetzt“ hervorgehoben, „Als Nächstes“, danach der Rest, Vergangenes eingeklappt; Ort und
  Beschreibung je Punkt, ausgefallene Punkte durchgestrichen mit Grund. Weicht die Prognose ab, steht dort die neue
  Uhrzeit („neu: ca. 15:40“, auf 5 Minuten gerundet, mit Horizont und Hysterese); „+10“ nur, wenn in den Einstellungen
  eingeschaltet. Gäste sehen nur öffentliche Punkte öffentlicher Spuren – nie Team- oder geheime Punkte, Team-Spuren,
  zurückgestellte Punkte oder interne Notizen, auch nicht im ausgelieferten HTML oder JSON.
* **Aktualisierung:** Gästeansicht und Tafel fragen alle 20–30 Sekunden (und sofort beim Zurückkehren in den Tab)
  `GET /api/view/<adresse>` ab – derselbe Inhalt wie im ersten HTML, als JSON. Der `ETag` ist ein Hash des Inhalts;
  unverändert antwortet der Endpunkt `304`. `Cache-Control: no-store`, `X-Robots-Tag: noindex`. Entwurf/Archiv: `404`,
  geschützt: `403`, jeweils ohne Inhalt.
* **Schlechter Empfang:** Die Gästeansicht merkt sich den letzten Stand im Browser (`localStorage`, höchstens
  5 Events, nie bei einer Vorschau) und zeigt ihn mit „Stand: 15:32, keine Verbindung“. Auch wenn die Seite ohne
  Verbindung neu geladen wird, zeigt die Offline-Seite des Service Workers diesen Stand.
* **Tafel:** Vollbild in dunklem Design für 16:9 – Uhr, laufende Punkte groß, darunter die nächsten 3–4; lange Titel
  werden gekürzt, nichts scrollt. Gedacht für einen Browser im Vollbild-/Kiosk-Modus. Bei geschütztem Zugang kommt der
  eigene Tafel-Link mit Phase 5.
* **Team-Ansicht** (nur lesen): chronologisch wie für Gäste, aber minutengenau mit geplanter und erwarteter Zeit,
  Abweichung, Team- und geheimen Punkten (Inhalt nur für eingetragene Konten), internen Notizen, Konflikten mit Ankern,
  „nicht bestätigt“, „überzogen“, „unklar“ und „läuft noch?“, zurückgestellten Punkten und der Zeit, die Gäste gerade
  sehen. Lädt sich alle 30 Sekunden neu.
* **QR-Code:** zur Gästeansicht, als SVG zum Drucken oder Herunterladen.

Die Daten für Gäste entstehen ausschließlich in `toGuestView` (Prognose-Kern); `app/lib/guest/store.ts` lädt dafür den
Ablauf (ohne interne Notizen), speichert den gezeigten Beginn je Punkt für die Hysterese und baut daraus den
`GuestPayload` (`app/lib/guest/payload.ts`, jedes Feld einzeln freigegeben). Wer was sieht, regelt
`app/lib/guest/access.ts`.

## Prognose-Kern

Die Regeln aus [docs/KONZEPT.md](docs/KONZEPT.md) Abschnitt 2 und 3 stecken in **reinen Funktionen** unter
`app/lib/schedule/` – ohne Datenbank, ohne Uhr (`now` ist immer Parameter), mit eigenen Typen statt Prisma. Server und
Browser (Vorschau im Editor) rechnen damit dasselbe. Server Actions laden Daten, rufen den Kern auf und speichern das
Ergebnis; Regeln stehen nie in Actions oder Komponenten.

| Funktion | Zweck |
| --- | --- |
| `project(items, now, settings)` | Prognose je Punkt: erwarteter Beginn und Ende, Abweichung, Phase (kommt/jetzt/vorbei, gemeldet oder abgeleitet), überzogen, gedeckelt, Nachfrage; dazu Konflikte mit Ankern. Zyklen und unbekannte Abhängigkeiten werden gemeldet statt gerechnet. |
| `swapAdjacent(items, a, b)` | Tauscht zwei benachbarte Punkte im aktuellen Plan: B übernimmt den Beginn von A, A folgt mit demselben Abstand, das Ende des Blocks bleibt. Absichtsbasiert – sind die beiden nicht mehr Nachbarn, wird abgelehnt. |
| `insertAfter(items, afterId, neu, now, settings)` | Einschub direkt nach einem Punkt; die folgenden rutschen über die normale Kette. |
| `toGuestView(projection, previouslyShown, now, settings)` | Die **einzige** Stelle, an der Daten für Gäste entstehen: nur öffentliche Punkte öffentlicher Spuren, ohne interne Notizen, Zeiten mit Horizont, Rundung, „ca.“ und Hysterese; liefert zusätzlich den gezeigten Beginn je Punkt zum Speichern. |
| `checkDependencies(items)` | Zyklen (auch über die Reihenfolge der Spuren) und unbekannte „wartet auf“ – für Planung und Import. |

Kurz die Regeln: Verspätung wandert weiter, bis ein Puffer sie schluckt; kein Vorziehen (außer „darf früher
beginnen“); zurückgestellte und ausgefallene Punkte verbrauchen keine Zeit; Anker rutschen nicht, Überschneidungen sind
Konflikte fürs Team; ein überzogener laufender Punkt schiebt die Prognose live weiter („Fortschreiben“), bis zum Deckel;
ein Punkt kann auf Punkte anderer Spuren warten. Alle Zeiten sind absolute Zeitpunkte, Dauern echte Minuten – auch über
Mitternacht und die Zeitumstellung.

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
  schlechtem Empfang merkt sich die Gästeansicht selbst (`localStorage`, nur Gästedaten), nicht der Worker; die
  Offline-Seite liest ihn, wenn eine Gästeansicht ohne Verbindung neu geladen wird.
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
* **Berechtigungen** prüft jede Server Action selbst (`loadEventForUser` → `eventLevel`, dazu `canEditPlan`,
  `canAddRemoveItems`, `canManageEvent` und `canEditItem` in `app/lib/permissions.ts`), nie nur die Oberfläche. Server
  Actions prüfen zusätzlich den Origin (CSRF, Next.js-Standard).
* **Header** (`next.config.ts`): `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS für alle Seiten. **Keine
  Seite ist einbettbar** (`frame-ancestors 'none'`, `X-Frame-Options: DENY`) – anders als in Seating auch nicht die
  Gästeansicht. Gästeansicht und Tafel sind per `<meta name="robots">` nicht indexiert, der Polling-Endpunkt per
  `X-Robots-Tag` und `no-store`. Login, Konto und Verwaltung zusätzlich `X-Robots-Tag: noindex` und `Cache-Control: no-store`;
  Reset-Links `Referrer-Policy: no-referrer`. Die Reihenfolge der Regeln ist wichtig (die spätere gewinnt, ein Header
  lässt sich nur überschreiben, nicht entfernen) und in der Datei kommentiert.
* **Reservierte Adressen:** Events und Reihen liegen unter `/<slug>` und teilen sich den Namensraum. Alle Pfade des
  Tools stehen in `app/lib/slugs.ts`; ein Test schlägt fehl, sobald eine neue Route oder eine Datei unter `public/`
  dort fehlt.
* **Geheime Punkte:** Alle Punkte für Konten laufen durch `redactItem` (`app/lib/planning/items.ts`, aufgerufen von
  `loadPlan`) – eine Stelle für Planung, Team-Ansicht, Export und Duplizieren.
* **Gäste** bekommen nur, was `toGuestView` freigibt (siehe „Ansichten“); interne Notizen liest die Gästeanfrage gar
  nicht erst aus der Datenbank.
* **Grenze:** Geheime Programmpunkte (`SECRET`) sehen in der Oberfläche nur eingetragene Konten – auch nicht
  Besitzer\*in oder Admin. Gegenüber dem Betreiber mit Zugriff auf die Datenbank gibt es aber **keine echte
  Geheimhaltung**.

## Automatische Löschung

Ein externer Scheduler (z. B. Uptime Kuma) ruft **einmal täglich** auf:

`GET https://zeitplan.deine-domain.de/api/cron/cleanup?secret=<CRON_SECRET>`

Ein leeres oder fehlendes `CRON_SECRET` lässt niemanden durch. Gelöscht werden (suite-weit gleiche Fristen): Events
18 Monate nach ihrem Ende (samt Ablauf und Freigaben; als Ende gilt vorerst der Eventtag plus Spielraum für Feiern über
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
                    # fehlende Routen), Cron-Secret, Zeitzonen (Zeitumstellung, Eventtag, Verschieben), Rechte,
                    # Event-Formular und -Einstellungen, Reihen, Prognose-Kern (tests/unit/schedule), Planung
                    # (tests/unit/planning: Punkt-Formular, SECRET-Filter, Reihenfolge, Export/Import, Vorlage),
                    # Gästeansicht (tests/unit/guest: Sichtbarkeit, Payload), Abschnitte Jetzt/Als Nächstes/Vorbei
npm run test:e2e    # Playwright gegen eine frisch gebaute Instanz auf http://127.0.0.1:3801
npm run build
npm run lint
```

Der Prognose-Kern hat für jede Regel eigene Unit-Tests, das Beispiel aus dem Konzept als Tabellentest, Mitternacht
und die Zeitumstellung am 25.10.2026, Zusammenführung zweier Spuren, Zyklen (auch solche, die erst mit der Reihenfolge
der Spuren entstehen), Tauschen und Einschub. Für `toGuestView` prüft ein Test, dass TEAM- und SECRET-Punkte, Team-Spuren
und interne Notizen **nirgends** im serialisierten Ergebnis stehen – weder Titel, Ort, Beschreibung, Notiz noch id –
und dass die Ausgabe nur freigegebene Felder hat.

Für die Planung prüfen Unit-Tests u. a., dass `redactItem` von einem geheimen Punkt ohne Eintrag nichts außer Zeit,
Dauer und Kette übrig lässt, dass Export und Import sich gegenseitig verstehen, der Import Schleifen (auch über die
Reihenfolge der Spuren), unbekannte Verweise, doppelte Schlüssel, fremde Felder und Zeiten fern vom Eventtag ablehnt,
und dass die Vorlage „Hochzeit“ in der Nacht der Zeitumstellung ihre Uhrzeiten behält.

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
Kontolöschen, Löschfristen. Für die Planung (`tests/e2e/planning.spec.ts`): Vorlage, Anlegen und Einsortieren, Puffer,
Tauschen, veraltete Stände, Schleifen; Moderator\*in ohne Schalter (nachgespielte Aktionen wirkungslos, mit Schalter
wirksam, Spuren nie, live nur mit „Einschübe“); geheimer Punkt – Besitzer\*in ohne Eintrag findet ihn weder im HTML
noch im Export und kann ihn nicht ändern, tauschen oder löschen, die eingetragene Moderator\*in schon; Einstellungen,
Schalter und Status nur für Besitzer\*in; Import (Schleife, kaputtes JSON, ungültige Werte, fremdes Format, gültig);
Duplizieren; neues Datum verschiebt die Punkte; Reihen und gemeinsamer Namensraum. Für die Ansichten
(`tests/e2e/guest.spec.ts`): keine TEAM-/SECRET-Inhalte, Team-Spuren, zurückgestellten Punkte, internen Notizen oder
ids davon im HTML, in den RSC-Daten oder im JSON von Gästeansicht, Tafel und Endpunkt (auch nicht, wenn ein Konto mit
Zugriff sie aufruft) – mit Positivkontrolle in der Team-Ansicht; Entwurf/Archiv 404 und Vorschau; geschützter Zugang
ohne Inhalt, auch per Endpunkt; Prognose mit „ca.“ und gespeichertem gezeigtem Beginn; ETag/304 und neuer Inhalt nach
Änderung in der Datenbank; Aktualisierung der offenen Seite, Hinweis ohne Verbindung und Offline-Seite mit gemerktem
Stand; Tafel ohne Scrollen bei 1920×1080 und 1280×720; Reihen-Übersicht; QR-Code; Team-Ansicht mit Konflikten.
Installierbare App: Manifest, Icons, `sw.js`-Header, Worker speichert nur die Offline-Seite.

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
| `BASE_URL` | öffentliche Adresse ohne Slash – für Links in Mails, Gästelink, QR-Code und später die Kennung in der Suite |
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
