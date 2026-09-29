# Zeitplan-Tool – Konzept

Arbeitstitel `timeline` (Repo-Name frei wählbar). Tool der App-Suite (siehe `suite-kit`) für den Ablauf großer Events
wie Hochzeiten. Wie alle Tools **eigenständig zuerst**; Anbindung an rsvp-app und Konto-Föderation sind optional.

Grundidee wie eine Abfahrtstafel: Es gibt einen **Fahrplan** (geplanter Ablauf) und eine **Prognose** (was gerade zu
erwarten ist). Meldungen der Moderator*innen verändern die Prognose, die Gäste sehen immer die Prognose.

Referenzimplementierung für alles Gemeinsame (Konten, Rollen, Freigaben, Header, PWA, Tests, Docker, rsvp-Vertrag):
**Seating**. Alles unter "Offene Entscheidungen" ist noch nicht festgelegt.

---

## 1. Begriffe

| Begriff | Bedeutung |
| --- | --- |
| **Programmpunkt** | Ein Eintrag im Ablauf: Titel, Ort, geplanter Beginn, Dauer, Beschreibung |
| **Ursprungsplan** | Stand beim Veröffentlichen bzw. Live-Schalten. Wird nie verändert, dient als Vergleich |
| **Aktueller Plan** | Ursprungsplan plus bewusste Änderungen (tauschen, zurückstellen, Ausfall, Einschub) – die "Fahrplanänderung" |
| **Prognose** | Aktueller Plan plus Verspätungen und tatsächliche Zeiten – das, was angezeigt wird |
| **Anker** | Programmpunkt mit fester Uhrzeit, der nicht mitrutscht (Standesamt, Feuerwerk, Band laut Vertrag) |
| **Puffer** | Geplante Lücke zwischen zwei Punkten. Schluckt Verspätung, bevor sie weiterwandert |

Wichtig für die Anzeige: Eine **Fahrplanänderung** (Punkt getauscht) ist keine **Verspätung**. Deshalb wird die
Verspätung gegen den aktuellen Plan gerechnet, nicht gegen den Ursprungsplan.

---

## 2. Prognose: die Regeln

Die Prognose ist eine **reine Funktion** `project(items, now, settings)` ohne Datenbankzugriff, vollständig
unit-getestet. Server und (für Vorschauen im Editor) Client nutzen denselben Code.

Pro Spur, in Reihenfolge, ohne Punkte mit Status "zurückgestellt" oder "Ausfall". Spuren werden in einer Reihenfolge
berechnet, in der jeder Punkt erst nach allen Punkten drankommt, auf die er wartet (Zyklen lehnt die Planung ab):

```text
erwarteterBeginn(i) =
    tatsächlicherBeginn(i)                                   wenn gestartet
    geplanterBeginn(i)                                       wenn Anker (plus gemeldete Verspätung, falls gemeldet)
    max( geplanterBeginn(i),                                 kein Vorziehen, außer "darf früher beginnen"
         erwartetesEnde(vorheriger in derselben Spur),       Verspätung wandert weiter
         erwartetesEnde(j) für jedes j in wartetAuf(i),      Zusammenführung von Spuren
         geplanterBeginn(i) + gemeldeteVerspätung(i) )       Meldung der Moderator*in

erwartetesEnde(i) =
    tatsächlichesEnde(i)                                     wenn beendet
    max( erwarteterBeginn(i) + Dauer(i),
         min(now, erwarteterBeginn(i) + Dauer(i) + Deckel) ) wenn läuft und überzogen (nur mit "Fortschreiben")
    erwarteterBeginn(i) + Dauer(i)                           sonst
```

Daraus folgt, ohne Sonderlogik:

* **Verspätung wandert weiter**, bis ein Puffer sie schluckt.
* **Kein Vorziehen**: Ist man früher dran, beginnt der nächste Punkt trotzdem zur geplanten Zeit – sonst verpassen Gäste
  ihn. Pro Punkt abschaltbar ("darf früher beginnen", z. B. für Spiele).
* **Zurückgestellt/Ausfall** verbrauchen keine Zeit. Ein ausgefallener Punkt schluckt so Verspätung.
* **Anker rutschen nicht.** Überschneidet sich der vorherige Punkt mit einem Anker, entsteht ein **Konflikt**, der nur
  dem Team angezeigt wird ("Kaffee überschneidet Abendessen um 10 Min – kürzen?"). Gäste sehen die Ankerzeit.
