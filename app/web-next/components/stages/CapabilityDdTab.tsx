"use client";

// CapabilityDdTab — S9 브라운필드 필요 역량 검증 (capability-dd, 2026-10-19
// decider direction; design 2026-10-19-brownfield-capability-dd-design.md).
// Greenfield는 S5 capability-assessment가 같은 질문에 답한다; 브라운필드는 S5가
// 스킵되므로 S9 실사에서 "이 인수가 S3 필요 역량 격차를 실제로 메우는가"를
// 사람이 판정한다. GET은 S3 등록부 + 기저장 판정을 병합해 주고, 저장(PUT)은
// 사람 전용(analyst+, 경계 #2) — 대상 사이드카에 기록되고 레지스터는 불변.
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { CAPABILITY_DD_COVERAGES, CAPABILITY_DD_COVERAGE_KO, type CapabilityDdCoverage } from "../../lib/capability-dd.ts";

interface Row {
  id: string;
  capability: string;
  necessity: string;
  requiredNote: string;
  verdict: { rowId: string; capability: string; coverage: CapabilityDdCoverage; note: string; by: string; at: string } | null;
}

export function CapabilityDdTab({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  // draft state per row id: coverage + note (the saved verdict shows once stored)
  const [drafts, setDrafts] = useState<Record<string, { coverage: CapabilityDdCoverage | ""; note: string }>>({});

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ rows: Row[]; pending: number }>(`/api/projects/${encodeURIComponent(projectId)}/capability-dd`);
      setRows(r.data.rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "필요 역량 등록부를 불러오지 못했습니다.");
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function save(row: Row) {
    const d = drafts[row.id];
    if (!d?.coverage) { setError("판정(해소/부분 해소/미해소)을 먼저 선택하세요."); return; }
    setBusyRow(row.id);
    setError(null);
    setNotice(null);
    try {
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/capability-dd`, {
        row_id: row.id, coverage: d.coverage, note: d.note,
      });
      setNotice(`${row.capability}: 판정을 기록했습니다.`);
      await load();
      setDrafts((cur) => { const n = { ...cur }; delete n[row.id]; return n; });
    } catch (e) {
      setError(e instanceof Error ? e.message : "판정 저장에 실패했습니다.");
    } finally {
      setBusyRow(null);
    }
  }

  if (error && !rows) return <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {error}</p>;
  if (!rows) return <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">불러오는 중…</p>;
  if (rows.length === 0) {
    return <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">S3 시너지 검토에서 도출된 필요 역량이 없습니다 — 판정할 항목이 없습니다.</p>;
  }
  const pending = rows.filter((r) => !r.verdict && !drafts[r.id]).length;

  return (
    <section className="market-section sizing-step mt-3" aria-label="필요 역량 검증" data-testid="capability-dd">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">필요 역량 검증 (capability-dd)</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        그린필드는 S5 자체 진출 단계에서 필요 역량을 검증합니다 — 브라운필드는 이 인수가 S3 필요 역량 격차를{" "}
        실제로 메우는지 <b>S9 실사에서 판정</b>합니다. 미해소분의 해소 비용이 채택 케이스 비용에 반영되었는지도 확인하세요
        (교차검증 경고는 다음 슬라이스). 판정 기록은 사람만 합니다 (경계 #2).
        {pending > 0 && <span className="status-chip status-amber ml-1">미판정 {pending}건</span>}
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}
      <div className="table-scroll" role="region" aria-label="필요 역량 판정 표" tabIndex={0}>
        <table className="data-table dd-table" aria-label="필요 역량 판정">
          <caption className="sr-only">필요 역량 판정 (S3 등록부 기준)</caption>
          <thead>
            <tr>
              <th scope="col">필요 역량</th>
              <th scope="col">필요 수준 요약</th>
              <th scope="col">판정</th>
              <th scope="col">근거 노트</th>
              <th scope="col">기록</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = drafts[r.id];
              const effCoverage = d?.coverage || (r.verdict?.coverage as CapabilityDdCoverage | undefined) || "";
              return (
                <tr key={r.id}>
                  <td data-label="필요 역량" className="font-semibold">{r.capability}</td>
                  <td data-label="필요 수준" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{r.requiredNote || "—"}</td>
                  <td data-label="판정">
                    {r.verdict && !d ? (
                      <>
                        <span className={`status-chip ${r.verdict.coverage === "resolved" ? "status-green" : r.verdict.coverage === "partial" ? "status-amber" : "status-red"}`}>
                          {CAPABILITY_DD_COVERAGE_KO[r.verdict.coverage]}
                        </span>
                        <button type="button" className="btn-ghost btn-sm ml-1" onClick={() => setDrafts((cur) => ({ ...cur, [r.id]: { coverage: r.verdict!.coverage, note: r.verdict!.note ?? "" } }))}>
                          다시 판정
                        </button>
                      </>
                    ) : (
                      <select
                        aria-label={`${r.capability} 판정`}
                        className="sizing-new-input sizing-new-input-sm"
                        value={d?.coverage ?? ""}
                        onChange={(e) => setDrafts((cur) => ({ ...cur, [r.id]: { coverage: e.target.value as CapabilityDdCoverage | "", note: cur[r.id]?.note ?? r.verdict?.note ?? "" } }))}
                      >
                        <option value="" disabled>판정 선택</option>
                        {CAPABILITY_DD_COVERAGES.map((c) => <option key={c} value={c}>{CAPABILITY_DD_COVERAGE_KO[c]}</option>)}
                      </select>
                    )}
                    {r.verdict && !d && (
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                        {r.verdict.by} · {r.verdict.at.slice(0, 10)}{r.verdict.note && ` — ${r.verdict.note}`}
                      </span>
                    )}
                  </td>
                  <td data-label="근거 노트">
                    <input
                      aria-label={`${r.capability} 근거 노트`}
                      className="sizing-new-input sizing-new-input-sm w-full"
                      value={d?.note ?? r.verdict?.note ?? ""}
                      onChange={(e) => setDrafts((cur) => ({ ...cur, [r.id]: { coverage: (cur[r.id]?.coverage || (r.verdict?.coverage as CapabilityDdCoverage | undefined) || "") as CapabilityDdCoverage | "", note: e.target.value } }))}
                    />
                  </td>
                  <td data-label="기록">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busyRow === r.id}
                      aria-disabled={busyRow === r.id || !d?.coverage ? true : undefined}
                      title={!d?.coverage ? "판정(해소/부분 해소/미해소)을 먼저 선택하세요" : undefined}
                      onClick={() => { if (!d?.coverage) return; void save(r); }}
                    >
                      {busyRow === r.id ? "기록 중..." : "판정 기록"}
                    </button>
                    {effCoverage === "" && (
                      // disabled 대신 aria-disabled — 버튼이 포커스 가능하게 남아
                      // 무엇이 빠졌는지 힌트에 키보드로 도달할 수 있다.
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">판정을 먼저 선택하세요</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
