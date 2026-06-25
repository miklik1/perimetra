import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";

import { getBootstrap } from "@repo/flags/web/server";
import { DEFAULT_TIME_ZONE, getMessages } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { getLocale } from "@repo/i18n/web/server";

import { Providers } from "./providers";

import "./globals.css";

// Perimetra brand typeface trio (ADR 0078), self-hosted variable woff2 — served
// from the app origin so the strict CSP (`font-src 'self'`, proxy.ts) holds with
// nothing external. Licensed under the Fontshare Free Font EULA (commercial Web
// use; see ./fonts/FONT-LICENSE-fontshare-FFL.txt). Role assignment per the
// Bombardier brand-extraction Part-A hierarchy:
//   Chillax  → display / step labels / headings   (--font-display)
//   Synonym  → body / UI text (the default)        (--font-sans)
//   Amulya   → data labels / numeric emphasis       (--font-data)
// Each is a single variable file spanning its full weight axis; the role tokens
// in tooling/tailwind-config/theme.css bind to these variables (web) and fall
// back to the literal family name (mobile / no-JS).
const chillax = localFont({
  src: "./fonts/Chillax-Variable.woff2",
  weight: "200 700",
  variable: "--font-chillax",
  display: "swap",
});
const synonym = localFont({
  src: "./fonts/Synonym-Variable.woff2",
  weight: "200 700",
  variable: "--font-synonym",
  display: "swap",
});
const amulya = localFont({
  src: "./fonts/Amulya-Variable.woff2",
  weight: "300 700",
  variable: "--font-amulya",
  display: "swap",
});
// Geist Mono stays the monospace face (code / mono UI) — no brand mono in the trio.
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Web",
    template: "%s | Web",
  },
  description: "A cross-platform web and mobile application.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale resolved server-side from the cookie (ADR 0020): drives `<html lang>`
  // and the next-intl context, so RSC renders already-translated HTML on the
  // first byte — no untranslated flash, hence no locale equivalent of the
  // no-FOUC theme script below.
  const locale = await getLocale();
  const messages = getMessages(locale);
  // Server-evaluated flags for the client bootstrap (ADR 0028): one cached
  // evaluation per request (shared with any page-level `getFlag`), handed to
  // FlagsProvider → `posthog.init({ bootstrap })` — no flag flash. Undefined
  // without a PostHog key (and then no cookie read happens here either).
  const flagsBootstrap = await getBootstrap();
  // Per-request CSP nonce minted in proxy.ts (ADR 0026), forwarded on the
  // `x-nonce` request header. Stamped on the inline theme script below so it
  // runs under the strict, nonce-based `script-src` (no `unsafe-inline`).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/*
         * No-FOUC theme script: sets `.dark` from the stored preference (or the
         * OS scheme when unset/"system") before first paint, so the page never
         * flashes the wrong theme. Kept in sync with apps/web/lib/theme.ts
         * (storage key + values) and ThemeEffect, which takes over after hydration.
         * Carries the per-request nonce so it passes the strict CSP.
         * suppressHydrationWarning: browsers blank the `nonce` content
         * attribute once the element lands in the DOM (nonce hiding), so the
         * client hydration pass reads `""` against the server's value — a
         * spec-mandated, benign mismatch (the script already ran from the
         * server HTML).
         */}
        <script
          suppressHydrationWarning
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");var dark=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${synonym.variable} ${chillax.variable} ${amulya.variable} ${geistMono.variable} bg-background text-foreground font-sans antialiased`}
      >
        {/*
         * I18nProvider (next-intl) — locale + messages passed explicitly (v4
         * does not reliably infer `locale` for the client provider here), so
         * "use client" leaves get `useTranslations`/`useLocale`; RSC components
         * use `getTranslations` directly.
         */}
        <I18nProvider locale={locale} messages={messages} timeZone={DEFAULT_TIME_ZONE}>
          <Providers flagsBootstrap={flagsBootstrap}>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
