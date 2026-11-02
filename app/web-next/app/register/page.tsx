"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

// OWNER DECISION 2026-11-02 (access tightening, Option A): self-registration is
// closed — accounts are issued by the administrator (CLI user:create flow or
// /api/admin/users). The route stays mounted as a short disabled notice so
// stale bookmarks and old links get an explanation instead of a 404; it
// renders no form and calls no API. The backend endpoint
// (/api/auth/register) refuses by default with 403 registration_disabled.
export default function RegisterPage() {
  const t = useTranslations("auth.register");
  return (
    <main className="login-page login-page-rich">
      <div className="login-panel">
        <h1>{t("disabledHeading")}</h1>
        <p className="login-hint">{t("disabledMessage")}</p>
        <Link href="/login" className="login-link">
          {t("backToLogin")}
        </Link>
      </div>
    </main>
  );
}
