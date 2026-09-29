# Zeitplan-Tool – Hinweise für Claude Code

@AGENTS.md

Ablauf großer Events (Hochzeit) mit Live-Prognose wie eine Abfahrtstafel: Moderator*innen melden Verspätungen,
Tausch, Ausfall; Gäste sehen immer den zu erwartenden Ablauf. Tool der App-Suite, eigenständig lauffähig.

**Fachliche Grundlage: [docs/KONZEPT.md](docs/KONZEPT.md).** Vor jeder Phase den passenden Abschnitt lesen. Abweichungen
vorschlagen und das Konzept mit aktualisieren, nicht still umsetzen.

## Referenz: Seating

Seating ist die vollständigste Umsetzung der Suite-Muster. **Vor neuem Code dort nachsehen und übernehmen:**

* Stack: Next.js App Router, Prisma + SQLite (nur `prisma db push`, keine Migrationen), vitest, Playwright, Docker
  (Nutzer `node`, `./data` gemountet, `git` für `suite-kit`)
* Konten, Rollen ADMIN/CREATOR/MODERATOR, Einladungen, Freigaben pro Event, `create-user.js`
* `next.config.ts` (Header-Reihenfolge ist kommentiert), `app/lib/slugs.ts` samt Test auf fehlende Routen
* Drosselung, Tokens/HMAC (`app/lib/booking-tokens.ts`), rsvp-Vertrag (`app/lib/rsvp/token.ts`), Webhook
* PWA (Manifest, minimaler Service Worker, nichts Persönliches cachen), Impressum/Datenschutz
* E2E-Setup mit eigener Test-DB, Test-Doppel für rsvp-app und Suite

Repos lokal neben diesem (`../seating`, `../rsvp-app`, `../suite-kit`, `../abstimmungstool`), sonst
`github.com/druXter/<repo>`. **Andere Repos nur lesen**; nötige Änderungen (v. a. in rsvp-app) als Liste vorschlagen.

## Befehle

<!-- Nach Phase 0 ausfüllen, Ports festlegen (Host-Port Docker: 3008) -->
```bash
npm run dev                  # Port 3800
npm test                     # Unit-Tests (vitest, tests/unit)
npm run test:e2e             # Playwright gegen eigene Instanz auf 127.0.0.1:3801 (baut vorher, test.db)
npm run build
npm run lint
npx prisma db push           # Schema synchronisieren, keine Migrationen
node create-user.js <email> ADMIN [--invite]
```

AGENTS.md wird von `next dev` gepflegt (Hinweise zur Next.js-Version) und oben per `@AGENTS.md` eingebunden – nicht
löschen, sonst schreibt `next dev` seinen Block direkt in diese Datei.

## Konventionen

* TypeScript strict; Bezeichner englisch, **UI-Texte deutsch**, gendergerecht mit Sternchen, Anrede "du".
* Zeitpunkte immer als UTC-`DateTime`, Anzeige in der Event-Zeitzone. Nie "HH:MM" speichern (Mitternacht, Zeitumstellung).
* **Der Prognose-Kern besteht aus reinen Funktionen** unter `app/lib/schedule/` (`project`, `swapAdjacent`,
  `insertAfter`, `toGuestView`): keine DB, kein `Date.now()`, `now` ist immer Parameter. Server Actions laden Daten,
  rufen den Kern auf und speichern das Ergebnis – Regeln stehen nie in Actions oder Komponenten.
* `toGuestView` ist die **einzige** Stelle, an der Daten für Gäste entstehen. Gästeansicht, Tafel und Polling-Endpunkt
  nutzen nur deren Ergebnis.

## Sicherheitsregeln (nicht verhandelbar)

Alle Regeln aus dem suite-kit-README und wie in Seating umgesetzt. Zusätzlich:

* **TEAM- und SECRET-Punkte sowie interne Notizen erscheinen nie** in Gästeansicht, Tafel, deren JSON oder HTML.
  E2E-Test dafür wie "keine Namen im HTML" in Seating.
* **SECRET gilt auch für Konten:** Inhalte nur für eingetragene Konten, auch nicht für Besitzer*in oder ADMIN; andere
  sehen nur Zeit und Dauer. Das gilt für Team-Ansicht, Live-Steuerung, Verlauf, Export und Fehlermeldungen.
* Live-Aktionen: Berechtigung + Freigabe in **jeder** Server Action, Zeit ist **Serverzeit**, Aktionen idempotent und
  absichtsbasiert ("beende Punkt X", nicht "beende den aktuellen"), Planänderungen mit Versionsprüfung.
* Zugangscode nur als HMAC gespeichert, Eingabe gedrosselt; Gast-Sitzung nur als Hash; Tafel-Link per HMAC abgeleitet.
* Geschützte Events: kein Inhalt ohne gültige Gast-Sitzung, Konto oder Tafel-Link – auch nicht über den
  Polling-Endpunkt.

## Arbeitsweise

* **Phasen in der Reihenfolge aus Konzept Abschnitt 11.** Eine Phase ist fertig, wenn ihre Definition of Done erfüllt
  ist und `npm test`, `npm run test:e2e` und `npm run build` grün sind – nicht vorher als fertig melden.
* Innerhalb einer Phase selbstständig arbeiten. Bei Lücken im Konzept eine begründete Annahme treffen, im Konzept unter
  "Entschieden" mit "(Annahme)" eintragen und am Ende der Phase auflisten. **Nur anhalten und fragen**, wenn eine
  Entscheidung Sicherheit, Datenschutz oder das Datenmodell früherer Phasen betrifft.
* Tests zuerst für den Prognose-Kern (Phase 1): Testfälle aus dem Konzept schreiben, dann implementieren.
* Jede Phase endet mit aktualisiertem README, bei Abweichungen angepasstem Konzept, einer kurzen Zusammenfassung
  (was, Annahmen, offene Punkte) und **Hinweis an mich, zu committen und zu pushen**.
* Phase 7a findet im rsvp-app-Repo statt – dort eigene Sitzung, dieses Repo nicht anfassen.
* Live-Steuerung am echten Handy prüfen (einhändig, große Ziele, Rückgängig erreichbar).
