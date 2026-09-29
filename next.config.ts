import type { NextConfig } from "next";

// Seiten, die nie in einem fremden iFrame auftauchen dürfen (Clickjacking): alles außer der
// Gästeansicht bzw. Reihen-Übersicht /<slug> - auch die Tafel /<slug>/tafel und der Polling-Endpunkt.
const NO_FRAMING = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

// Seiten, die weder in Suchmaschinen noch in Caches landen sollen.
const PRIVATE_PAGE = [
  ...NO_FRAMING,
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Cache-Control", value: "no-store" },
];

// Einbettbar wie die Eventseiten in Seating und rsvp-app (z.B. als iFrame in die Hochzeits-Website,
// docs/KONZEPT.md "Entschieden"): nur /<slug>. Die Gästeansicht löst keine Aktionen aus, Clickjacking hat
// dort kein Ziel. Fest im Code statt per Env: Die Regeln werden beim Build festgeschrieben, eine
// Env-Variable im laufenden Container würde nicht greifen. Wer nur bestimmte Seiten einbetten lassen
// will, ersetzt `*` durch deren Origin(s) und baut neu.
const EMBEDDABLE = [{ key: "Content-Security-Policy", value: "frame-ancestors *" }];

const nextConfig: NextConfig = {
  // REIHENFOLGE IST WICHTIG: Passen mehrere Regeln auf denselben Pfad und setzen denselben
  // Header, gewinnt die SPÄTERE (siehe node_modules/next/dist/docs/01-app/03-api-reference/
  // 05-config/01-next-config-js/headers.md, "Header Overriding Behavior"). Ein Header lässt sich
  // dabei nur überschreiben, nicht entfernen - deshalb setzt die allgemeine Regel KEINE
  // Framing-Header (X-Frame-Options: DENY kennt keinen "erlaubt"-Wert und stünde sonst auch auf
  // der Gästeansicht). Aufbau wie in Seating:
  //
  //   1. allgemeine Regel für alles
  //   2. kein Einbetten für "/" und alle mehrteiligen Pfade (/<slug>/tafel, /api/..., /admin/...)
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
      {
        // 1. Allgemein.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Nur für diesen Host (ohne includeSubDomains), damit andere Subdomains der
          // Suite davon unberührt bleiben. Wirkt nur über HTTPS.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },

      // 2. Sichere Voreinstellung für alles außer /<slug>.
      { source: "/", headers: NO_FRAMING },
      { source: "/:first/:rest+", headers: NO_FRAMING },

      // Die Tafel eines geschützten Events trägt ihren Schlüssel in der URL (/<slug>/tafel?k=...) - er darf
      // nicht per Referer weitergegeben werden (wie beim Reset-Link).
      { source: "/:slug/tafel", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },

      // 3. Gästeansicht und Reihen-Übersicht (app/[slug]) sind einbettbar.
      { source: "/:slug", headers: EMBEDDABLE },

      // 4. Einteilige Seiten des Tools wieder ohne Einbetten.
      { source: "/:page(impressum|datenschutz|offline.html|manifest.webmanifest|icon.svg|apple-icon.png|favicon.ico)", headers: NO_FRAMING },
      // Sensible Bereiche. `/admin/:path*` umfasst auch `/admin` selbst.
      { source: "/admin/:path*", headers: PRIVATE_PAGE },
      { source: "/account", headers: PRIVATE_PAGE },
      // `/login/:path*` umfasst `/login` und die Zwischenseite `/login/continue` (Föderation).
      { source: "/login/:path*", headers: PRIVATE_PAGE },
      { source: "/forgot-password", headers: PRIVATE_PAGE },
      {
        // Einstieg aus rsvp-app (/rsvp/<eventId>?t=...) und dessen Fehlerseite /rsvp: Der signierte Link steht
        // in der URL - kein Referer, kein Cache, nicht einbettbar. `/rsvp/:path*` umfasst auch `/rsvp`.
        source: "/rsvp/:path*",
        headers: [...PRIVATE_PAGE, { key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        // Der Einmal-Link steht in der URL - er darf weder per Referer weitergegeben
        // noch zwischengespeichert werden.
        source: "/reset-password",
        headers: [...PRIVATE_PAGE, { key: "Referrer-Policy", value: "no-referrer" }],
      },

      {
        // 5. Die Föderations-Endpunkte (app/api/suite/*) tragen Einmal-Werte (Login-Bestätigung, state)
        //    in der URL. Überschreibt die Referrer-Policy der allgemeinen Regel.
        source: "/api/suite/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },

      {
        // 6. Der Service Worker (public/sw.js) darf NIE aus einem Cache kommen (Browser, Cloudflare),
        //    sonst blieben Nutzer*innen auf einer alten Version hängen. Eigene CSP: Er lädt nur
        //    Ressourcen derselben Herkunft. Steht NACH Regel 3 (/:slug passt auch auf /sw.js) und
        //    ersetzt deren CSP.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