* **Fortschreiben** (Standard an, pro Event abschaltbar): Läuft ein Punkt über seine erwartete Endzeit hinaus und
  niemand hat "beendet" gedrückt, wächst die Verspätung live mit (wie ein Bus, der noch nicht an der Haltestelle ist).
  Nach dem **Deckel** (Standard 30 Min ohne Bestätigung) wächst sie nicht weiter; das Team sieht "unklar", die Gäste
  den gedeckelten Stand.
* **Zusammenführung:** Ein Punkt kann auf Punkte anderer Spuren warten (Torte wartet auf Ende Fotoshooting und Ende
  Sektempfang) und beginnt frühestens nach dem spätesten davon.

### Beispiel

| Punkt | Plan | Trauung +10 | Trauung endet 15:20 | Kaffee endet 18:40 |
| --- | --- | --- | --- | --- |
| Trauung | 14:00–14:45 | 14:10–14:55 | 14:10–15:20 | – |
| Sektempfang | 14:45–15:30 | 14:55–15:40 | 15:20–16:05 | – |
| Gruppenfoto | 15:30–16:00 | 15:40–16:10 | 16:05–16:35 | – |
| *(Puffer 30 Min)* | | | | |
| Kaffee & Kuchen | 16:30–18:00 | 16:30 (pünktlich) | 16:35–18:05 | bis 18:40 |
| Abendessen (Anker) | 18:30 | 18:30 | 18:30 | 18:30 + Konflikt fürs Team |

### Anzeige für Gäste

* Zeiten auf **5 Minuten gerundet**, mit "ca.", sobald sie von der Planung abweichen.
* **Hysterese**: Kleine Schwankungen (< 3 Min) ändern die Gästeanzeige nicht, damit die Zeiten nicht springen.
* Einstellbar, ob Gäste die Abweichung sehen ("+10") oder nur die neue Uhrzeit ("neu: ca. 15:40") – auf einer Hochzeit
  wirkt "Verspätung" schnell unfreundlich.
* **Horizont** (Standard 120 Min): Abweichungen sehen Gäste erst, wenn der Punkt so nah ist; davor die Planzeit.
* Die Hysterese braucht den zuletzt gezeigten Wert. Deshalb ist sie eine eigene reine Funktion
  `toGuestView(projection, previouslyShown, now, settings)`; der Server speichert den gezeigten Beginn pro Punkt
  (`guestShownStart`) und aktualisiert ihn, wenn sich die Anzeige ändert.
* Standardmäßig nur neue Uhrzeit mit "ca.", "+10" nur mit `showDelayToGuests`.
* Das Team sieht immer minutengenaue Werte, volle Prognose, Konflikte und "letzte Meldung vor X Min".

---

## 3. Live-Steuerung (Moderator*innen)

Ziel: **einhändig am Handy, mitten im Trubel**. Große Buttons, keine Formulare für den Normalfall.

**Die Hauptansicht** zeigt den laufenden bzw. nächsten Punkt, darunter die folgenden mit Prognose.

| Aktion | Wirkung |
| --- | --- |
| **"Weiter: ‹nächster Punkt›"** | beendet den laufenden und startet den nächsten mit der Serverzeit. Der häufigste Knopf |
| Gestartet / Beendet | einzeln, falls nötig |
| **+5 / +10 / +15 / eigene Zahl** | meldet eine Verspätung für den aktuellen bzw. nächsten Punkt |
| Im Plan | setzt die gemeldete Verspätung zurück |
| Mit nächstem tauschen / nach oben | Reihenfolge ändern (siehe unten) |
| Zurückstellen | Punkt fällt vorerst raus, landet in einer Liste und kann später "als Nächstes" wieder eingereiht werden |
| Ausfall | entfällt, Gäste sehen ihn durchgestrichen, optional mit kurzem Grund |
| Wiederherstellen | macht Zurückstellen/Ausfall rückgängig |
| Einschub | neuer Punkt nach dem laufenden (Titel, Dauer, Sichtbarkeit) – nur wenn fürs Event erlaubt |
| **Rückgängig** | letzte eigene Aktion, als Leiste einige Sekunden sichtbar, danach über den Verlauf |

**Automatik mit Nachfrage statt stiller Annahmen:**

* Ohne Meldung gilt ein Punkt als planmäßig. Ist die geplante Startzeit erreicht, zeigt die Gästeansicht ihn als
  "jetzt" (abgeleitet); das Team sieht "nicht bestätigt".
