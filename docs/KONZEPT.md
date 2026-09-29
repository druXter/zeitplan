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
* Programmpunkte als Liste mit Uhrzeit und Dauer (Ende wird angezeigt), Umsortieren per „nach oben/unten“ (Tausch mit
  dem Nachbarn wie live, siehe "Entschieden"), Puffer sichtbar als Lücke. Pro Punkt: Titel, Ort, Beschreibung für Gäste, **interne Notiz** (nur Team: "Song: …", "Mikro 2",
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

**Aktualisierung:** Polling alle ~20–30 s auf einen kleinen Endpunkt mit `ETag` (aus dem ausgelieferten Inhalt, weil
sich die Prognose durch "Fortschreiben" auch ohne Aktion ändert – siehe "Entschieden"), sofort beim Zurückkehren in den
Tab. Robuster als SSE hinter Cloudflare und in Sälen mit schlechtem Empfang. SSE kann später dazukommen.

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

* Nach erfolgreichem Code oder RSVP-Link bekommt der Browser eine **Gast-Sitzung** (`__Host-guest-<eventId>`, ein
  Cookie pro Event, in der DB nur als Hash, gültig bis Eventende + 1 Tag). So braucht niemand jedes Mal einen neuen
  Link.
* Die **Anzeigetafel** hat bei geschütztem Zugang einen eigenen, per HMAC abgeleiteten Link (wie der Verwaltungslink in
  Seating), der sich neu erzeugen lässt – für den Fernseher im Saal, an dem sich niemand anmeldet.
* Gästeansicht und Tafel: `noindex`, bei geschütztem Zugang `no-store`. Die Gästeansicht ist per iFrame einbettbar
  (siehe "Entschieden"), die Tafel nicht.

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
* **Einbetten** wie in Seating und rsvp-app: Gästeansicht und Reihen-Übersicht (`/<slug>`) sind per iFrame einbettbar
  (`frame-ancestors *`, kein `X-Frame-Options`), z. B. in die Hochzeits-Website. Alles andere nicht – auch nicht Tafel,
  Polling-Endpunkt, Verwaltung, Anmeldung, Impressum und Datenschutz. Die Gästeansicht löst keine Aktionen aus, Clickjacking
  hat dort kein Ziel. Im iFrame öffnen Impressum und Datenschutz in einem neuen Tab, der Service Worker wird dort nicht
  angemeldet. Nur bestimmte Websites zulassen: `*` in `next.config.ts` durch deren Origins ersetzen und neu bauen.
  Mit Zugang `CODE`/`ACCOUNT`/`RSVP` braucht der Zugang ein Cookie, das in einem fremden iFrame als
  Drittanbieter-Cookie meist nicht ankommt – eingebettet zeigt die Seite deshalb statt Code-Eingabe bzw. Anmeldung nur
  „Ablauf in neuem Tab öffnen“ (Phase 5).
* Föderation (`ExternalIdentity`, `/api/suite/*`, Verknüpfen unter „Mein Konto“) kommt vollständig mit Phase 6;
  `suite-kit` ist schon Abhängigkeit (`sanitizeNextPath`). (Annahme)
* Löschfrist, solange es keine Programmpunkte gibt: 18 Monate nach dem Eventtag plus 2 Tage (Feiern über Mitternacht).
  Mit Programmpunkten kann das Ende des letzten Punkts zählen. (Annahme)
* Reservierte Adressen zusätzlich zu den Routen: `rsvp`, `code`, `zugang`, `tafel`, `live`, `reihe`, `reihen`,
  `series`. Events und Reihen teilen sich einen Namensraum (Phase 2 prüft beide Tabellen). (Annahme)
* Ports: Entwicklung 3800, E2E-Instanz 3801 (auf `127.0.0.1`), Test-SMTP 2527 – neben Seating (3700/3701/2526)
  gleichzeitig lauffähig. (Annahme)
* Prognose-Kern (Phase 1) liegt unter `app/lib/schedule/` und ist unabhängig von Prisma (eigene Typen, die Server
  Actions übersetzen). Gestartet/beendet liest er an `actualStart`/`actualEnd` ab, nicht am Status. (Annahme)
* "Darf früher beginnen" streicht nur die Untergrenze "geplanter Beginn": Der Punkt rückt ans Ende seiner Vorgänger,
  auch in einen geplanten Puffer hinein. Der erste Punkt einer Spur bleibt bei seiner Planzeit, eine gemeldete
  Verspätung gilt weiter. (Annahme)
* Meldung an einem laufenden Punkt: Sein Ende ist mindestens geplanter Beginn + gemeldete Verspätung + Dauer. So
  verlängert "+5" einen laufenden Punkt, ohne eine vor dem Start gemeldete Verspätung doppelt zu zählen; die
  Live-Steuerung (Phase 4) setzt die Meldung dafür auf bisherige Abweichung + 5. Der Deckel fürs Fortschreiben zählt
  ab diesem Ende. (Annahme)
* Konflikte entstehen zwischen einem Anker und seinem Vorgänger in der Spur sowie den Punkten, auf die er wartet – nur
  solange der Anker nicht begonnen hat. (Annahme)
* Die Nachfrage "läuft noch?" gilt für gemeldet laufende Punkte. Punkte, deren Beginn ohne Meldung erreicht ist,
  kennzeichnet der Kern als "nicht bestätigt". (Annahme)
* Zyklen und unbekannte ids in "wartet auf" prüft der Kern über alle Punkte, auch zurückgestellte und ausgefallene
  (ein zurückgestellter Punkt kann wieder eingereiht werden). (Annahme)
* Tauschen: nur geplante Punkte ohne Anker, benachbart unter den aktiven Punkten derselben Spur (ausgefallene und
  zurückgestellte liegen nicht "dazwischen"). Gemeldete Verspätungen bleiben am Punkt. Ein Tausch, der einen Zyklus
  erzeugen würde, wird abgelehnt. (Annahme)
* Einschub: Er beginnt laut Plan, wenn der Punkt davor laut Prognose endet – frühestens jetzt, auf die volle Minute
  aufgerundet –, in derselben Spur. Die Planzeiten der folgenden Punkte bleiben, sie rutschen über die Kette. (Annahme)
* Gästeanzeige: Der Horizont bezieht sich auf den geplanten Beginn (aktueller Plan) und gilt nicht mehr, sobald ein
  Punkt läuft oder vorbei ist. Planzeiten werden minutengenau gezeigt, nur Abweichungen auf 5 Minuten gerundet (zur
  nächsten, in der Mitte nach oben). Die Hysterese vergleicht die neue Prognose mit dem zuletzt gezeigten Wert; ist ein
  Punkt wieder genau im Plan, gilt sofort die Planzeit. "ca." heißt: gezeigter Beginn ≠ Planzeit. Gäste sehen nur den
  Beginn, kein Ende. (Annahme)
* Für Gäste unsichtbar sind neben TEAM/SECRET auch alle Punkte in Team-Spuren, in unbekannten Spuren und zurückgestellte
  Punkte; ausgefallene bleiben mit Planzeit und Grund sichtbar. (Annahme)
* Umsortieren in der Planung per „nach oben/unten" statt Ziehen: tauscht mit dem Nachbarn über `swapAdjacent` wie im
  Live-Betrieb (B übernimmt den Beginn von A). Bedienbar am Handy und per Tastatur, und Reihenfolge und Uhrzeiten
  bleiben dabei stimmig. Abweichung von Abschnitt 4 ("Ziehen"). (Annahme)
* Neue Punkte und Punkte mit geändertem Beginn oder neuer Spur werden nach ihrem Beginn in die Kette einsortiert
  (`placeInTrack`), die übrigen behalten ihre Reihenfolge. Ohne Zeitänderung bleibt die Position. (Annahme)
* Schalter "Plan bearbeiten" umfasst Punkte ändern, verschieben, anlegen und löschen. Solange das Event LIVE ist,
  brauchen Moderator*innen fürs Anlegen und Löschen stattdessen "Einschübe und Löschen". Spuren, Einstellungen,
  Schalter, Status und Freigaben bleiben bei Besitzer*in und Admin. (Annahme)
* SECRET in der Planung: Nur eingetragene Konten ändern, verschieben (auch als Tauschpartner) oder löschen einen
  geheimen Punkt. Zur Auswahl stehen Konten mit Zugriff aufs Event, mindestens eins muss eingetragen sein; das
  anlegende Konto ist vorausgewählt. Die Kontenliste sehen nur Eingetragene. (Annahme)
* Export, Duplizieren und Import enthalten nur, was das handelnde Konto sehen darf: Geheime Punkte ohne Eintrag gehen
  als Platzhalter "Geheimer Punkt" mit Zeit und Dauer mit. Kontenlisten stehen in keiner Datei; nach Import oder Kopie
  sieht geheime Punkte nur das anlegende Konto. Nicht exportiert werden Live-Stand, Ursprungsplan, Freigaben, Schalter
  und Zugang. Format `zeitplan-event`, `schemaVersion` 1, Spuren/Punkte mit frei gewählten Schlüsseln, Zeiten als ISO
  8601 mit Versatz (eindeutig auch in der doppelten Stunde). Ein Import legt immer ein neues Event an. (Annahme)
* Duplizieren und Import auf einen anderen Tag verschieben alle Punkte um ganze Kalendertage, die Uhrzeit bleibt;
  ebenso ein geändertes Eventdatum (nicht, solange das Event live ist). Duplizieren darf, wer Events anlegen darf und
  das Event sieht. (Annahme)
* Punkte beginnen frühestens am Vortag (Aufbau) und spätestens 3 Tage nach dem Eventtag, Dauer 0 bis 1440 Minuten.
  Längere Abläufe sind mehrere Events in einer Reihe. (Annahme)
* Status in der Planung: Entwurf ↔ veröffentlicht, archivieren, Archiv → Entwurf. LIVE und ENDED setzt nur die
  Live-Steuerung. Der Ursprungsplan wird beim Live-Schalten eingefroren (Phase 4), nicht schon beim Veröffentlichen –
  bis dahin sind Änderungen normale Planung. (Annahme)
* Jedes neue Event bekommt eine öffentliche Spur "Ablauf". Spuren lassen sich nur leer löschen, die letzte nie. (Annahme)
* Reihen gehören dem anlegenden Konto (anlegen darf, wer Events anlegen darf). Zuordnen lassen sich nur eigene Reihen
  (Admins: alle), in den Einstellungen des Events. Löschen einer Reihe löst nur die Zuordnung. (Annahme)
* Jede Planänderung erhöht `Event.liveVersion`; `Item.version` steigt bei jeder Änderung am Punkt (nicht beim bloßen
  Umnummerieren der Reihenfolge) und schützt Formulare vor veralteten Ständen. (Annahme)
* Standard-Zugang neuer Events ist `PUBLIC`: Ein veröffentlichtes Event ist ab Phase 3 für jede*n mit Link sichtbar,
  bis Phase 5 Zugangscode und Konto bringt. Wer das nicht will, veröffentlicht erst danach.
* Polling-Endpunkt `GET /api/view/<slug>` liefert denselben Inhalt wie das erste HTML (Event-Titel, -Beschreibung,
  -Tag, Reihe und die Punkte aus `toGuestView`). Der `ETag` ist ein Hash dieses Inhalts statt "Version + Minute": Er
  ändert sich genau dann, wenn Gäste etwas anderes sähen – auch durch Fortschreiben, Horizont, Einstellungen oder einen
  neuen Eventtitel, die `liveVersion` nicht erfasst. Jede Anfrage rechnet dafür die Prognose (bei SQLite und 200 Gästen
  unkritisch, Lasttest in Phase 8). `Cache-Control: no-store`; die Seite merkt sich den ETag selbst. Gefragt wird alle
  20–30 s (zufällig verteilt), nur bei sichtbarem Tab, sofort beim Zurückkehren und nach Verbindungsverlust. (Annahme)
* Gästeansicht, Tafel und Endpunkt zeigen Events mit Status `PUBLISHED`, `LIVE` und `ENDED` (Rückblick). Entwurf und
  Archiv ergeben 404, außer für Konten mit Zugriff aufs Event (Vorschau mit Hinweis). Events mit Zugang
  `CODE`/`ACCOUNT`/`RSVP` zeigen ohne gültigen Zugang nur den Titel, "nur mit Zugang sichtbar" und den Weg hinein, der
  Endpunkt antwortet 403 ohne Inhalt; Konten mit Zugriff sehen eine Vorschau. (Annahme)
* Den gezeigten Beginn (`guestShownStart`) speichert jede Anfrage von Gästeansicht, Tafel oder Endpunkt, sobald er sich
  ändert – ohne `Item.version` oder `liveVersion` zu erhöhen. Die Team-Ansicht rechnet ihn zur Anzeige mit, speichert
  aber nicht. (Annahme)
* Gästeansicht: Abschnitte "Jetzt" (hervorgehoben), "Als Nächstes" (die nächsten Punkte mit gleichem Beginn),
  "Danach" und "Vorbei" (eingeklappt, offen, wenn nichts mehr kommt). Ausgefallene Punkte stehen mit Planzeit an ihrem
  Platz und gelten als vorbei, sobald ein späterer Punkt läuft. Abweichende Zeiten als "neu: ca. 15:40", mit
  `showDelayToGuests` als "ca. 15:40 +10". Zeiten an einem anderen Tag als dem Eventtag mit Wochentag ("So 00:45").
  Mehrere öffentliche Spuren: Spurname je Punkt. (Annahme)
* Offline-Stand: Die Gästeansicht (und die Tafel) legt jeden Stand im `localStorage` ab (höchstens 5 Events, nie bei
  einer Vorschau). Wird die Seite ohne Verbindung neu geladen, zeigt die Offline-Seite des Service Workers diesen Stand
  mit "Stand: 15:32, keine Verbindung". Verschwindet ein Event (z. B. zurück zum Entwurf), löscht die offene Seite
  ihren Stand. (Annahme)
* Tafel: liegt als Vollbild über Kopf- und Fußzeile. Läuft etwas: bis zu zwei laufende Punkte und die nächsten drei
  (bei einem laufenden vier); sonst der nächste groß und vier danach. Lange Titel werden gekürzt, Schrift in `vh`, so
  dass nichts scrollt (geprüft bei 1920×1080 und 1280×720). Die Uhr ist die des Geräts. (Annahme)
* Reihen-Übersicht: Titel, Datum und Link der Events mit Status `PUBLISHED`, `LIVE` oder `ENDED` – auch geschützter;
  ihr Inhalt bleibt hinter dem Zugang des Events. (Annahme)
* Team-Ansicht unter `/admin/events/<id>/team` für alle Konten mit Zugriff: chronologisch wie die Gästeansicht,
  minutengenau mit Plan- und erwarteter Zeit, Abweichung, "nicht bestätigt", "überzogen", "unklar" (Deckel), "läuft
  noch?", Konflikten, internen Notizen, zurückgestellten Punkten und der Zeit, die Gäste sehen, wenn sie abweicht. Lädt
  sich alle 30 s neu (`router.refresh`, kein eigener Endpunkt). "Letzte Meldung vor X Min" kommt mit dem Verlauf in
  Phase 4. (Annahme)
* QR-Code zur Gästeansicht als SVG, serverseitig erzeugt (Paket `qrcode` wie in rsvp-app), auf einer Druckseite in der
  Verwaltung mit Download – für alle Konten mit Zugriff. (Annahme)
* Live-Aktionen laufen in einer Transaktion, die zuerst schreibt (`liveVersion` + 1) und so die Schreibsperre von
  SQLite hält: Gleichzeitige Aktionen laufen nacheinander, die zweite sieht den Stand nach der ersten. Scheitert eine
  Transaktion an einem Schreibkonflikt, wird sie mit frisch gelesenem Stand wiederholt. Live-Aktionen erhöhen
  `Item.version` der geänderten Punkte. (Annahme)
* "Weiter" nennt den beendeten und den gestarteten Punkt; gestartet wird nur der nächste nicht begonnene aktive Punkt
  nach dem beendeten. Ist das schon geschehen, ändert sich nichts ("Das ist schon passiert", aktueller Stand).
  Ohne laufenden Punkt heißt der Knopf "Start: …". Mit dem Beginn entfällt eine vorher gemeldete Verspätung. (Annahme)
* "Gestartet vor …" nicht vor dem Beginn eines früheren Punkts derselben Spur, "Beendet vor …" nicht vor dem eigenen
  Beginn, höchstens 180 Minuten zurück. Ein Punkt wird nur beendet, wenn er begonnen hat. (Annahme)
* Verspätung: Das Formular schickt die gesehene bisherige Abweichung und die Minuten; gespeichert wird der Zielwert
  (höchstens 600). Zwei Handys, die dasselbe sehen und "+5" drücken, melden so einmal "+5". (Annahme)
* Zurückstellen und Ausfall nur vor dem Beginn; Wiederherstellen setzt den Punkt an seine alte Stelle. "Als Nächstes"
  reiht einen zurückgestellten Punkt direkt nach dem laufenden (bzw. zuletzt begonnenen) Punkt seiner Spur ein, mit
  Beginn wie beim Einschub – nicht für Anker. (Annahme)
* Tauschen live wie in der Planung (`swapAdjacent`); das Formular trägt die Versionen beider Punkte, ein veralteter
  Stand wird abgelehnt. (Annahme)
* Einschub live: Titel, Dauer (1–600 Min), Sichtbarkeit öffentlich oder Team – geheime Punkte (mit Kontenliste) legt
  die Planung an. Er kommt nach dem laufenden bzw. zuletzt begonnenen Punkt der gewählten Spur. Entfernen lassen sich
  live nur eingeschobene Punkte, die noch nicht begonnen haben; alles andere löscht die Planung. (Annahme)
* Rückgängig gibt es für jede Aktion an Punkten: als Leiste unten (12 Sekunden, eigene Aktion) und im Verlauf (jede
  Aktion, jedes Konto mit Zugriff – mit denselben Prüfungen für SECRET und Schalter). Es wirkt nur, solange alle
  betroffenen Punkte noch genau so sind wie nach der Aktion; sonst "geht nicht mehr". Ein entfernter Einschub kommt
  mit id, Inhalt, Abhängigkeiten, SECRET-Liste und Anlagezeit zurück. Live schalten und Beenden sind nicht rückgängig
  zu machen. (Annahme)
* Live schalten geht nur aus `PUBLISHED`, Beenden nur aus `LIVE` – beides dürfen Besitzer*in, Admin und freigegebene
  Moderator*innen (der Trauzeuge schaltet am Tag selbst live). (Annahme)
* Automatisch `ENDED`: sechs Stunden nach dem Ende des letzten aktiven Punkts (tatsächlich, sonst geplant), ohne
  Punkte zwei Tage nach dem Eventtag; gilt für `PUBLISHED` und `LIVE`. Geprüft beim Öffnen der Live-Steuerung, bei
  jeder Live-Aktion und im täglichen Cron; im Verlauf als "Event automatisch beendet". (Annahme)
* Geheime Punkte live: Jede Aktion prüft alle genannten Punkte, auch Tauschpartner und den Bezugspunkt eines
  Einschubs. Wer nicht eingetragen ist, sieht "Geheimer Punkt" ohne Knöpfe; ist der nächste Punkt geheim, bleibt nur
  "Beendet". (Annahme)
* Live-Seite unter `/admin/events/<id>/live`: pro Spur ein Tab (Standard: die Spur, in der etwas läuft), "Jetzt" mit
  "Weiter" ganz oben, "Als Nächstes", "Danach" (Aktionen aufklappbar), Übersprungene, Zurückgestellte, Ausgefallene,
  Einschub, Vorbei, Verlauf (letzte 30 Aktionen mit Konto und Zeit), Event beenden. Lädt sich alle 15 Sekunden neu,
  nicht während einer Eingabe. Die Nachfrage "läuft noch?" steht oben mit "+5" und "Beendet". Team-Ansicht zeigt
  zusätzlich "letzte Meldung vor X Min" und den Ursprungsplan, wenn ein Punkt verlegt wurde. (Annahme)
* Zugangscode (Phase 5, abgestimmt): frei wählbar oder als Vorschlag erzeugt (8 Zeichen ohne verwechselbare
  Zeichen, z. B. `K7QM-4XPA`), mindestens 8 Buchstaben/Ziffern. Groß-/Kleinschreibung, Leerzeichen und Bindestriche
  sind egal (NFKC, Großbuchstaben). Gespeichert als `HMAC(ACCESS_CODE_SECRET, access-code:<eventId>:<Code>)`, nach dem
  Speichern einmal angezeigt, danach nie wieder; ein leeres Feld behält den Code.
* Drosselung der Code-Eingabe (abgestimmt): Fehlversuche 20 pro IP und 100 pro Event in 15 Minuten, der
  Versuch wird vor dem Vergleich reserviert, ein richtiger Code gibt ihn zurück. Die Event-Regel ist großzügig, weil
  eine Sperre dort alle Gäste trifft (Saal-WLAN teilt oft eine IP); sie endet mit dem Zeitfenster.
* Zugang `ACCOUNT` (abgestimmt): jedes angemeldete Konto dieses Tools (auch per Föderation angemeldet) sieht
  die Gästeansicht; Konten mit Zugriff aufs Event weiter die Vorschau.
* Gast-Sitzung: ein Cookie pro Event (`__Host-guest-<eventId>`, HttpOnly, SameSite=Lax) statt eines gemeinsamen
  `__Host-guest` – so bleibt der Zugang zum Polterabend, wenn danach der Code der Hochzeit eingegeben wird. Gültig bis
  zum automatischen Ende des Events (`autoEndAt`) plus 1 Tag, mindestens 1 Tag ab jetzt. Eine vorhandene Sitzung des
  Browsers wird dabei ersetzt. Code-Sitzungen gelten nur bei Zugang `CODE`, rsvp-Sitzungen (Phase 7b) nur bei `RSVP`;
  ändern sich Zugang oder Code, löscht die Verwaltung alle Gast-Sitzungen des Events. (Annahme)
* Tafel-Link: `/<slug>/tafel?k=<HMAC(DISPLAY_LINK_SECRET, display:<eventId>:<displayTokenVersion>)>`, mit
  `DISPLAY_LINK_SECRET_PREVIOUS` für einen Schlüsselwechsel. Er gilt für Tafel und Polling-Endpunkt, nicht für die
  Gästeansicht, und nie für Entwurf oder Archiv. Angezeigt wird er nur bei geschütztem Zugang, allen Konten mit Zugriff
  (Moderator*innen richten den Fernseher ein); neu erzeugen (Version + 1) nur Besitzer*in und Admin. Die Tafel sendet
  keinen Referer (`no-referrer`). (Annahme)
* Fehlt `ACCESS_CODE_SECRET` bzw. `DISPLAY_LINK_SECRET` (oder ist kürzer als 32 Zeichen), gibt es keinen Zugang per
  Code bzw. keinen Tafel-Link – kein Rückfall auf einen Standardwert; die Verwaltung weist darauf hin. (Annahme)
* Mit gültigem Zugang merkt sich die Gästeansicht (und die Tafel) den Stand auch bei geschützten Events im Browser –
  es sind nur Gästedaten, die das Gerät ohnehin gezeigt hat. (Annahme)
* Föderation (Phase 6) 1:1 wie in Seating: Endpunkte `/.well-known/suite-identity`, `/api/suite/{authorize,login,callback}`,
  Zwischenseite `/login/continue`, `ExternalIdentity(issuer, subject)`, Verknüpfen und Entfernen unter „Mein Konto“,
  Anzeige in der Kontoverwaltung. Rolle beim ersten Login (abgestimmt): wie in Seating – Admin nur mit `mapAdminRole`,
  Moderator*in bleibt Moderator*in, alle anderen Creator; danach vergeben nur lokale Admins Rollen. Empfehlung im README
  wie bei Seating `autoProvision: false`; wer Events „nur mit Konto“ für alle Konten eines anderen Tools öffnen will,
  schaltet es bewusst ein.
* Test-Doppel der Föderation auf den Ports 2530/2531 (`localhost`), damit die E2E-Tests neben denen von Seating
  (2528/2529) laufen können. (Annahme)
* Anbindung an rsvp-app (Phase 7b), Zeitplan-Seite: Verknüpfung in `Event.rsvpLink` als `{ "rsvpEventId": … }`
  (vorhandenes Feld, kein Schemawechsel). Env hier `RSVP_TIMELINE_SECRET`, in rsvp-app `TIMELINE_SECRET` und
  `TIMELINE_BASE_URL` (wie `SEATING_*`). Link-Form `<Zeitplan>/rsvp/<Event-id>`, Einstieg `?t=<Token>` als Route
  Handler (legt nach vollständiger Prüfung die Gast-Sitzung an und leitet zur Gästeansicht), Webhook
  `/api/rsvp-webhook`. Jede Nachricht trägt `rsvpId`; `rsvp-change` zusätzlich `attending`. Nachrichten gelten
  höchstens eine Stunde. Ungültige Links landen auf `/rsvp?ungueltig=1`. Ist der Link echt, das Event aber nicht auf
  `RSVP`, geht es ohne Sitzung zur Gästeansicht. (Annahme)
* Absage per Webhook beendet nur Gast-Sitzungen dieser Zusage, die bis zum Ende der Sekunde von `iat` entstanden sind
  – eine verspätet zugestellte alte Absage beendet keinen Zugang nach erneuter Zusage. `attending: true` legt nichts
  an. Ändern sich Zugang oder verknüpfter Termin, enden alle Gast-Sitzungen. (Annahme)
* Test-Doppel von rsvp-app auf Port 2532 (`localhost`) – Seatings Doppel belegen 2526–2529. (Annahme)
