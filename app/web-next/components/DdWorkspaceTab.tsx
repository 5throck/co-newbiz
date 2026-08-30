"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { DdTab } from "./DdTab.tsx";

// DD workspace — checklist-driven Commercial/Technical/Legal DD on top of the
// existing free-form dd_finding list (rendered below via DdTab). Each kind
// maps to its gate checklist (checklists/*.yaml, the same SSOT as /library);
// per-item assessments persist in project_checklist_item_state (migration
// 0039) and roll up to a progress bar plus a mandatory-open list that must
// clear before the Entity IC gate.

type DdKind = "commercial" | "technical" | "legal";

const KIND_LABELS: Record<DdKind, string> = {
  commercial: "Commercial DD",
  technical: "Technical DD",
  legal: "Legal DD",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "미판정",
  pass: "충족",
  fail: "미충족",
  na: "해당없음",
  waived: "예외(waiver)",
};

interface WorkspaceItem {
  id: string;
  text: string;
  mandatory: boolean;
  waiver_eligible: boolean;
  status: string;
  note: string | null;
  evidence_ref: string | null;
  waiver_id: string | null;
  assessed_by: string | null;
  assessed_at: string | null;
}

interface WorkspaceData {
  checklist_id: string;
  kind: DdKind;
  items: WorkspaceItem[];
  progress: {
    total: number;
    assessed: number;
    pass: number;
    fail: number;
    na: number;
    waived: number;
    mandatory_total: number;
    mandatory_open: Array<{ id: string; text: string; status: string }>;
  };
}

function DdWorkspace({ projectId, kind }: { projectId: string; kind: DdKind }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { status: string; note: string; evidence_ref: string; waiver_id: string }>>({});

  const load = useCallback(() => {
    api
      .get<WorkspaceData>(`/api/projects/${projectId}/dd-workspace/${kind}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [projectId, kind]);

  useEffect(load, [load]);

  function draftFor(item: WorkspaceItem) {
    return (
      draft[item.id] ?? {
        status: item.status === "pending" ? "pass" : item.status,
        note: item.note ?? "",
        evidence_ref: item.evidence_ref ?? "",
        waiver_id: item.waiver_id ?? "",
      }
    );
  }

  function setDraftItem(item: WorkspaceItem, patch: Partial<{ status: string; note: string; evidence_ref: string; waiver_id: string }>) {
    setDraft((prev) => ({ ...prev, [item.id]: { ...draftFor(item), ...patch } }));
  }

  async function assess(item: WorkspaceItem) {
    const d = draftFor(item);
    setBusyItem(item.id);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/dd-workspace/${kind}`, {
        item_id: item.id,
        status: d.status,
        note: d.note || undefined,
        evidence_ref: d.evidence_ref || undefined,
        waiver_id: d.status === "waived" ? d.waiver_id || undefined : undefined,
      });
      setDraft((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "판정 기록 실패");
    } finally {
      setBusyItem(null);
    }
  }

  if (error && data === null) {
    return (
      <p role="alert" className="text-[color:var(--red-fg)]">
        {error}
      </p>
    );
  }
  if (!data) return <p>불러오는 중...</p>;

  const pct = data.progress.total === 0 ? 0 : Math.round((data.progress.assessed / data.progress.total) * 100);

  return (
    <div className="dd-workspace">
      <div className="dd-progress card-sub">
        <div className="dd-progress-head">
          <span>
            진척률 {pct}% ({data.progress.assessed}/{data.progress.total}항목)
          </span>
          <span className="dd-progress-badges">
            <span className="status-chip status-green">충족 {data.progress.pass}</span>
            <span className="status-chip status-red">미충족 {data.progress.fail}</span>
            <span className="status-chip">해당없음 {data.progress.na}</span>
            <span className="status-chip status-amber">예외 {data.progress.waived}</span>
          </span>
        </div>
        <div className="dd-progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="dd-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        {data.progress.mandatory_open.length > 0 && (
          <p className="dd-progress-note">
            필수 미충족 {data.progress.mandatory_open.length}건 — Entity IC 게이트 전 해소 필요:{" "}
            {data.progress.mandatory_open.map((m) => m.id).join(", ")}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}

      <ul className="dd-checklist">
        {data.items.map((item) => {
          const d = draftFor(item);
          const dirty = draft[item.id] !== undefined;
          return (
            <li key={item.id} className={`dd-checklist-item ${dirty ? "dd-checklist-item-dirty" : ""}`}>
              <div className="dd-checklist-head">
                <code className="dd-item-id">{item.id}</code>
                {item.mandatory && <span className="dd-category-badge">필수</span>}
                <span className={`status-chip ${item.status === "pass" ? "status-green" : item.status === "fail" ? "status-red" : item.status === "waived" ? "status-amber" : "status-not-started"}`}>
                  {STATUS_LABELS[item.status] ?? item.status}
                </span>
                {item.assessed_by && (
                  <span className="dd-item-meta">
                    {item.assessed_by} · {item.assessed_at?.slice(0, 10)}
                  </span>
                )}
              </div>
              <p className="dd-item-text">{item.text}</p>
              <div className="dd-item-form">
                <select
                  aria-label={`${item.id} 판정`}
                  value={d.status}
                  onChange={(e) => setDraftItem(item, { status: e.target.value })}
                >
                  <option value="pass">충족</option>
                  <option value="fail">미충족</option>
                  <option value="na">해당없음</option>
                  {item.waiver_eligible && <option value="waived">예외(waiver)</option>}
                </select>
                <input
                  type="text"
                  aria-label={`${item.id} 근거`}
                  placeholder="근거 (evidence_ref)"
                  value={d.evidence_ref}
                  onChange={(e) => setDraftItem(item, { evidence_ref: e.target.value })}
                />
                <input
                  type="text"
                  aria-label={`${item.id} 메모`}
                  placeholder="메모"
                  value={d.note}
                  onChange={(e) => setDraftItem(item, { note: e.target.value })}
                />
                {d.status === "waived" && (
                  <input
                    type="text"
                    aria-label={`${item.id} waiver ID`}
                    placeholder="waiver ID"
                    value={d.waiver_id}
                    onChange={(e) => setDraftItem(item, { waiver_id: e.target.value })}
                  />
                )}
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busyItem === item.id}
                  onClick={() => assess(item)}
                >
                  {busyItem === item.id ? "저장 중..." : "판정 기록"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DdWorkspaceTab({
  projectId,
  onOpenAssumption,
}: {
  projectId: string;
  onOpenAssumption?: (assumptionKey: string) => void;
}) {
  const [kind, setKind] = useState<DdKind>("commercial");
  return (
    <div>
      <div className="tab-bar" role="tablist" aria-label="DD 유형">
        {(Object.keys(KIND_LABELS) as DdKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            aria-current={kind === k ? "true" : undefined}
            onClick={() => setKind(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <DdWorkspace projectId={projectId} kind={kind} />
      <h2 className="mt-8 mb-2">실사 조사내역 (dd_finding)</h2>
      <DdTab projectId={projectId} onOpenAssumption={onOpenAssumption} />
    </div>
  );
}
