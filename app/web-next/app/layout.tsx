import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { defaultLocale, isLocale, localeDirection } from "../i18n/config.ts";
import { AuthProvider } from "../lib/auth-client.tsx";
import { GlossaryProvider } from "../lib/glossary-provider.tsx";
import { ToastProvider } from "../components/ui.tsx";
import { AppShell } from "../components/AppShell.tsx";
import "./styles.css";

// Phase 3 port of app/web/src/App.tsx's provider tree
// (AuthProvider > GlossaryProvider > routed content). react-router-dom's
// <BrowserRouter> has no Next.js equivalent needed — the App Router itself
// is the router.

// WCAG 2.4.2 (axe document-title): every page needs a <title>. Pages inherit this default.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  // `titleSuffix` lives under pages.titles (locale restructure); scope a
  // second translator there, matching every other pages.titles consumer.
  const tTitles = await getTranslations("pages.titles");
  return {
    title: { default: t("appName"), template: `%s · ${tTitles("titleSuffix")}` },
  };
}

// Pre-paint theme restore: light is the default; a stored dark preference is
// applied before first paint to avoid a flash. Keep in sync with
// components/ThemeToggle.tsx ("cn-theme" localStorage key).
const THEME_INIT = `(function(){try{var t=localStorage.getItem("cn-theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={localeDirection(isLocale(locale) ? locale : defaultLocale)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <NextIntlClientProvider messages={await getMessages()}>
          <AuthProvider>
            <ToastProvider>
              <GlossaryProvider>
                <AppShell>{children}</AppShell>
              </GlossaryProvider>
            </ToastProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