* Sollte ein Punkt seit 5 Minuten vorbei sein, fragt die Live-Ansicht: "Rede läuft noch? [+5] [Beendet]".
* **"Beendet vor …"** mit Schnellwahl 5/10/15 Min (und "Gestartet vor …") stellt einen vergessenen Knopf nachträglich
  richtig. Nie früher als der Beginn des Punkts, nie in der Zukunft.
* Die Zeit einer Aktion ist immer die **Serverzeit**, nie die Uhr des Handys.

**Tauschen:** Nur mit dem direkten Nachbarn. Beim Tausch benachbarter Punkte A, B übernimmt B den Beginn von A, A
beginnt nach B mit demselben Abstand wie vorher. Das Ende des Blocks bleibt gleich, alle folgenden Punkte sind
unberührt. Mehrfaches Tauschen ersetzt das Verschieben über weite Strecken.

**Mehrere Moderator*innen gleichzeitig:** Aktionen sind **absichtsbasiert und idempotent**. "Weiter" trägt mit, welchen
Punkt es beendet. Drücken zwei gleichzeitig, wirkt die erste, die zweite ändert nichts und lädt den aktuellen Stand –
es werden nie zwei Punkte übersprungen. Planänderungen (tauschen) prüfen die Version und lehnen veraltete Stände ab.

**Einschub:** Der neue Punkt kommt direkt nach dem laufenden. Die folgenden Punkte rutschen über die normale Kette
(Puffer schlucken, Anker bleiben, Konflikte werden angezeigt). Im Verlauf ist sichtbar, dass die Verschiebung vom
Einschub kommt.

**Verlauf:** Jede Aktion mit Konto, Zeit und Vorher/Nachher (`LiveAction`). Daraus kommt auch "Rückgängig".

---

## 4. Planung (Creator/Admin)

* Events mit Titel, Adresse (`/<slug>`, reservierte Namen wie in Seating), Datum, Zeitzone (vorerst Europe/Berlin),
  Status `DRAFT → PUBLISHED → LIVE → ENDED → ARCHIVED`.
* Programmpunkte als Liste mit Uhrzeit und Dauer (Ende wird angezeigt), Ziehen zum Umsortieren, Puffer sichtbar als
  Lücke. Pro Punkt: Titel, Ort, Beschreibung für Gäste, **interne Notiz** (nur Team: "Song: …", "Mikro 2",
  Ansprechperson), Anker ja/nein, darf früher beginnen, Sichtbarkeit.
* **Sichtbarkeit** in drei Stufen:
  * `PUBLIC` – alle.
  * `TEAM` – alle Konten mit Zugriff aufs Event, keine Gäste (Aufbau, Technik).
  * `SECRET` – Titel, Ort, Beschreibung und Notiz nur für ausdrücklich eingetragene Konten (Überraschungen). Alle
    anderen Konten sehen "Geheimer Punkt · 10 Min" mit Zeit und Dauer, damit niemand darüber plant; Live-Aktionen
    darauf dürfen nur eingetragene Konten. Gäste sehen nichts, die Zeit zählt trotzdem in der Kette.
  * Auch Besitzer*in und ADMIN sehen `SECRET` nur, wenn eingetragen. Hinweis im README: gegenüber dem Betreiber
    (Datenbankzugriff) gibt es keine echte Geheimhaltung.
  * Nicht-öffentliche Punkte erscheinen **nie** in Gästeansicht oder Tafel – auch nicht im ausgelieferten HTML/JSON.
* **Spuren:** parallele Abläufe, z. B. "Brautpaar" neben "Gäste", jede mit eigener Kette und eigener Sichtbarkeit.
  Ein Punkt kann auf Punkte anderer Spuren warten (Zusammenführung). In der Planung als Tabs "Alle / Spur 1 / Spur 2",
  in "Alle" chronologisch mit Spur-Kennzeichnung. Gäste sehen öffentliche Spuren chronologisch zusammengeführt.
  Die Live-Steuerung zeigt pro Spur den laufenden Punkt.
* **Reihen:** Mehrere Events (Polterabend, Hochzeit, Brunch) lassen sich zu einer Reihe bündeln, mit gemeinsamer
  Übersichtsseite `/<reihen-slug>`. Zugang wird pro Event geprüft.
