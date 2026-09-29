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
| 4 | Live-Steuerung | ✅ umgesetzt |
| 5 | Zugang per Code und Konto, Gast-Sitzungen, Tafel-Link | ✅ umgesetzt |
| 6 | Konto-Föderation über `suite-kit`: mit Konten anderer Tools anmelden, für andere Tools bestätigen | ✅ umgesetzt |
| 7 | Anbindung an rsvp-app (Zugang `RSVP`): 7a Anbindungen in rsvp-app verallgemeinern, 7b Link, Gast-Sitzung, Webhook | 7a ✅, 7b ✅ auf Zeitplan-Seite (rsvp-app: Button, Weiterleitung, Webhook offen) |
| 8 | Abschluss, Test auf echtem Handy und Fernseher, Lasttest | offen |

Bisher gibt es das Gerüst (Anmelden, Konten einladen, Events anlegen und freigeben), den rechnerischen Kern der
Prognose, die Planung (Programmpunkte, Spuren, geheime Punkte, Reihen, Import/Export, Vorlage „Hochzeit“) und die
Ansichten (Gästeansicht mit Prognose, Anzeigetafel, Reihen-Übersicht, QR-Code, Team-Ansicht) und die Live-Steuerung
fürs Handy (Weiter, Verspätung, Tauschen, Zurückstellen, Ausfall, Einschub, Rückgängig, Verlauf) sowie geschützte
Events mit Zugangscode oder Konto samt eigenem Tafel-Link und die optionale Anmeldung mit Konten anderer Tools der Suite
(Föderation) sowie der Zugang über eine Zusage in rsvp-app (Zeitplan-Seite; der Teil in rsvp-app folgt dort).

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

### Anmelden mit einem Konto aus einem anderen Tool (Föderation)

Optional und nach dem Protokoll von [`suite-kit`](https://github.com/druXter/suite-kit) (Ed25519-signierte
Login-Bestätigungen, kein gemeinsames Geheimnis). Zeitplan kann beides sein:

* **Empfänger** (`SUITE_IDPS`): Die Login-Seite zeigt „Mit … anmelden“ für jedes eingetragene Tool. Beim ersten Login
  entsteht ein Konto ohne Passwort, sofern `autoProvision` für dieses Tool an ist. **Empfohlen für Zeitplan:**
  `autoProvision: false`, weil Konten hier nur Planende und Moderator\*innen brauchen – dann meldet sich nur an, wer
  hier schon eingeladen wurde und sein Konto unter „Mein Konto“ verknüpft hat. Mit `autoProvision: true` kommt jedes
  Konto des anderen Tools herein (z. B. für Events mit Zugang „nur mit Konto“) – als Creator, der eigene Events anlegen
  darf; Freigaben für bestehende Events braucht es trotzdem. Die Rolle beim ersten Login: Admin nur mit
  `mapAdminRole`, sonst Creator; Moderator\*in bleibt Moderator\*in. Danach vergeben nur lokale Admins Rollen.
* **Anbieter** (`SUITE_SIGNING_KEY`, `SUITE_TRUSTED_APPS`): Andere Tools können Zeitplan-Konten für ihren Login nutzen.
  Bestätigt werden nur Konten mit eigenem Passwort (keine Ketten), nur für die eingetragenen Tools.

Regeln wie in der ganzen Suite: Identität ist (Tool, Konto-ID), **nie die E-Mail** – gibt es hier schon ein Konto mit
derselben Adresse, wird der Login abgelehnt, statt es zu übernehmen. Verknüpft wird bewusst unter „Mein Konto“ aus einer
bestehenden Sitzung; dort lässt sich eine Verknüpfung auch entfernen, außer sie ist die einzige Anmeldemöglichkeit.
Ändert sich die Adresse beim anderen Tool, zieht Zeitplan sie bei rein föderierten Konten beim nächsten Login nach.
Die Kontoverwaltung zeigt, über welches Tool sich ein Konto anmeldet.

Einrichten (Beispiel Zeitplan `https://zeitplan.example.de` und rsvp-app `https://rsvp.example.de`, gegenseitig):

```bash
node node_modules/suite-kit/bin/suite-keygen.js   # eigenes Schlüsselpaar, nur in die .env von Zeitplan
```

