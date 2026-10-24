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
import { useTranslations } from "next-intl";

interface Row {
  id: string;
  capability: string;
  necessity: string;
  requiredNote: string;
  verdict: { rowId: string; capability: string; coverage: CapabilityDdCoverage; note: string; by: string; at: string } | null;
}

export function CapabilityDdTab({ projectId }: { projectId: string }) {const t = useTranslations("stages.s9.capabilityDdTab"); const tc = useTranslations("common");
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
      setError(e instanceof Error ? e.message : t("failedToLoadTheRequired"));
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function save(row: Row) {
    const d = drafts[row.id];
    if (!d?.coverage) { setError(t("selectAJudgementResolvedPartially")); return; }
    setBusyRow(row.id);
    setError(null);
    setNotice(null);
    try {
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/capability-dd`, {
        row_id: row.id, coverage: d.coverage, note: d.note,
      });
      setNotice(t("p1JudgementRecorded", { p1: row.capability }));
      await load();
      setDrafts((cur) => { const n = { ...cur }; delete n[row.id]; return n; });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToSaveTheJudgement"));
    } finally {
      setBusyRow(null);
    }
  }

  if (error && !rows) return <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {error}</p>;
  if (!rows) return <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("loadingEllipsis")}</p>;
  if (rows.length === 0) {
    return <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noRequiredCapabilitiesDerivedFrom")}</p>;
  }
  const pending = rows.filter((r) => !r.verdict && !drafts[r.id]).length;

  return (
    <section className="market-section sizing-step mt-3" aria-label={t("requiredCapabilityVerification")} data-testid="capability-dd">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("requiredCapabilityVerification2")}</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {t("greenfieldVerifiesRequiredCapabilitiesAt")}{" "}
        {t("whetherItActuallyFillsThe")} <b>{t("judgedInS9DueDiligence")}</b>{t("alsoCheckWhetherTheUnresolved")}
        {pending > 0 && <span className="status-chip status-amber ml-1">{tc("unjudged")} {pending}{tc("countUnit")}</span>}
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}
      <div className="table-scroll" role="region" aria-label={t("requiredCapabilityJudgementTable")} tabIndex={0}>
        <table className="data-table dd-table" aria-label={t("requiredCapabilityJudgement")}>
          <caption className="sr-only">{t("requiredCapabilityJudgementS3Register")}</caption>
          <thead>
            <tr>
              <th scope="col">{tc("requiredCapability")}</th>
              <th scope="col">{t("requiredLevelSummary")}</th>
              <th scope="col">{tc("judgement")}</th>
              <th scope="col">{t("evidenceNote")}</th>
              <th scope="col">{tc("record")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = drafts[r.id];
              const effCoverage = d?.coverage || (r.verdict?.coverage as CapabilityDdCoverage | undefined) || "";
              return (
                <tr key={r.id}>
                  <td data-label={tc("requiredCapability")} className="font-semibold">{r.capability}</td>
                  <td data-label={tc("requiredLevel")} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{r.requiredNote || "—"}</td>
                  <td data-label={tc("judgement")}>
                    {r.verdict && !d ? (
                      <>
                        <span className={`status-chip ${r.verdict.coverage === "resolved" ? "status-green" : r.verdict.coverage === "partial" ? "status-amber" : "status-red"}`}>
                          {CAPABILITY_DD_COVERAGE_KO[r.verdict.coverage]}
                        </span>
                        <button type="button" className="btn-ghost btn-sm ml-1" onClick={() => setDrafts((cur) => ({ ...cur, [r.id]: { coverage: r.verdict!.coverage, note: r.verdict!.note ?? "" } }))}>
                          {t("judgeAgain")}
                        </button>
                      </>
                    ) : (
                      <select
                        aria-label={t("p1Judgement", { p1: r.capability })}
                        className="sizing-new-input sizing-new-input-sm"
                        value={d?.coverage ?? ""}
                        onChange={(e) => setDrafts((cur) => ({ ...cur, [r.id]: { coverage: e.target.value as CapabilityDdCoverage | "", note: cur[r.id]?.note ?? r.verdict?.note ?? "" } }))}
                      >
                        <option value="" disabled>{t("selectJudgement")}</option>
                        {CAPABILITY_DD_COVERAGES.map((c) => <option key={c} value={c}>{CAPABILITY_DD_COVERAGE_KO[c]}</option>)}
                      </select>
                    )}
                    {r.verdict && !d && (
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                        {r.verdict.by} · {r.verdict.at.slice(0, 10)}{r.verdict.note && ` — ${r.verdict.note}`}
                      </span>
                    )}
                  </td>
                  <td data-label={t("evidenceNote")}>
                    <input
                      aria-label={t("p1EvidenceNote", { p1: r.capability })}
                      className="sizing-new-input sizing-new-input-sm w-full"
                      value={d?.note ?? r.verdict?.note ?? ""}
                      onChange={(e) => setDrafts((cur) => ({ ...cur, [r.id]: { coverage: (cur[r.id]?.coverage || (r.verdict?.coverage as CapabilityDdCoverage | undefined) || "") as CapabilityDdCoverage | "", note: e.target.value } }))}
                    />
                  </td>
                  <td data-label={tc("record")}>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busyRow === r.id}
                      aria-disabled={busyRow === r.id || !d?.coverage ? true : undefined}
                      title={!d?.coverage ? t("selectAJudgementResolvedPartially2") : undefined}
                      onClick={() => { if (!d?.coverage) return; void save(r); }}
                    >
                      {busyRow === r.id ? tc("recording") : t("judgementRecord")}
                    </button>
                    {effCoverage === "" && (
                      // disabled 대신 aria-disabled — 버튼이 포커스 가능하게 남아
                      // 무엇이 빠졌는지 힌트에 키보드로 도달할 수 있다.
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("selectAJudgementFirst")}</span>
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
