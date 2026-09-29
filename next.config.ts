import type { NextConfig } from "next";

// Seiten, die nie in einem fremden iFrame auftauchen dürfen (Clickjacking). Anders als in Seating
// gilt das hier für ALLE Seiten, auch für die Gästeansicht /<slug> und die Tafel /<slug>/tafel
// (docs/KONZEPT.md, Entschieden: "nicht einbettbar"). Soll die Gästeansicht später einbettbar werden
// (wie die Eventseiten in Seating und rsvp-app), braucht sie eine eigene Regel mit
// `frame-ancestors ...` HINTER Regel 2 - und X-Frame-Options darf dann auf diesem Pfad gar nicht
// gesetzt sein (er kennt keinen "erlaubt"-Wert und lässt sich nicht entfernen, nur überschreiben).
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

const nextConfig: NextConfig = {
  // REIHENFOLGE IST WICHTIG: Passen mehrere Regeln auf denselben Pfad und setzen denselben
  // Header, gewinnt die SPÄTERE (siehe node_modules/next/dist/docs/01-app/03-api-reference/
  // 05-config/01-next-config-js/headers.md, "Header Overriding Behavior"). Ein Header lässt sich
  // dabei nur überschreiben, nicht entfernen. Aufbau:
  //
  //   1. allgemeine Regel für alles
  //   2. kein Einbetten für alles
  //   3. sensible Bereiche (Verwaltung, Konto, Anmeldung) mit weiteren Headern.
  //      ACHTUNG: Die Gästeansicht /:slug (ab Phase 3) passt auch auf /admin, /login, /account ...
  //      Regeln für /:slug gehören deshalb VOR diese Regeln, damit die sensiblen Bereiche ihre
  //      strengeren Werte behalten.
  //   4. Service Worker der installierbaren App (nie cachen, eigene CSP)
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

      // 2. Kein Einbetten, nirgends. `/:path*` umfasst auch `/`.
      { source: "/:path*", headers: NO_FRAMING },

      // 3. Sensible Bereiche. `/admin/:path*` umfasst auch `/admin` selbst.
      { source: "/admin/:path*", headers: PRIVATE_PAGE },
      { source: "/account", headers: PRIVATE_PAGE },
      // `/login/:path*` umfasst `/login` und künftige Unterseiten (Föderation, Phase 6).
      { source: "/login/:path*", headers: PRIVATE_PAGE },
      { source: "/forgot-password", headers: PRIVATE_PAGE },
      {
        // Der Einmal-Link steht in der URL - er darf weder per Referer weitergegeben
        // noch zwischengespeichert werden.
        source: "/reset-password",
        headers: [...PRIVATE_PAGE, { key: "Referrer-Policy", value: "no-referrer" }],
      },

      {
        // 4. Der Service Worker (public/sw.js) darf NIE aus einem Cache kommen (Browser, Cloudflare),
        //    sonst blieben Nutzer*innen auf einer alten Version hängen. Eigene CSP: Er lädt nur
        //    Ressourcen derselben Herkunft. Steht NACH Regel 2 und ersetzt deren CSP.
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