* Event duplizieren, Export/Import als JSON (`format`, `schemaVersion`), mitgelieferte Vorlage "Hochzeit".
* Zeiten nach Mitternacht (Hochzeiten bis 3 Uhr) und die Zeitumstellung im Oktober sind ein Grund, **immer absolute
  Zeitpunkte in UTC** zu speichern, nie "HH:MM".
* Beim Live-Schalten (oder Veröffentlichen) wird der Ursprungsplan eingefroren.

---

## 5. Ansichten

| Ansicht | Für | Inhalt |
| --- | --- | --- |
| Gästeansicht `/<slug>` | Gäste | Ablauf mit Prognose, aktueller Punkt hervorgehoben, "Als Nächstes", Vergangenes eingeklappt, Ort je Punkt |
| Anzeigetafel `/<slug>/tafel` | Beamer/TV vor Ort | große Schrift, jetzt + nächste 3–4 Punkte, Uhr, lädt selbst nach, kein Scrollen |
| Live-Steuerung `/admin/events/<id>/live` | Moderator*innen | siehe Abschnitt 3 |
| Team-Ansicht | Moderator*innen, Creator | wie Gäste, plus Team-Punkte, geheime Punkte (je nach Eintrag), interne Notizen, Konflikte, minutengenau |
| Reihen-Übersicht `/<reihen-slug>` | Gäste | Liste der Events einer Reihe mit Datum und Link |
| Planung | Creator, Admin | Abschnitt 4 |

**Aktualisierung:** Polling alle ~20–30 s auf einen kleinen Endpunkt mit `ETag` (Version + Minute, weil sich die
Prognose durch "Fortschreiben" auch ohne Aktion ändert), sofort beim Zurückkehren in den Tab. Robuster als SSE hinter
Cloudflare und in Sälen mit schlechtem Empfang. SSE kann später dazukommen.

**Schlechter Empfang:** Die Gästeansicht merkt sich den letzten Stand im Browser und zeigt ihn mit "Stand: 15:32,
keine Verbindung". Das betrifft nur die Gästeansicht, nie Team-Daten.

**Einbindung:** QR-Code zur Gästeansicht zum Ausdrucken (Tischkarten, Menükarte). Optional kann Seating ihn später auf
die Tischkarten drucken.

---

## 6. Zugang

Pro Event einstellbar:

| Zugang | Bedeutung |
| --- | --- |
| `PUBLIC` | jede*r mit Link |
| `CODE` | Zugangscode (z. B. auf der Einladung), gedrosselt wie Login; danach Gast-Cookie |
| `ACCOUNT` | nur mit Konto dieses Tools (oder per Föderation angemeldet) |
| `RSVP` | nur mit Zusage im verknüpften rsvp-Termin (Abschnitt 8) |

* Nach erfolgreichem Code oder RSVP-Link bekommt der Browser eine **Gast-Sitzung** (`__Host-guest`, in der DB nur als
  Hash, gültig bis Eventende + 1 Tag). So braucht niemand jedes Mal einen neuen Link.
* Die **Anzeigetafel** hat bei geschütztem Zugang einen eigenen, per HMAC abgeleiteten Link (wie der Verwaltungslink in
  Seating), der sich neu erzeugen lässt – für den Fernseher im Saal, an dem sich niemand anmeldet.
* Gästeansicht und Tafel: `noindex`, bei geschütztem Zugang `no-store`.

---

## 7. Konten und Rollen

Gleiche Rollen wie in Seating, eigenständig vergeben, Freigabe pro Event:

| Rolle | Darf |
| --- | --- |
| ADMIN | alles |
| CREATOR | eigene Events planen, freigeben, Moderator*innen einladen |
| MODERATOR | nur freigegebene Events: Live-Steuerung, weitere Rechte je nach Event-Einstellung |

**Rechte der Moderator*innen legt Creator/Admin pro Event fest** (zwei Schalter, beide standardmäßig aus):

* **Einschübe und Löschen während des Events** – spontane Punkte einfügen, eingeschobene Punkte wieder entfernen.
* **Plan bearbeiten** – Texte, Orte, Zeiten, Dauer, Anker und Sichtbarkeit aller Punkte, auch vor dem Event.

Immer erlaubt sind die Aktionen aus Abschnitt 3 (Weiter, Verspätung, Tauschen, Zurückstellen, Ausfall, Rückgängig).
Der Server prüft die Schalter in jeder Aktion; die Oberfläche blendet nur aus.

