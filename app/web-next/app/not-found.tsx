import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StatusPage } from "../components/StatusPage.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("errors");
  return { title: t("notFound.title") };
}

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <StatusPage title={t("notFound.title")}>
      {t("notFound.body")}
    </StatusPage>
  );
}
