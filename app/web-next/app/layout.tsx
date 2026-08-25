import type { ReactNode } from "react";
import { AuthProvider } from "../lib/auth-client.tsx";
import { GlossaryProvider } from "../lib/glossary-provider.tsx";
import { AppShell } from "../components/AppShell.tsx";
import "./styles.css";

// Phase 3 port of app/web/src/App.tsx's provider tree
// (AuthProvider > GlossaryProvider > routed content). react-router-dom's
// <BrowserRouter> has no Next.js equivalent needed — the App Router itself
// is the router.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
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
