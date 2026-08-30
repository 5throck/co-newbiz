import type { ReactNode } from "react";
import { AuthProvider } from "../lib/auth-client.tsx";
import { GlossaryProvider } from "../lib/glossary-provider.tsx";
import { AppShell } from "../components/AppShell.tsx";
import "./styles.css";

// Phase 3 port of app/web/src/App.tsx's provider tree
// (AuthProvider > GlossaryProvider > routed content). react-router-dom's
// <BrowserRouter> has no Next.js equivalent needed — the App Router itself
// is the router.

// Pre-paint theme restore: light is the default; a stored dark preference is
// applied before first paint to avoid a flash. Keep in sync with
// components/ThemeToggle.tsx ("cn-theme" localStorage key).
const THEME_INIT = `(function(){try{var t=localStorage.getItem("cn-theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <AuthProvider>
          <GlossaryProvider>
            <AppShell>{children}</AppShell>
          </GlossaryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
