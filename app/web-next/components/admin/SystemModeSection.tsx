"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";
import { useConfirm } from "../crud.tsx";

// 관리자 콘솔 — 시스템 모드 섹션 (ADR-0133). production|development 전역
// 스위치 — production에서는 프로젝트·검토/안건 DELETE(톰스톤)가 차단된다.
// 관리자만 접근 가능(app/admin/layout.tsx가 상위에서 role을 가른다).

interface SystemModeResponse {
  mode: "production" | "development";
  updated_by: string | null;
  updated_at: string | null;
}

export function SystemModeSection() {
  const t = useTranslations("admin.systemMode");
  const tc = useTranslations("common");
  const [state, setState] = useState<SystemModeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = useCallback(() => {
    api.get<SystemModeResponse>("/api/admin/system-mode")
      .then((r) => setState(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
  }, []);

  useEffect(() => { load(); }, [load]);

  function applyMode(mode: "production" | "development") {
    if (!state || state.mode === mode || saving) return;
    setSaving(true); setError(null); setNotice(null);
    api.post<{ mode: string }>("/api/admin/system-mode", { mode })
      .then(() => { setNotice(t("changedNotice", { p1: mode === "production" ? t("modeProduction") : t("modeDevelopment") })); load(); })
      .catch((e) => setError(e instanceof Error ? e.message : t("changeFailed")))
      .finally(() => setSaving(false));
  }

  function requestMode(mode: "production" | "development") {
    if (mode === "development") {
      confirm(
        t("devConfirmTitle"),
        () => applyMode("development"),
        { body: t("devConfirmBody"), confirmLabel: t("switchLabel") },
      );
    } else {
      applyMode("production");
    }
  }

  return (
    <div className="card">
      <h2>{t("heading")}</h2>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
        {t("intro")}
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {notice && <p className="text-[color:var(--green-fg)]">{notice}</p>}
      {!state && !error && <p>{tc("loading")}</p>}
      {state && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className={`status-chip ${state.mode === "production" ? "status-green" : "status-amber"}`}>
              {t("currentPrefix")} {state.mode === "production" ? t("currentProduction") : t("currentDevelopment")}
            </span>
            {state.updated_at && (
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("lastChangedPrefix")} {state.updated_by ?? "—"} · {state.updated_at.slice(0, 16).replace("T", " ")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={saving || state.mode === "production"} onClick={() => requestMode("production")}>
              {t("toProductionButton")}
            </button>
            <button type="button" className="btn-ghost" disabled={saving || state.mode === "development"} onClick={() => requestMode("development")}>
              {t("toDevelopmentButton")}
            </button>
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
