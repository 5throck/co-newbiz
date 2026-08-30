"use client";

import { useEffect, useState } from "react";
import { api, type AssumptionRow, type RunSummary } from "../lib/api.ts";
import { SourceTooltip } from "./SourceTooltip.tsx";
import { GlossaryText } from "../lib/glossary-provider.tsx";

// 가정 (Assumptions) tab — ui-spec §2: read-only registry for the
// project's latest run (GET /api/projects/:id/runs, newest-first — the
// first row is the latest, per analysis.ts's ORDER BY created_at DESC).
// kind renders as a chip (live/user/derived/assumed); assumed rows must
// visibly show rationale (FR-DATA-07) — not hidden behind a tooltip.
// Write form (POST /api/assumptions) is deliberately deferred; see the
// ui-spec §2 delta note.

const KIND_META: Record<string, { label: string; className: string }> = {
  live: { label: "실시간", className: "kind-live" },
  user: { label: "사용자 입력", className: "kind-user" },
  derived: { label: "파생값", className: "kind-derived" },
  assumed: { label: "가정값", className: "kind-assumed" },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { label: kind, className: "kind-unknown" };
}

export function AssumptionsTab({
  projectId,
  focusKey,
  onFocusClear,
}: {
  projectId: string;
  focusKey?: string | null;
  onFocusClear?: () => void;
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [assumptions, setAssumptions] = useState<AssumptionRow[] | null>(null);

  useEffect(() => {
    api
      .get<RunSummary[]>(`/api/projects/${projectId}/runs`)
      .then((res) => setRuns(res.data))
      .catch(() => setRuns([]));
  }, [projectId]);

  const latestRun = runs && runs.length > 0 ? runs[0] : null;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    if (runs && runs.length > 0 && !selectedRunId) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    // 딥링크 포커스(value_impact → 가정)가 있으면 실행 무관하게 키로 조회한다.
    if (focusKey?.trim()) {
      api
        .get<AssumptionRow[]>(`/api/assumptions?key=${encodeURIComponent(focusKey.trim())}`)
        .then((res) => setAssumptions(res.data))
        .catch(() => setAssumptions([]));
      return;
    }
    if (!selectedRunId) {
      setAssumptions(runs === null ? null : []);
      return;
    }
    api
      .get<AssumptionRow[]>(`/api/assumptions?run_id=${encodeURIComponent(selectedRunId)}`)
      .then((res) => setAssumptions(res.data))
      .catch(() => setAssumptions([]));
  }, [selectedRunId, runs, focusKey]);

  const selectedRun = runs?.find((r) => r.id === selectedRunId) ?? latestRun;

  const [form, setForm] = useState({
    assumption_key: "",
    kind: "user",
    value: "",
    as_of: "",
    rationale: "",
    anchor_ref: "",
    ttl_days: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  async function submitAssumption(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!selectedRunId) {
      setFormError("실행(run)을 먼저 선택하세요.");
      return;
    }
    if (!form.assumption_key.trim()) {
      setFormError("가정 키(assumption_key)는 필수입니다.");
      return;
    }
    setFormBusy(true);
    try {
      await api.post<{ id: string }>(`/api/assumptions`, {
        run_id: selectedRunId,
        assumption_key: form.assumption_key.trim(),
        kind: form.kind,
        value: form.value === "" ? undefined : Number(form.value),
        as_of: form.as_of || undefined,
        rationale: form.rationale || undefined,
        anchor_ref: form.anchor_ref || undefined,
        ttl_days: form.ttl_days === "" ? undefined : Number(form.ttl_days),
      });
      setForm({ assumption_key: "", kind: "user", value: "", as_of: "", rationale: "", anchor_ref: "", ttl_days: "" });
      const res = await api.get<AssumptionRow[]>(`/api/assumptions?run_id=${encodeURIComponent(selectedRunId)}`);
      setAssumptions(res.data);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "가정 등록에 실패했습니다.");
    } finally {
      setFormBusy(false);
    }
  }

  if (runs === null) {
    return <p>불러오는 중...</p>;
  }

  if (!latestRun) {
    return <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 이 프로젝트에 생성된 분석 실행(run)이 없습니다.</p>;
  }


  async function deleteAssumption(id: string) {
    if (!window.confirm("이 가정을 삭제할까요? (감사로그에 기록됩니다)")) return;
    try {
      await api.delete(`/api/assumptions/${encodeURIComponent(id)}`);
      const res = await api.get<AssumptionRow[]>(
        `/api/assumptions?run_id=${encodeURIComponent(selectedRunId ?? "")}`,
      );
      setAssumptions(res.data);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "삭제 실패");
    }
  }

  return (
    <div className="assumptions-tab">
      <p className="assumptions-run-note">
        {runs && runs.length > 0 && (
          <label className="mr-3">
            실행 선택:{" "}
            <select
              value={selectedRunId ?? ""}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className="bg-[color:var(--surface)] border border-[color:var(--border)] rounded px-2 py-1 text-sm"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
        선택된 분석 실행: <strong>{selectedRun?.label}</strong> ({selectedRun ? new Date(selectedRun.created_at).toLocaleString("ko-KR") : "—"})
      </p>
      {focusKey?.trim() && (
        <p className="assumption-focus-note">
          <span aria-hidden="true">◆</span> 실사 항목에서 연결된 가정 키 <strong className="font-mono">{focusKey}</strong> 검색 결과 (전체 실행 대상).{" "}
          {onFocusClear && (
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-[color:var(--accent)] underline cursor-pointer"
              onClick={onFocusClear}
            >
              실행 보기로 돌아가기
            </button>
          )}
        </p>
      )}
      {assumptions === null ? (
        <p>불러오는 중...</p>
      ) : assumptions.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">
          데이터 없음 — {focusKey?.trim() ? "해당 가정 키와 일치하는 행이 없습니다." : "이 실행에 등록된 가정이 없습니다."}
        </p>
      ) : (
        <table className="data-table assumptions-table">
          <caption className="sr-only">가정 목록</caption>
          <thead>
            <tr>
              <th scope="col">가정 키</th>
              <th scope="col">종류</th>
              <th scope="col">값</th>
              <th scope="col">제공 시점</th>
              <th scope="col">유효기간(일)</th>
              <th scope="col">근거</th>
            </tr>
          </thead>
          <tbody>
            {assumptions.map((a) => {
              const meta = kindMeta(a.kind);
              const provenance = { assumption_key: a.assumption_key, as_of: a.as_of, anchor_ref: a.anchor_ref ?? undefined };
              return (
                <tr key={a.id}>
                  <td>{a.assumption_key}</td>
                  <td>
                    <span className={`kind-chip ${meta.className}`}>{meta.label}</span>
                  </td>
                  <td>
                    <SourceTooltip provenance={provenance}>{a.value}</SourceTooltip>
                  </td>
                  <td>{new Date(a.as_of).toLocaleDateString("ko-KR")}</td>
                  <td>{a.ttl_days ?? "—"}</td>
                  <td>
                    <button type="button" className="btn-ghost" onClick={() => deleteAssumption(a.id)}>
                      삭제
                    </button>
                  </td>
                  <td>
                    {a.kind === "assumed" ? (
                      a.rationale?.trim() ? (
                        <p className="assumption-rationale">
                          <GlossaryText text={a.rationale.trim()} />
                        </p>
                      ) : (
                        <p className="assumption-rationale">근거 미기재</p>
                      )
                    ) : a.rationale?.trim() ? (
                      <GlossaryText text={a.rationale.trim()} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <form className="assumption-form mt-6" onSubmit={submitAssumption} aria-label="가정 추가">
        <h3>가정 추가</h3>
        <div className="form-grid">
          <label>
            가정 키 *
            <input
              type="text"
              value={form.assumption_key}
              onChange={(e) => setForm({ ...form, assumption_key: e.target.value })}
              required
            />
          </label>
          <label>
            종류
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="live">실시간</option>
              <option value="user">사용자 입력</option>
              <option value="derived">파생값</option>
              <option value="assumed">가정값</option>
            </select>
          </label>
          <label>
            값
            <input
              type="number"
              step="any"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
            />
          </label>
          <label>
            제공 시점
            <input
              type="date"
              value={form.as_of}
              onChange={(e) => setForm({ ...form, as_of: e.target.value })}
            />
          </label>
          <label>
            유효기간(일)
            <input
              type="number"
              value={form.ttl_days}
              onChange={(e) => setForm({ ...form, ttl_days: e.target.value })}
            />
          </label>
          <label>
            anchor_ref
            <input
              type="text"
              value={form.anchor_ref}
              onChange={(e) => setForm({ ...form, anchor_ref: e.target.value })}
            />
          </label>
        </div>
        <label className="block mt-2">
          근거 (rationale)
          <textarea
            value={form.rationale}
            onChange={(e) => setForm({ ...form, rationale: e.target.value })}
            rows={2}
          />
        </label>
        {formError && <p className="form-error mt-2">{formError}</p>}
        <button type="submit" className="btn-primary mt-2" disabled={formBusy}>
          {formBusy ? "등록 중..." : "가정 등록"}
        </button>
      </form>
    </div>
  );
}