Der Trauzeuge wird als Moderator eingeladen (Einmal-Link wie in Seating) oder meldet sich über rsvp-app an
(Föderation), und das Brautpaar bzw. die Planerin gibt ihm das Event frei.

---

## 8. Anbindung an rsvp-app

Nach dem Muster von Seating (eigener Vertrag, **eigenes Secret**, nie wiederverwenden):

* **Zugang `RSVP`:** Die Gästeansicht in rsvp-app zeigt "Zeitplan". Ein Klick erzeugt dort **frisch** einen kurz
  gültigen, signierten Link (`typ: "timeline-link"`, `aud`, `exp`, `rsvpId`, `timelineEventId`, `rsvpEventId`) und
  leitet weiter. Mails von rsvp-app verlinken auf diese Weiterleitung, nicht auf das Token selbst – so veraltet kein
  Link im Postfach.
* Das Zeitplan-Tool prüft das Token und legt eine Gast-Sitzung mit `rsvpId` an (Aufruf per GET ändert sonst nichts).
* **Absage** in rsvp-app (Webhook `rsvp-change` mit `attending: false`) beendet die Gast-Sitzungen dieser Zusage.
* **Verknüpfen** wie in Seating: beide Seiten tragen die jeweils andere ID ein, erst dann gilt die Verknüpfung.
* Keine Namen, Adressen oder Gästelisten nötig – das Tool braucht nur "diese Zusage gilt".

**In rsvp-app** nötig: Abschnitt "Zeitplan" im Termin, Button in der Gästeansicht, Weiterleitungs-Route, Webhook an
das Zeitplan-Tool. **Entschieden:** Vorher werden die Anbindungen in rsvp-app verallgemeinert (Liste verknüpfter Tools
mit Typ, Adresse, Secret; Seating wird darauf umgestellt, ohne dass sich sein Vertrag ändert). Das ist eine eigene
Aufgabe im rsvp-app-Repo (Phase 7a).

---

## 9. Datenmodell (Entwurf)

Konten, Sitzungen, Einladungen, Drosselung, Föderation und Freigaben wie in Seating.

```text
Event        id, slug (unique), title, description, date, timezone,
             status (DRAFT|PUBLISHED|LIVE|ENDED|ARCHIVED),
             access (PUBLIC|CODE|ACCOUNT|RSVP), accessCodeHmac?,
             autoCreep (bool), guestRoundingMin (5), hysteresisMin (3), showDelayToGuests (bool, Standard aus),
             guestHorizonMin (120), creepNudgeMin (5), creepCapMin (30), seriesId?,
             modsMayInsert (bool), modsMayEditPlan (bool),
             displayTokenVersion, liveVersion (int, steigt mit jeder Änderung),
             rsvpLink (JSON?), ownerId, createdAt, updatedAt

Series       id, slug (unique), title, ownerId

Track        id, eventId, name, sortOrder, visibility (PUBLIC|TEAM)

Item         id, eventId, trackId, sortOrder,
             title, location?, description?, internalNote?,
             visibility (PUBLIC|TEAM|SECRET), isAnchor, mayStartEarly,
             plannedStart, plannedDurationMin,                 -- aktueller Plan
             originalStart?, originalDurationMin?, originalSortOrder?,  -- Ursprungsplan
             status (PLANNED|RUNNING|DONE|DEFERRED|CANCELLED), insertedLive (bool),
             actualStart?, actualEnd?, reportedDelayMin?, reportedAt?, cancelReason?,
             guestShownStart?,                                  -- für die Hysterese
             version (int)

ItemDependency  itemId, waitsForItemId                         -- Zusammenführung, keine Zyklen
ItemSecretViewer itemId, userId                                -- wer SECRET-Punkte sieht

LiveAction   id, eventId, itemId?, actorId, type, before (JSON), after (JSON),
             createdAt, undoneAt?, undoneById?

GuestSession id, eventId, tokenHash, rsvpId?, createdAt, expiresAt
```

---

## 10. Betrieb

* Stack, Setup, Tests, Docker wie Seating. Host-Port 3008 (3005–3007 belegt), Dev-/Test-Ports frei wählen.
* SMTP nur für Einladungen und Passwort-Reset – Gäste bekommen keine Mails.
* Cron täglich: abgelaufene Gast-Sitzungen, Löschfristen (suite-weit: Inhalte 18 Monate nach Eventende, Konten nach
  2 Jahren ohne Anmeldung, Admins ausgenommen).