| Wo | Eintrag |
| --- | --- |
| Zeitplan | `SUITE_SIGNING_KEY=<privater Schlüssel>`, `SUITE_TRUSTED_APPS=https://rsvp.example.de`, `SUITE_IDPS=[{"issuer":"https://rsvp.example.de","label":"rsvp-app","autoProvision":false}]` |
| rsvp-app | `https://zeitplan.example.de` in `SUITE_IDPS` (und in `SUITE_TRUSTED_APPS`, wenn rsvp-app Anmeldungen für Zeitplan bestätigen soll) |

`BASE_URL` muss exakt die Adresse sein, unter der die anderen Tools Zeitplan erreichen – sie ist die Kennung (`iss`/`aud`).
Endpunkte: `/.well-known/suite-identity` (Discovery, ohne Schlüssel 404), `/api/suite/authorize` (Anbieter),
`/api/suite/login` und `/api/suite/callback` (Empfänger), `/login/continue` (Zwischenseite, damit ein Login mitten im
Anbieter-Ablauf per echtem Seitenwechsel weitergeht). Ohne `SUITE_*` gibt es weder Buttons noch Endpunkte – Zeitplan
bleibt ein einzelnes Tool.


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
* **Status:** Entwurf ↔ veröffentlicht, archivieren. „Live“ und „Beendet“ setzt die Live-Steuerung; einige Stunden nach
  dem letzten Punkt endet ein Event automatisch.
* **Ablauf und Gäste:** Rundung, Hysterese, Horizont und „+10 zeigen“ für die Gästeanzeige, Fortschreiben mit
  Nachfrage und Deckel für die Prognose (Standardwerte aus dem Konzept).
* **Freigaben:** Besitzer\*in oder Admin gibt das Event per E-Mail-Adresse einem bestehenden Konto frei. Freigegebene
  Konten sehen das Event mit internen Notizen und steuern später den Ablauf live; Einstellungen ändern, löschen und
  weiter freigeben können sie nicht. Admins sehen alle Events.
* **Zugang für Gäste** (nur Besitzer\*in oder Admin, siehe „Zugang für Gäste“ unten): öffentlich, mit Zugangscode
  oder nur mit Konto.
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

## Live-Steuerung

Unter `/admin/events/<id>/live` (für alle Konten mit Zugriff aufs Event, gedacht fürs Handy): einhändig bedienbar, große
Knöpfe, „Weiter“ ganz oben, Rückgängig als Leiste unten.

| Aktion | Wirkung |
| --- | --- |
| **Live schalten** | aus „veröffentlicht“; friert den Ursprungsplan ein (Beginn, Dauer, Reihenfolge jedes Punkts) |
| **Weiter: ‹nächster Punkt›** | beendet den laufenden und startet den nächsten Punkt der Spur (ohne laufenden Punkt: „Start: …“) |
| Beendet / Beendet vor 5–15 Min | beendet den laufenden Punkt, auch nachträglich (nie vor seinem Beginn) |
| Schon gestartet vor 5–15 Min | stellt einen vergessenen Start richtig |
| **+5 / +10 / +15 / eigene Minuten** | Verspätung des nächsten Punkts bzw. „dauert länger“ beim laufenden |
| Im Plan | nimmt die Meldung zurück |
| ↑/↓ tauschen | mit dem Nachbarn tauschen (wie in der Planung, mit Versionsprüfung) |
| Zurückstellen / Als Nächstes / Wiederherstellen | Punkt vorerst heraus, später direkt nach dem laufenden einreihen oder an alter Stelle zurück |
| Ausfall (mit Grund) | Punkt entfällt, Gäste sehen ihn durchgestrichen |
| Einschub / Einschub entfernen | neuer Punkt nach dem laufenden; nur mit Recht (Moderator\*innen: Schalter „Einschübe und Löschen“) |
| **Rückgängig** | letzte eigene Aktion (Leiste) oder jede Aktion im Verlauf – solange die Punkte seitdem unverändert sind |
| Event beenden | sperrt die Live-Steuerung; Gäste sehen den Rückblick |

* **Zeit ist immer die des Servers**, nie die des Handys; das Formular liefert höchstens „vor N Minuten“.
* **Mehrere Moderator\*innen:** Aktionen nennen den gemeinten Punkt („beende Trauung, starte Sektempfang“) und sind
  idempotent. Drücken zwei gleichzeitig „Weiter“, wirkt nur das erste; das zweite zeigt „Das ist schon passiert“ und
  den aktuellen Stand. Die Transaktion schreibt zuerst und serialisiert so gleichzeitige Aktionen (SQLite).
