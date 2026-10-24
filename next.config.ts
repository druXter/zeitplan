import type { NextConfig } from "next";
import { BASE_RULE, EMBEDDABLE, NO_FRAMING, NO_REFERRER, NOT_STORED, PRIVATE_PAGE, SECRET_URL_PAGE, SERVICE_WORKER } from "suite-kit/web";

// Header-Bausteine aus suite-kit (docs/KONVENTIONEN.md, "Sicherheits-Header"); hier stehen nur die Pfade dieses Tools.
// Einbetten verboten außer für die Gästeansicht bzw. Reihen-Übersicht /<slug> - auch die Tafel /<slug>/tafel und der
// Polling-Endpunkt nicht.

// Einzige Ausnahme im Verwaltungsbereich: die Live-Steuerung /admin/events/<id>/live darf in der Sitzungsleitung des
// Abstimmungstools erscheinen (Idee L7, LIVE_EMBED_ORIGINS). Ihre Framing-Header setzt proxy.ts zur Laufzeit - ohne
// Eintrag wie überall "frame-ancestors 'none'" und DENY. Die Regeln hier lassen genau diesen Pfad aus.
const LIVE = "admin/events/[^/]+/live/?$";

// Einbettbar wie die Eventseiten in Seating und rsvp-app (z.B. als iFrame in die Hochzeits-Website,
// docs/KONZEPT.md "Entschieden"): nur /<slug>. Die Gästeansicht löst keine Aktionen aus, Clickjacking hat
// dort kein Ziel (Erinnerungen für Gäste, Idee L12, lassen sich eingebettet nicht einschalten - Browser fragen in
// fremden iFrames nicht nach Mitteilungen, die Seite verweist auf einen neuen Tab). Fest im Code statt per Env: Die Regeln werden beim Build festgeschrieben, eine
// Env-Variable im laufenden Container würde nicht greifen. Wer nur bestimmte Seiten einbetten lassen
// will, ersetzt EMBEDDABLE (`frame-ancestors *`) durch eine Regel mit deren Origin(s) und baut neu.

const nextConfig: NextConfig = {
  // REIHENFOLGE IST WICHTIG: Passen mehrere Regeln auf denselben Pfad und setzen denselben
  // Header, gewinnt die SPÄTERE (siehe node_modules/next/dist/docs/01-app/03-api-reference/
  // 05-config/01-next-config-js/headers.md, "Header Overriding Behavior"). Ein Header lässt sich
  // dabei nur überschreiben, nicht entfernen - deshalb setzt die allgemeine Regel KEINE
  // Framing-Header (X-Frame-Options: DENY kennt keinen "erlaubt"-Wert und stünde sonst auch auf
  // der Gästeansicht). Aufbau wie in Seating:
  //
  //   1. allgemeine Regel für alles
  //   2. kein Einbetten für "/" und alle mehrteiligen Pfade (/<slug>/tafel, /api/..., /admin/...) - außer der
  //      Live-Steuerung (LIVE, Header aus proxy.ts)
  //   3. /:slug einbettbar - passt aber auch auf /admin, /login, /impressum, /offline.html ...
  //   4. einteilige Seiten des Tools wieder ohne Einbetten, sensible Bereiche mit weiteren Headern.
  //      Neue einteilige Routen hier ergänzen (tests/e2e/headers.spec.ts prüft die Header).
  //   5. Föderations-Endpunkte (Referrer-Policy)
  //   6. Service Worker der installierbaren App (nie cachen, eigene CSP)
  //
  // Nicht gesetzt: eine vollständige Content-Security-Policy. Sie würde für Next.js Nonces
  // pro Anfrage brauchen (siehe node_modules/next/dist/docs/01-app/02-guides/
  // content-security-policy.md) und alle Seiten dynamisch machen - der Nutzen ist gering,
  // da nirgends fremder Inhalt als HTML ausgegeben wird (React maskiert alles).
  async headers() {
    return [
      // 1. Allgemein.
      BASE_RULE,

      // 2. Sichere Voreinstellung für alles außer /<slug>.
      { source: "/", headers: NO_FRAMING },
      { source: `/:path((?!${LIVE})[^/]+/.+)`, headers: NO_FRAMING },

      // Die Tafel eines geschützten Events trägt ihren Schlüssel in der URL (/<slug>/tafel?k=...) - er darf
      // nicht per Referer weitergegeben werden (wie beim Reset-Link).
      { source: "/:slug/tafel", headers: NO_REFERRER },
      // Team-Link für Dienstleister (Idee L18, /<slug>/team?k=...): interne Notizen - kein Referer, kein Cache, kein Index.
      { source: "/:slug/team", headers: SECRET_URL_PAGE },

      // 3. Gästeansicht und Reihen-Übersicht (app/[slug]) sind einbettbar.
      { source: "/:slug", headers: EMBEDDABLE },

      // 4. Einteilige Seiten des Tools wieder ohne Einbetten.
      { source: "/:page(impressum|datenschutz|offline.html|manifest.webmanifest|icon.svg|apple-icon.png|favicon.ico)", headers: NO_FRAMING },
      // Sensible Bereiche. Unter /admin/... kommt das Einbett-Verbot aus Regel 2 (ohne die Live-Steuerung, siehe LIVE).
      { source: "/admin", headers: PRIVATE_PAGE },
      { source: "/admin/:path+", headers: NOT_STORED },
      { source: "/account", headers: PRIVATE_PAGE },
      // `/login/:path*` umfasst `/login` und die Zwischenseite `/login/continue` (Föderation).
      { source: "/login/:path*", headers: PRIVATE_PAGE },
      { source: "/forgot-password", headers: PRIVATE_PAGE },
      {
        // Einstieg aus rsvp-app (/rsvp/<eventId>?t=...) und dessen Fehlerseite /rsvp: Der signierte Link steht
        // in der URL - kein Referer, kein Cache, nicht einbettbar. `/rsvp/:path*` umfasst auch `/rsvp`.
        source: "/rsvp/:path*",
        headers: SECRET_URL_PAGE,
      },
      {
        // Der Einmal-Link steht in der URL - er darf weder per Referer weitergegeben
        // noch zwischengespeichert werden.
        source: "/reset-password",
        headers: SECRET_URL_PAGE,
      },

      {
        // 5. Die Föderations-Endpunkte (app/api/suite/*) tragen Einmal-Werte (Login-Bestätigung, state)
        //    in der URL. Überschreibt die Referrer-Policy der allgemeinen Regel.
        source: "/api/suite/:path*",
        headers: NO_REFERRER,
      },

      {
        // 6. Der Service Worker (public/sw.js) darf NIE aus einem Cache kommen (Browser, Cloudflare),
        //    sonst blieben Nutzer*innen auf einer alten Version hängen. Eigene CSP: Er lädt nur
        //    Ressourcen derselben Herkunft. Steht NACH Regel 3 (/:slug passt auch auf /sw.js) und
        //    ersetzt deren CSP.
        source: "/sw.js",
        headers: SERVICE_WORKER,
      },
    ];
  },
};

export default nextConfig;