* Nach Eventende automatisch `ENDED` (Live-Steuerung gesperrt, Ansicht bleibt als Rückblick).
* PWA wie Seating (installierbar für Moderator*innen, Gästeansicht funktioniert ohne Installation). Keine
  Push-Benachrichtigungen im ersten Wurf.

---

## 11. Phasen

Sortiert für die Umsetzung mit Claude Code: erst der rechnerische Kern ohne Datenbank (autonom gut testbar), dann das
vollständige Datenmodell auf einmal, dann Oberflächen von außen (Gäste, nur lesen) nach innen (Live, schreibend),
Anbindungen zuletzt. Jede Phase ist erst fertig, wenn ihre **Definition of Done** erfüllt ist.

| Phase | Inhalt | Definition of Done |
| --- | --- | --- |
| 0 | Gerüst aus Seating: Konten, Rollen, Einladungen, Freigaben, Header, Slugs, PWA, Impressum, Docker, Unit- und E2E-Setup (eigene Test-DB, Mail-Test-Server) | Login, Einladung, Freigabe laufen; Header- und Berechtigungs-E2E aus Seating übernommen und grün; `docker compose up` startet |
| 1 | **Prognose-Kern** als reine Funktionen: `project` (Kette, Puffer, Anker, Konflikte, kein Vorziehen, Zurückgestellt/Ausfall, Fortschreiben mit Deckel, Spuren, Zusammenführung, Zyklen erkennen), `swapAdjacent`, `insertAfter`, `toGuestView` (Sichtbarkeit, Rundung, Hysterese, Horizont) | Unit-Tests für jede Regel, Beispiel aus Abschnitt 2 als Tabellentest, Mitternacht und Zeitumstellung (25.10.2026), Zusammenführung zweier Spuren, Sichtbarkeitsfilter entfernt TEAM/SECRET vollständig |
| 2 | **Datenmodell komplett** (inkl. Spuren, Abhängigkeiten, SECRET, Reihen, Live-Felder, Gast-Sitzungen) und **Planung**: Events, Punkte, Spuren-Tabs, Anker, Puffer, Sichtbarkeit, geheime Punkte mit Kontenliste, Moderator*innen-Schalter, Reihen, Duplizieren, Import/Export, Vorlage "Hochzeit" | Server-Actions prüfen Rechte (E2E mit Positivkontrolle, auch Moderator*in ohne Schalter und Konto außerhalb der SECRET-Liste); Import lehnt Zyklen und ungültige Daten ab |
| 3 | **Gästeansicht und Tafel** (Zugang `PUBLIC`), Polling-Endpunkt mit ETag, Offline-Stand, QR-Code, Reihen-Übersicht, Team-Ansicht (nur lesen) | E2E: keine TEAM/SECRET-Inhalte und keine internen Notizen in HTML oder JSON; Aktualisierung nach Änderung in der DB; Tafel ohne Scrollen auf 1920×1080 |
| 4 | **Live-Steuerung**: Weiter, Start/Ende, "vor …", Verspätung, Im Plan, Tauschen, Zurückstellen, Ausfall, Wiederherstellen, Einschub/Löschen (per Schalter), Rückgängig, Nachfrage, Verlauf, Live-Schalten friert Ursprungsplan ein, automatisch `ENDED` | E2E: zwei gleichzeitige "Weiter" überspringen nur einen Punkt; veraltete Tauschaktion abgelehnt; Rückgängig stellt exakt her; Serverzeit statt Client-Zeit; Rechte je Schalter und SECRET; Bedienung bei 390 px Breite |
| 5 | Zugang `CODE` und `ACCOUNT`, Gast-Sitzungen, Tafel-Link (HMAC, neu erzeugbar) | E2E: Polling-Endpunkt ohne Sitzung geschützt; Code-Drosselung; alter Tafel-Link nach Neuerzeugung ungültig |
| 6 | Konto-Föderation über `suite-kit` | Föderations-E2E aus Seating übernommen und grün |
| 7a | **rsvp-app** (anderes Repo): Anbindungen verallgemeinern, Seating darauf umstellen | Seating-Anbindung unverändert funktionsfähig (deren E2E grün) |
| 7b | Zugang `RSVP`: Link-Token, Gast-Sitzung, Webhook bei Absage; in rsvp-app Button, Weiterleitung, Webhook | E2E gegen Test-Doppel wie in Seating (Signatur, `aud`, `exp`, Absage beendet Sitzung) |
| 8 | Abschluss: README, Eintrag im suite-kit-README, Test auf echtem Handy und Fernseher, Lasttest (200 Gäste pollen) | README beschreibt alle Funktionen und Grenzen (SECRET vs. Betreiber) |

