"use client";

// Shared building blocks for the admin screens: code-to-label lookup, client-side search +
// pagination for long lists, and the de-emphasised id cell. Labels live in the catalog under
// admin.labels.<group>.<code>; an unmapped code falls back to the code itself so new backend
// values never render blank.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

/** Catalog keys cannot contain dots or dashes, so codes are normalised to snake_case. */
export function labelKeyOf(code: string): string {
  return code.trim().replace(/[^A-Za-z0-9_]+/g, "_");
}

/** ADR status text is free prose ("Accepted — implemented ..."); only its leading word is the status. */
export function adrStatusCode(status: string | null | undefined): string {
  const word = (status ?? "").trim().split(/[\s(—–:,-]+/)[0]?.toLowerCase() ?? "";
  return ["accepted", "proposed", "superseded", "deprecated", "rejected", "unknown"].includes(word) ? word : "other";
}

export type AdminLabelGroup =
  | "role" | "userStatus" | "adrStatus" | "govLayer" | "govEnforce" | "govOwner" | "govMissing" | "glossaryCategory"
  | "source" | "jobStatus" | "severity" | "channel" | "action" | "kpiKey"
  | "jobName" | "jobDesc"
  | "trigger" | "deliveryStatus";

/** Resolves `admin.labels.<group>.<code>`; falls back to the raw code when unmapped. */
export function useAdminLabel(): (group: AdminLabelGroup, code: string | null | undefined) => string {
  const t = useTranslations("admin.labels");
  return useCallback((group, code) => {
    const raw = (code ?? "").trim();
    if (!raw) return "—";
    const key = `${group}.${labelKeyOf(raw)}`;
    return t.has(key as never) ? t(key as never) : raw;
  }, [t]);
}

/** Label for a dotted KPI value path ("by_gate.screening.total"): every known segment is translated. */
export function useKpiKeyLabel(): (path: string) => string {
  const label = useAdminLabel();
  return useCallback((path: string) => path.split(".").map((seg) => label("kpiKey", seg)).join(" · "), [label]);
}

/** Case-insensitive "all terms contained" match over the given fields. */
export function matchesQuery(query: string, ...fields: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = fields.map((f) => (f ?? "").toLowerCase()).join(" ");
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export function usePaged<T>(items: readonly T[], pageSize: number) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const current = Math.min(page, pages);
  const slice = useMemo(() => items.slice((current - 1) * pageSize, current * pageSize), [items, current, pageSize]);
  return { page: current, pages, setPage, slice, total: items.length };
}

export function ListSearch({ value, onChange, ariaLabel, placeholder }: { value: string; onChange: (v: string) => void; ariaLabel: string; placeholder?: string }) {
  const t = useTranslations("admin.list");
  return (
    <input
      type="search"
      aria-label={ariaLabel}
      placeholder={placeholder ?? t("searchPlaceholder")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="sizing-new-input sizing-new-input-sm"
      style={{ width: "16rem", maxWidth: "100%" }}
    />
  );
}

export function Pager({ page, pages, total, onPage, ariaLabel }: { page: number; pages: number; total: number; onPage: (p: number) => void; ariaLabel?: string }) {
  const t = useTranslations("admin.list");
  return (
    <nav aria-label={ariaLabel ?? t("pagerAria")} className="mt-2 mb-3 flex flex-wrap items-center gap-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
      <span>{t("totalCount", { total })}</span>
      {pages > 1 && (
        <>
          <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("prev")}</button>
          <span aria-live="polite">{t("pageStatus", { page, pages })}</span>
          <button type="button" className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t("next")}</button>
        </>
      )}
    </nav>
  );
}

/** A long identifier (ULID, hash) shown short and muted; the full value is in the tooltip and one click from the clipboard. */
export function IdCell({ id }: { id: string }) {
  const t = useTranslations("admin.list");
  const tc = useTranslations("common");
  const short = id.length > 10 ? `${id.slice(0, 8)}…` : id;
  return (
    <span className="inline-flex items-center gap-1">
      <code className="font-mono text-xs text-[color:var(--muted-fg)]" title={t("idCopyTitle", { p1: id })}>{short}</code>
      {id.length > 10 && (
        <button
          type="button"
          className="btn-ghost btn-sm"
          aria-label={t("idCopyAria", { p1: id })}
          onClick={() => { void navigator.clipboard.writeText(id); }}
        >
          {tc("copy")}
        </button>
      )}
    </span>
  );
}