* **Nachfrage:** Läuft ein Punkt 5 Minuten über sein Ende, fragt die Seite „läuft noch?“ mit „+5“ und „Beendet“.
  Punkte, deren Beginn ohne Meldung erreicht ist, stehen als „noch nicht bestätigt“ da.
* **Verlauf:** jede Aktion mit Konto, Zeit und Vorher/Nachher (`LiveAction`); die Seite zeigt die letzten 30.
* **Geheime Punkte:** steuern nur eingetragene Konten; alle anderen sehen „Geheimer Punkt“ ohne Knöpfe.
* **Automatisch beendet** wird ein Event sechs Stunden nach dem Ende seines letzten Punkts (beim Öffnen der
  Live-Steuerung, bei jeder Aktion und im täglichen Cron).

Die Regeln stehen als reine Funktionen in `app/lib/schedule/live.ts` (`applyLiveCommand`, `nextInTrack`,
`currentDelayMin`, `autoEndAt`) und `app/lib/live/history.ts` (Momentaufnahmen, Vergleich für Rückgängig,
Beschreibungen); `app/lib/live/store.ts` schreibt sie in die Datenbank, die Server Action
`app/admin/events/[id]/live/actions.ts` prüft Rechte, Status und SECRET.

## Zugang für Gäste

Pro Event unter „Zugang für Gäste“ (nur Besitzer\*in oder Admin):

| Zugang | Wer sieht den Ablauf |
| --- | --- |
| **Öffentlich** (Standard) | jede\*r mit Link |
| **Mit Zugangscode** | wer einmal den Code eingibt (z. B. von der Einladung); der Browser merkt sich den Zugang |
| **Nur mit Konto** | jedes angemeldete Konto dieses Tools, auch per Föderation angemeldet (siehe oben) |
| **Nur mit Zusage in rsvp-app** | wer beim verknüpften Termin in rsvp-app zugesagt hat und den Zeitplan dort über „Zeitplan“ öffnet (siehe unten) |

* **Zugangscode:** frei wählbar oder per „Vorschlag“ (z. B. `K7QM-4XPA`), mindestens 8 Buchstaben oder Ziffern.
  Groß-/Kleinschreibung, Leerzeichen und Bindestriche sind für Gäste egal. Gespeichert wird nur ein HMAC (an das
  Event gebunden) – die Seite zeigt den Code nach dem Speichern **einmal** an, danach nie wieder. Ein leeres Feld
  behält den bisherigen Code.
* **Gast-Sitzung:** Nach dem richtigen Code setzt der Server ein Cookie `__Host-guest-<eventId>` (eins pro Event, damit
  der Zugang zum Polterabend neben dem zur Hochzeit bestehen bleibt). In der Datenbank liegt nur der Hash des Tokens.
  Gültig bis einen Tag nach dem Ende des Events. **Ändern sich Zugang oder Code, enden alle Gast-Sitzungen** – z. B.
  wenn ein Code in falsche Hände geraten ist. Die Verwaltung zeigt, wie viele Gast-Zugänge gerade aktiv sind.
* **Drosselung:** 20 Fehlversuche pro IP und 100 pro Event in 15 Minuten; ein richtiger Code zählt nicht mit (im Saal
  teilen sich viele Gäste eine IP). Der Versuch wird vor dem Vergleich reserviert, wie beim Login.
* **Tafel-Link:** Bei geschütztem Zugang bekommt die Tafel einen eigenen Link mit Schlüssel
  (`/<adresse>/tafel?k=…`, per HMAC abgeleitet, nicht gespeichert) – für den Fernseher im Saal, an dem sich niemand
  anmeldet. Er gilt nur für Tafel und Polling-Endpunkt, nicht für die Gästeansicht und nie für Entwürfe. Alle Konten
  mit Zugriff sehen ihn in der Verwaltung; „Neuen Tafel-Link erzeugen“ (nur Besitzer\*in oder Admin) macht den alten
  sofort ungültig, auch auf einer offenen Tafel.
* **Eingebettet** (iFrame auf der Hochzeits-Website) kommen Cookies als Drittanbieter-Cookies meist nicht an. Ein
  geschütztes Event zeigt dort deshalb nur „Ablauf in neuem Tab öffnen“ statt Code-Eingabe oder Anmeldung.
