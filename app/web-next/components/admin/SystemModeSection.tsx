"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [state, setState] = useState<SystemModeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = useCallback(() => {
    api.get<SystemModeResponse>("/api/admin/system-mode")
      .then((r) => setState(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "시스템 모드 조회 실패"));
  }, []);

  useEffect(() => { load(); }, [load]);

  function applyMode(mode: "production" | "development") {
    if (!state || state.mode === mode || saving) return;
    setSaving(true); setError(null); setNotice(null);
    api.post<{ mode: string }>("/api/admin/system-mode", { mode })
      .then(() => { setNotice(`시스템 모드가 ${mode === "production" ? "운영(production)" : "개발(development)"}으로 변경되었습니다.`); load(); })
      .catch((e) => setError(e instanceof Error ? e.message : "시스템 모드 변경 실패"))
      .finally(() => setSaving(false));
  }

  function requestMode(mode: "production" | "development") {
    if (mode === "development") {
      confirm(
        "개발(development) 모드로 전환할까요?",
        () => applyMode("development"),
        { body: "개발 모드에서는 프로젝트·검토/안건 삭제(톰스톤)가 다시 허용됩니다 — 테스트 데이터 정리 목적으로만 사용하세요.", confirmLabel: "전환" },
      );
    } else {
      applyMode("production");
    }
  }

  return (
    <div className="card">
      <h2>시스템 모드</h2>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
        운영(production) 모드에서는 프로젝트·검토/안건 삭제(톰스톤 포함)가 전면 차단됩니다 — 실제 딜 데이터가 실수로 지워지는 사고를 막기 위함입니다.
        개발(development) 모드에서는 테스트 데이터 정리를 위해 삭제가 다시 허용됩니다. 이 설정은 관리자만 변경할 수 있습니다.
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {notice && <p className="text-[color:var(--green-fg)]">{notice}</p>}
      {!state && !error && <p>불러오는 중...</p>}
      {state && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className={`status-chip ${state.mode === "production" ? "status-green" : "status-amber"}`}>
              현재: {state.mode === "production" ? "운영 (production)" : "개발 (development)"}
            </span>
            {state.updated_at && (
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                마지막 변경: {state.updated_by ?? "—"} · {state.updated_at.slice(0, 16).replace("T", " ")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={saving || state.mode === "production"} onClick={() => requestMode("production")}>
              운영(production)으로 전환 — 삭제 차단
            </button>
            <button type="button" className="btn-ghost" disabled={saving || state.mode === "development"} onClick={() => requestMode("development")}>
              개발(development)으로 전환 — 삭제 허용
            </button>
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
