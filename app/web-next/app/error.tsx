"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { StatusPage } from "../components/StatusPage.tsx";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusPage title={t("unexpected.title")} onRetry={reset} detail={error.digest ? t("unexpected.digest", { digest: error.digest }) : undefined}>
      {t("unexpected.body")}
    </StatusPage>
  );
}