* **Ohne Secrets** (`ACCESS_CODE_SECRET`, `DISPLAY_LINK_SECRET`, je mindestens 32 Zeichen) gibt es keinen Zugangscode
  bzw. keinen Tafel-Link – bewusst ohne Rückfall auf einen Standardwert; die Verwaltung weist darauf hin.

### Anbindung an rsvp-app (Zugang „nur mit Zusage“)

Eigener Vertrag nach dem Muster von Seating (`app/lib/rsvp/token.ts`), mit **eigenem Secret**
(`RSVP_TIMELINE_SECRET` hier = `TIMELINE_SECRET` in rsvp-app, mindestens 32 Zeichen, nie aus einer anderen Anbindung
übernehmen). Nachrichten: `base64url(JSON).base64url(HMAC-SHA256)` mit `typ`, `aud` (Adresse von Zeitplan), `iat`/`exp`
(höchstens eine Stunde), `timelineEventId`, `rsvpEventId` und `rsvpId` – **keine Namen, keine Adressen**.

* **Verknüpfen:** In Zeitplan unter „Zugang für Gäste“ „Nur mit Zusage in rsvp-app“ wählen und die id des Termins in
  rsvp-app eintragen; dort beim Termin den angezeigten Zeitplan-Link (`<Zeitplan>/rsvp/<Event-id>`) eintragen. Die
  Verknüpfung gilt erst, wenn beide Seiten die andere eingetragen haben (gespeichert in `Event.rsvpLink`).
* **Einstieg:** „Zeitplan“ bei der Zusage in rsvp-app erzeugt bei jedem Klick **frisch** einen kurz gültigen Link
  (`typ: "timeline-link"`) und leitet zu `/rsvp/<Event-id>?t=…` weiter. Zeitplan prüft Signatur, Art, Empfänger,
  Frist und Verknüpfung und legt erst dann eine Gast-Sitzung mit `rsvpId` an (Cookie wie beim Zugangscode, nur als
  Hash). Ungültige Links landen auf `/rsvp?ungueltig=1` – ob es das Event gibt, verrät das nicht. Mails von rsvp-app
  verlinken auf die Weiterleitung, nie auf das Token selbst.
* **Absage:** Der Webhook `POST /api/rsvp-webhook` (`typ: "rsvp-change"`) mit `attending: false` beendet die
  Gast-Sitzungen dieser Zusage – nur solche, die vor der Meldung entstanden sind, damit eine verspätete alte Absage
  keinen neuen Zugang beendet. Eine Zusage legt nichts an. Ungültige Nachrichten: `401`, nicht verknüpft: `200` ohne
  Wirkung.
* Ändern sich Zugang oder verknüpfter Termin, enden alle Gast-Sitzungen des Events.
* In rsvp-app nötig (Phase 7b dort): Tool-Typ `timeline` (Adresse `TIMELINE_BASE_URL`, Secret `TIMELINE_SECRET`,
  Link-Form `<Zeitplan>/rsvp/<id>`, Webhook `/api/rsvp-webhook`), Feld „Zeitplan-Link“ im Termin, Button
  „Zeitplan“ in der Gästeansicht mit Weiterleitung und der Webhook `rsvp-change`.

Regeln und Tokens stehen in `app/lib/guest/access.ts` (Sichtbarkeit, rein) und `app/lib/guest/tokens.ts` (Code und
Tafel-Link), Sitzungen in `app/lib/guest/session.ts`, die Code-Eingabe in `app/[slug]/actions.ts`.

## Ansichten

| Ansicht | Adresse | Für |
| --- | --- | --- |
| Gästeansicht | `/<adresse>` | Gäste – je nach Zugang mit Link, Code oder Konto |
| Anzeigetafel | `/<adresse>/tafel` (geschützt: `?k=…`) | Beamer oder Fernseher vor Ort |
| Reihen-Übersicht | `/<reihen-adresse>` | Gäste |
| Team-Ansicht | `/admin/events/<id>/team` | alle Konten mit Zugriff aufs Event |
| QR-Code | `/admin/events/<id>/qr` | zum Ausdrucken (Tischkarten, Menükarte) |

