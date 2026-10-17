// app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import AccountNav from "./ui/account-nav";
import PwaRegister from "./ui/pwa-register";
import FooterLink from "./ui/footer-link";
import { APP_NAME } from "./lib/app";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Ablauf großer Events mit Live-Prognose",
  applicationName: APP_NAME,
  // iOS: als App vom Home-Bildschirm ohne Safari-Leiste starten (Icons: app/icon.svg, app/apple-icon.png,
  // app/favicon.ico und public/icons/ - Manifest in app/manifest.ts).
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
};

// Nur im Verwaltungsbereich (dort ist allein die Live-Steuerung einbettbar): Die eingebettete Gästeansicht behält
// Impressum und Datenschutz.
const EMBED_SCRIPT = "if (window.top !== window.self && location.pathname.indexOf('/admin/') === 0) document.documentElement.setAttribute('data-embedded', '')"

export const viewport: Viewport = {
  // Färbt die Statusleiste/Titelleiste der installierten App (passend zu manifest.ts).
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body className="antialiased min-h-screen flex flex-col dark:bg-gray-900 dark:text-gray-100">
        {/* Eingebettete Live-Steuerung (Sitzungsleitung im Abstimmungstool, proxy.ts): ohne Kopf- und Fußzeile.
            Vor dem ersten Zeichnen gesetzt, damit nichts aufblitzt. */}
        <script dangerouslySetInnerHTML={{ __html: EMBED_SCRIPT }} />
        {/* Der Konto-Status liest Cookies (dynamisch) - in Suspense, damit er den Rest der Seite nicht aufhält. */}
        <Suspense fallback={<div className="h-12 embed-hidden" />}>
          <AccountNav />
        </Suspense>
        <div className="grow">{children}</div>
        <footer className="embed-hidden print:hidden text-center text-xs text-gray-500 dark:text-gray-400 py-4">
          <FooterLink href="/impressum">Impressum</FooterLink>
          {" · "}
          <FooterLink href="/datenschutz">Datenschutz</FooterLink>
        </footer>
        <PwaRegister />
      </body>
    </html>
  );
}
