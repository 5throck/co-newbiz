"use client";
import { useTranslations } from "next-intl";

// Source links for AI holding drafts (ADR-0172 amendment 2026-10-14): http(s) only, host shown, opens in a new tab.

export function SourceLinks({ sources }: { sources?: Array<{ title: string; url: string }> }) {const t = useTranslations("stages.s3.sourceLinks");
  const safe = (sources ?? []).filter((s) => /^https?:\/\//i.test(s.url));
  if (safe.length === 0) return null;
  return (
    <span className="block text-[length:var(--fs-caption)]">
      {t("source")}{" "}
      {safe.map((s, i) => (
        <span key={s.url}>{i > 0 && ", "}<a href={s.url} target="_blank" rel="noopener noreferrer" className="underline" title={s.title}>{hostOf(s.url)}</a></span>
      ))}
    </span>
  );
}
function hostOf(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url.slice(0, 40); } }