* **Sichtbar** sind Gästeansicht und Tafel für veröffentlichte, laufende und beendete Events (Rückblick). Entwürfe und
  archivierte Events ergeben 404 – Konten mit Zugriff sehen stattdessen eine Vorschau mit Hinweis. Geschützte Events
  zeigen ohne gültigen Zugang nur den Titel („nur mit Zugang sichtbar“) und den Weg hinein (siehe „Zugang für
  Gäste“).
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
  werden gekürzt, nichts scrollt. Gedacht für einen Browser im Vollbild-/Kiosk-Modus. Bei geschütztem Zugang mit
  eigenem Tafel-Link.
* **Team-Ansicht** (nur lesen): chronologisch wie für Gäste, aber minutengenau mit geplanter und erwarteter Zeit,
  „letzte Meldung vor X Min“, Ursprungsplan bei verlegten Punkten,
  Abweichung, Team- und geheimen Punkten (Inhalt nur für eingetragene Konten), internen Notizen, Konflikten mit Ankern,
  „nicht bestätigt“, „überzogen“, „unklar“ und „läuft noch?“, zurückgestellten Punkten und der Zeit, die Gäste gerade
  sehen. Lädt sich alle 30 Sekunden neu.
* **QR-Code:** zur Gästeansicht, als SVG zum Drucken oder Herunterladen.
* **Einbetten:** Die Gästeansicht (und die Reihen-Übersicht) lässt sich per iFrame in eine andere Website einbinden,
  z. B. `<iframe src="https://zeitplan.deine-domain.de/<adresse>" width="100%" height="800"></iframe>`. Impressum und
  Datenschutz öffnen dann in einem neuen Tab. Tafel und Verwaltung sind nicht einbettbar. Nur bestimmte Websites
  zulassen: in `next.config.ts` `frame-ancestors *` durch deren Origins ersetzen und neu bauen.

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
* **Header** (`next.config.ts`): `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS für alle Seiten. **Nur die
  Gästeansicht bzw. Reihen-Übersicht `/<adresse>` ist einbettbar** (`frame-ancestors *`, wie in Seating); alle anderen
  Seiten – auch Tafel, Polling-Endpunkt, Impressum und Datenschutz – nicht (`frame-ancestors 'none'`,
  `X-Frame-Options: DENY`). Gästeansicht und Tafel sind per `<meta name="robots">` nicht indexiert, der Polling-Endpunkt per
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
* **Geschützte Events:** kein Inhalt ohne gültige Gast-Sitzung, Konto oder Tafel-Link – auch nicht über den
  Polling-Endpunkt (`403`). Zugangscode nur als HMAC, Gast-Sitzung nur als Hash, Tafel-Link per HMAC abgeleitet,
  Code-Eingabe gedrosselt (siehe „Zugang für Gäste“). Die Tafel sendet keinen Referer (`Referrer-Policy:
  no-referrer`), damit der Schlüssel in ihrer Adresse nicht weitergegeben wird.
* **Föderation** (`app/api/suite/*`): Bestätigungen gelten 60 s, nur zusammen mit dem einmaligen `state`-Cookie
  desselben Browsers (`__Host-suite-state`, 10 Minuten, wird bei jedem Rücksprung gelöscht); Signatur, Anbieter, Empfänger
  und `nonce` werden geprüft, der genaue Ablehnungsgrund steht nur im Server-Log. Unbekannte Schlüssel-ID: Discovery
  höchstens einmal pro Minute neu laden (Schlüsselrotation). Antworten mit `no-store` und `no-referrer`.
* **Grenze:** Geheime Programmpunkte (`SECRET`) sehen in der Oberfläche nur eingetragene Konten – auch nicht
  Besitzer\*in oder Admin. Gegenüber dem Betreiber mit Zugriff auf die Datenbank gibt es aber **keine echte
  Geheimhaltung**.

## Automatische Löschung

Ein externer Scheduler (z. B. Uptime Kuma) ruft **einmal täglich** auf:

`GET https://zeitplan.deine-domain.de/api/cron/cleanup?secret=<CRON_SECRET>`

Ein leeres oder fehlendes `CRON_SECRET` lässt niemanden durch. Gelöscht werden (suite-weit gleiche Fristen): Events
18 Monate nach ihrem Ende (samt Ablauf und Freigaben; als Ende gilt vorerst der Eventtag plus Spielraum für Feiern über
Mitternacht), Konten nach 2 Jahren ohne Anmeldung (Admin-Konten und Konten, denen noch Events gehören, ausgenommen),
abgelaufene Sitzungen und Gast-Sitzungen, Einladungs-/Reset-Links und Drossel-Zähler.

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
                    # Gästeansicht (tests/unit/guest: Sichtbarkeit, Payload), Abschnitte Jetzt/Als Nächstes/Vorbei,
                    # Live-Steuerung (tests/unit/schedule/live.test.ts, tests/unit/live: Verlauf und Rückgängig),
                    # Zugang (tests/unit/guest: Sichtbarkeit mit Sitzung/Konto/Tafel-Link, Zugangscode, Tafel-Link),
                    # Föderation (tests/unit/suite.test.ts: Rollen, Zwischenseite, state-Cookie, Konfiguration),
                    # Vertrag mit rsvp-app (tests/unit/rsvp: Signatur, Art, Empfänger, Frist, Verknüpfung)
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
Übernommen aus Seating und geprüft werden u. a.: Sicherheits-Header je Pfadgruppe (Gästeansicht einbettbar, Tafel,
Polling-Endpunkt und Dateien der App nicht), Session-Cookie und Hash in der Datenbank, Session-Fixation, Open Redirect, gleiche Meldung und
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
Stand; Tafel ohne Scrollen bei 1920×1080 und 1280×720; Reihen-Übersicht; QR-Code; Team-Ansicht mit Konflikten;
Einbetten (eine fremde Website auf eigenem Port bindet die Gästeansicht per iFrame ein, Tafel und Anmeldung blockiert
der Browser).
Für die Live-Steuerung (`tests/e2e/live.spec.ts`): Live schalten friert den Ursprungsplan ein (auch nach einem Tausch
unverändert); Start und Weiter mit Serverzeit bei falscher Handy-Uhr und gefälschtem Zeitfeld; drei gleichzeitige
„Weiter“ überspringen nur einen Punkt; veraltete Tauschaktion abgelehnt, aktuelle wirkt; Rückgängig stellt jede
Aktion exakt her (Verspätung, Dauert länger, Tauschen, Zurückstellen, Ausfall, Weiter, Beendet vor, Einschub,
Entfernen samt Abhängigkeiten) und nie über eine spätere Änderung hinweg; Moderator\*in ohne Schalter und ohne
SECRET-Eintrag – nachgespielte Einschübe, Weiter, Verspätung, Ausfall, Zurückstellen und Tauschen wirkungslos, mit
Schalter bzw. als Eingetragene wirksam; Bedienung bei 390 px (nichts ragt heraus, Knöpfe mindestens 44 px,
Rückgängig unten erreichbar, Nachfrage bei Überziehen); automatisches Beenden per Cron und beim Öffnen, danach
gesperrt. Für den Zugang (`tests/e2e/access.spec.ts`): ohne Sitzung kein Inhalt in HTML, RSC-Daten, Tafel oder Endpunkt
(`403`), mit richtigem Code (abgetippt in Kleinbuchstaben) Gast-Sitzung als `__Host-guest-<id>` (HttpOnly, Secure,
Lax) und nur als Hash in der Datenbank, Code nirgends im Klartext; Sitzung gilt nicht für ein anderes Event, ein
erfundenes Cookie hilft nicht, abgelaufene Sitzung und Wechsel des Zugangs beenden den Zugang; neuer Code in der
Verwaltung beendet alte Sitzungen, der alte Code gilt nicht mehr, Moderator\*in ändert den Zugang auch per
nachgespieltem POST nicht (Positivkontrolle als Besitzer\*in); Drosselung beim 21. Fehlversuch pro IP (auch mit
richtigem Code, andere IP weiter möglich, Erfolg zählt nicht) und nach 100 Fehlversuchen pro Event von verschiedenen
IPs (anderes Event unberührt); Zugang per Konto samt Rückkehr nach der Anmeldung; Tafel-Link ohne Anmeldung, falscher
und fremder Schlüssel wirkungslos, Gästeansicht nicht per Schlüssel, offene Tafel aktualisiert sich, alter Link nach
Neuerzeugung ungültig (auch auf der offenen Tafel), Neuerzeugen nicht für Moderator\*innen, Entwurf trotz Schlüssel
404; eingebettet nur der Link auf einen neuen Tab; Cron löscht abgelaufene Gast-Sitzungen. Konto-Föderation
(`tests/e2e/suite.spec.ts`, übernommen aus Seating, gegen zwei Test-Doppel anderer Tools in `tests/e2e/suite-server.ts`
auf den Ports 2530/2531): erster Login legt ein Konto an (Admin dort wird hier Creator, Moderator\*in bleibt), erneuter
Login in anderem Browser mit nachgezogener Adresse, ohne `autoProvision` kein Konto, vorhandene Adresse → abgelehnt
statt zusammengeführt, Verknüpfen aus „Mein Konto“ und Login darüber, dieselbe Identität für ein zweites Konto
abgelehnt, Entfernen (nicht die letzte Anmeldemöglichkeit; Positivkontrolle mit Passwort; fremde Verknüpfung per
gefälschtem Formular), Wiedergabe der Bestätigung im selben und in einem fremden Browser, manipulierte
Signatur/Empfänger/`nonce`/Anbieter, unbekannter Schlüssel, nicht konfigurierter Anbieter, Fehlermeldung je nach
Sitzung auf Konto- oder Login-Seite; als Anbieter: Discovery, nicht freigegebenes Tool, Login mit Fortsetzung über die
Zwischenseite und gültiger Bestätigung, keine Ketten, Zwischenseite nur zum eigenen Endpunkt. Dazu Zeitplan-eigen: Zugang
„nur mit Konto“ – Anmelden auf der Gästeansicht über Tool A führt zurück zum Ablauf, ohne Vorschau und ohne Verwaltung.
Anbindung an rsvp-app (`tests/e2e/rsvp.spec.ts` gegen das Test-Doppel `tests/e2e/rsvp-server.ts`, das wie rsvp-app beim
Klick frisch signiert und weiterleitet): Einstieg ergibt Gast-Sitzung mit `rsvpId` nur als Hash (erneuter Klick ersetzt
sie), Header von Einstieg und Fehlerseite; anderes Secret, anderer Empfänger, abgelaufen, zu lange gültig, nicht
verknüpfter Termin, anderes Event in der Adresse, manipulierte Zusage und Webhook-Token als Link – jeweils keine Sitzung
(Positivkontrolle mit gültigem Link); Entwurf und Zugang per Code ohne Sitzung; Webhook: ungültige Signatur, anderer
Empfänger, abgelaufen → `401`, fremder Termin und Zusage ohne Wirkung, verspätete alte Absage beendet keinen neueren
Zugang, zu großer Body `413`, echte Absage beendet genau diese Zusage (die andere bleibt), danach neuer Zugang per
frischem Link; Verwaltung: Termin-id und Zeitplan-Link, ungültige id abgelehnt, neuer Termin beendet alte Sitzungen und
alte Links, Moderator\*in ändert nichts. Installierbare App: Manifest,
Icons, `sw.js`-Header, Worker speichert nur die Offline-Seite.

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
| `ACCESS_CODE_SECRET` | Schlüssel für Zugangscodes (HMAC), mindestens 32 Zeichen; leer = kein Zugang per Code |
| `DISPLAY_LINK_SECRET`, `DISPLAY_LINK_SECRET_PREVIOUS` | Schlüssel für Tafel-Links geschützter Events; der vorherige hält alte Links beim Wechsel gültig |
| `RSVP_TIMELINE_SECRET` | optional: eigenes Secret der Anbindung an rsvp-app (dort `TIMELINE_SECRET`), mindestens 32 Zeichen; leer = kein Zugang „nur mit Zusage“ |
| `SUITE_IDPS`, `SUITE_SIGNING_KEY`, `SUITE_SIGNING_KEY_PREVIOUS`, `SUITE_TRUSTED_APPS`, `SUITE_APP_NAME` | optional: Konto-Föderation (siehe „Anmelden mit einem Konto aus einem anderen Tool“) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Mailversand für Einladungen und Passwort-Reset (optional) |
| `IMPRESSUM_*` | Angaben für Impressum und Datenschutzerklärung |

## Ports

| Zweck | Port |
| --- | --- |
| Entwicklung (`npm run dev`) | 3800 (`localhost`) |
| E2E-Testinstanz | 3801 (`127.0.0.1`) |
| Test-SMTP der E2E-Tests | 2527 |
| Test-Doppel anderer Tools der Suite (E2E) | 2530, 2531 (`localhost`) |
| Test-Doppel von rsvp-app (E2E) | 2532 (`localhost`) |
| Docker (Host) | 3008 |
