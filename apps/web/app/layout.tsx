import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { dirFor, type Locale } from "../i18n/config";
import "./globals.css";
import "@repo/ui/styles/tokens.css";
import { Providers } from "./trpc/provider";
import { ChatLauncher } from "./chat/chat-launcher";
import { Sidebar } from "./nav/sidebar";
import { TopBar } from "./nav/top-bar";
import { PwaRegistrar } from "./pwa/pwa-registrar";

// Archivo for structure, IBM Plex Sans for reading, IBM Plex Mono for figures.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-archivo",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});
// Arabic has no glyphs in Archivo or Plex Sans; the tokens switch both text
// roles to this face under `dir="rtl"`. Loaded always so the switch is instant.
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
});

export const metadata: Metadata = {
  title: "Bicapack ERP",
  description: "Kraft paper bag production ERP.",
  // The Home Screen app on an iPhone (docs/pwa-plan.md). The icon is the
  // app-dir `apple-icon.png`.
  appleWebApp: { capable: true, title: "Bicapack", statusBarStyle: "default" },
  // iOS otherwise turns order numbers and quantities into phone links.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Content runs under the notch and the home indicator; the --bp-safe-*
  // tokens (tokens.css) pad whatever touches a screen edge.
  viewportFit: "cover",
  // Same as the manifest's theme_color.
  themeColor: "#f29100",
};

export default async function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  /** The `@modal` slot: a creation form as a dialog over the page, else null. */
  modal: React.ReactNode;
}>) {
  // From the `bp-locale` cookie (i18n/request.ts); `dir` flips the layout
  // for Arabic through the logical properties the stylesheets use.
  const locale = (await getLocale()) as Locale;
  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body
        className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} ${plexArabic.variable}`}
      >
        <NextIntlClientProvider>
        <Providers>
          {/* The service worker, on every page including /login, so the
              offline page is cached before anyone signs in. Renders nothing. */}
          <PwaRegistrar />
          {/* The shell: fixed sidebar plus the content column it offsets.
              Sidebar renders nothing without a session, and `.shell` keeps its
              padding at zero in that case, so /login is unaffected. */}
          <Sidebar />
          <div className="shell">
            {/* The top bar carries identity and sign-out; it, too, renders
                nothing without a session. */}
            <TopBar />
            {children}
          </div>
          {/* The corner chat launcher: the app's only chat surface, on every
              signed-in page, over the content and under any modal. Renders
              nothing without a session. */}
          <ChatLauncher />
          {/* Intercepted `/new` routes render here, over the shell, inside the
              same providers the full pages use (tRPC, toasts). */}
          {modal}
        </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