Später, nicht für die Hochzeit nötig: kürzbare Punkte (Mindestdauer), SSE, Push-Benachrichtigungen.

## 12. Offene Entscheidungen

Keine. Neue Fragen, die bei der Umsetzung auftauchen, hier ergänzen.

## Entschieden

* Ob Moderator*innen einschieben/löschen bzw. den Plan bearbeiten dürfen, legt Creator/Admin pro Event fest
  (Abschnitt 7).
* Zurückstellen = später nachholbar, Ausfall = entfällt endgültig (Gäste sehen ihn durchgestrichen).
* Gäste-Zugang: zuerst `CODE`, `ACCOUNT` wird mitgenommen.
* Gäste sehen standardmäßig nur die neue Uhrzeit mit "ca.", "+10" nur das Team (`showDelayToGuests` aus).
* rsvp-app: Anbindungen dort vor Phase 6 verallgemeinern (Liste verknüpfter Tools) – eigene Aufgabe im rsvp-app-Repo.
* Prognose-Horizont: Gäste sehen Abweichungen erst ab 2 Stunden vor Beginn eines Punkts, davor die Planzeit
  (pro Event einstellbar, `guestHorizonMin`, Standard 120). Das Team sieht immer die volle Prognose.
* Mehrtägige Events: mehrere Events, gebündelt über eine gemeinsame Übersichtsseite (Reihe).
* Fortschreiben standardmäßig an, Nachfrage nach 5 Min, Deckel 30 Min, "Beendet/Gestartet vor …" (Abschnitt 2 und 3).
* Sichtbarkeit in drei Stufen inkl. `SECRET` mit Kontenliste (Abschnitt 4).
* Spuren mit Zusammenführung in Kern und Datenmodell, Oberfläche als Tabs (Abschnitt 4).
* Event in Phase 0 nur mit `slug`, `title`, `description`, `date`, `timezone`, `status`, `ownerId` und Freigaben
  (`EventAccess`); alle übrigen Felder aus Abschnitt 9 kommen mit Phase 2. `date` ist der Beginn des Eventtags
  (00:00 in der Event-Zeitzone) als UTC-Zeitpunkt. (Annahme)
* Freigaben: Ein freigegebenes Konto (Moderator*in, auch ein Creator mit Freigabe) sieht das Event und steuert es
  später live; Event-Einstellungen, Löschen und Weiter-Freigeben bleiben bei Besitzer*in und Admin. Abweichung von
  Seating, wo eine Freigabe fast alles erlaubt – hier bestimmen die Schalter aus Abschnitt 7 den Rest. (Annahme)
* Keine Seite ist einbettbar, auch Gästeansicht und Tafel nicht (`frame-ancestors 'none'`). Abweichung von Seating und
  rsvp-app; bei Bedarf bekommt `/<slug>` eine eigene Header-Regel (siehe `next.config.ts`). Mit Zugang `CODE`/`RSVP`
  käme das Gast-Cookie in einem fremden iFrame ohnehin nicht an. (Annahme)
* Föderation (`ExternalIdentity`, `/api/suite/*`, Verknüpfen unter „Mein Konto“) kommt vollständig mit Phase 6;
  `suite-kit` ist schon Abhängigkeit (`sanitizeNextPath`). (Annahme)
* Löschfrist, solange es keine Programmpunkte gibt: 18 Monate nach dem Eventtag plus 2 Tage (Feiern über Mitternacht).
  Mit Programmpunkten kann das Ende des letzten Punkts zählen. (Annahme)
* Reservierte Adressen zusätzlich zu den Routen: `rsvp`, `code`, `zugang`, `tafel`, `live`, `reihe`, `reihen`,
  `series`. Events und Reihen teilen sich einen Namensraum (Phase 2 prüft beide Tabellen). (Annahme)
* Ports: Entwicklung 3800, E2E-Instanz 3801 (auf `127.0.0.1`), Test-SMTP 2527 – neben Seating (3700/3701/2526)
  gleichzeitig lauffähig. (Annahme)
