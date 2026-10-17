# Oberfläche – Konzept

Neugestaltung vom 2026-10-17, angelehnt an rsvp-app, Abstimmungstool und Schichten (dort jeweils
`docs/KONZEPT-OBERFLAECHE.md`). Ziel: Wer mehrere Tools der Suite nutzt, findet sich sofort zurecht – gleiche Kopfzeile,
gleiche Bausteine, gleicher Aufbau „Übersicht → Seite mit Reitern → Einstellungen in Abschnitten“. Schwerpunkt Handy:
Moderator\*innen steuern am Tag selbst mit dem Telefon, Gäste lesen den Ablauf fast nur am Telefon.

## Ausgangslage

* Die Event-Seite war eine lange Spalte aus zehn Karten: Ablauf, sieben gleichrangige Links zu Ansichten, Team-Link,
  Status, Einstellungen, Zugang, Prognose, Schichten, Freigaben, Löschen – ohne Kennzahlen und ohne Unterscheidung
  zwischen täglichem Gebrauch und Seltenem. Unterseiten (Ablauf, Live, Team-Ansicht, Rückblick …) hatten je einen
  eigenen Zurück-Link und eigene Link-Reihen.
* „Verwaltung“ war eine Linkliste, „Events“ eine Textliste mit Titel und Datum.
* Kopfzeile nur als Textlinks rechts oben, Abmelden als eigener Knopf; auf Gästeseiten blieb eine leere Leiste.
* Auf dem Handy: Uhrzeit-Spalte 112 px breit, Bearbeiten-Knöpfe neben dem Inhalt, Eingabefelder in 14 px (iOS zoomt
  hinein), Spuren als umbrechende Tabs.

## Aufbau

| Seite | Inhalt |
| --- | --- |
| `/admin`, `/admin/events` | Übersicht „Events“: *Aktuell* (Entwurf, veröffentlicht, live) und eingeklappt *Vergangen* (beendet, archiviert). Pro Event Tag, Status, Reihe, „freigegeben“, Programmpunkte, Spuren und Zeitraum laut Plan. Live-Events sind rot umrandet; live oder heute gibt es den Knopf „Live-Steuerung“. Oben „Importieren“ und „Neues Event“. |
| `/admin/events/[id]` | Event-Seite mit Kopf (Titel, Tag, Status, Zugang, Verknüpfungen, „Gästeansicht ↗“) und Reitern. **Übersicht**: Kennzahlen (Programmpunkte, Spuren, Beginn, Ende), Status mit „Live-Steuerung“, „Ablauf planen“ und den Statuswechseln, für Freigegebene ihre Rechte, „Für Gäste“ (Link, QR-Code, Programmheft), „Anzeigetafel“, Team-Link, „Mehr“ (Drucken, Was wäre wenn, Export, Duplizieren). |
| `…/plan` | **Ablauf**: Umschalter Alle/je Spur (seitlich scrollbar), „Was wäre wenn?“, „Neuer Punkt“; Liste mit Zeit, Inhalt und darunter (Handy) bzw. daneben die Knöpfe ↑ ↓ Bearbeiten. Darunter einklappbar „Spuren“ (nur owner) und „Orte“. Punkt anlegen/bearbeiten und „Was wäre wenn?“ gehören zum Reiter. |
| `…/live` | **Live**: unverändert fürs Handy aufgebaut (große Knöpfe, „Weiter“ oben, Rückgängig als Leiste unten), der laufende Punkt blau umrandet, Spuren als Pillen. Eingebettet (Sitzungsleitung im Abstimmungstool) ohne Kopf und Reiter. |
| `…/team` | **Team-Ansicht** mit „Nur meine Punkte“, Vorwarnung, Tafel, Drucken. |
| `…/rueckblick` | **Rückblick**, beim Drucken mit Titel des Events. |
| `…/einstellungen` | **Einstellungen** (nur owner) in Abschnitten mit Kurzstand: Event · Zugang für Gäste · Prognose, Anzeige und Rechte · Schichten · Freigaben; darunter Löschen. Jeder Abschnitt speichert für sich, `?abschnitt=<id>` öffnet einen. |
| `…/druck`, `…/qr`, `…/duplicate` | im selben Rahmen ohne eigenen Reiter (erreichbar über die Übersicht); Kopf und Reiter erscheinen nicht im Ausdruck. |
| `/admin/series`, `/admin/series/[id]` | Reihen als Karten; eine Reihe mit Kopf („Seite für Gäste ↗“), ihren Events als Karten, Einstellungen einklappbar, Löschen. |

## Gestaltung

* Bausteine in `app/ui/kit.tsx`, dieselben wie in den anderen Tools (Card, Badge, Stat, ButtonLink/buttonClass,
  SettingsSection, PageHeader, Main, EmptyState, Segmented, inputClass). Hinweise über `app/ui/notice.tsx` mit
  denselben Farben; `app/ui/badge.tsx` und `app/ui/status-badge.tsx` nutzen den Badge aus dem Kit.
* Ruhig: weiß/grau, Blau nur für Hauptaktionen und den aktiven Reiter, keine Emojis an Knöpfen. Farbe trägt Bedeutung:
  Status grün veröffentlicht, rot live, grau Entwurf/beendet; amber Verspätung, Team und Durchsage; lila geheim und
  Schichten; pink rsvp-app; türkis freigegeben.
* Kopfzeile (`app/ui/account-nav.tsx`): Marke, Events, bei Creator und Admins Reihen, bei Admins und Creator Konten,
  Konto-Menü (Mein Konto, Abmelden; schließt sich nach Seitenwechsel und Klick daneben). Auf Seiten für Gäste
  (`/<slug>`, `/<slug>/team`) nur für angemeldete Konten, auf der Tafel nie (`app/ui/header-gate.tsx`). Beim Drucken
  und eingebettet ausgeblendet.
* Handy: Reiter seitlich scrollbar (der aktive scrollt ins Bild), Eingabefelder in 16 px, Knöpfe vor Ort mindestens
  44 px hoch, Aktionen unter dem Inhalt statt daneben.
* Einklappbare Abschnitte merken sich ihren Zustand selbst (`app/ui/disclosure.tsx`).

## Gästeansicht

Schmal wie die Gästeseite in rsvp-app: Kopf als Karte (Reihe, Titel, Tag, Beschreibung), darunter Durchsage und die
Abschnitte *Jetzt* (blau umrandet, größer), *Als Nächstes*, *Danach* und eingeklappt *Vorbei* mit kleinen
Abschnittsüberschriften. Uhrzeit-Spalte 80 px, „fällt aus“ und Spur als Badge. Zugang (Code, Konto, rsvp-app) und
Reihen-Übersicht im selben Stil. Die Anzeigetafel bleibt, wie sie ist.
