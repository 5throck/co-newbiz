"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { GateDecisionPanel } from "../../components/GateDecisionPanel.tsx";
import { CommitteePanel } from "../../components/CommitteePanel.tsx";
import { useConfirm } from "../../components/crud.tsx";

// S4 진출방식 결정 (/route-decision) — selected 기회에 Greenfield/Brownfield 트랙과
// 라우트 유형을 기록하는 분기점 (flow.spec v2.0.0).
// Greenfield → S5 역량 평가·진출전략 / Brownfield → S6 대상 후보 발굴 → S7 대상 스크리닝.
// 채점: 2단계 프레임워크 (2026-08-24 Class-C 결정 (d) / ADR-0052) —
// Stage 1 의도 분기(integration | capability_access) → Stage 2 5기준 × 20% × 1–3점,
// 사전배제(통제 高 + 역량접근 + 라이선스/공동개발 성 라우트 금지), 기본 스테이징 권고.
// 원칙 (경계 #2, CLAUDE.md 2026-09-11 개정): 최종 결정은 사람이 기록하며, 결정
// 화면은 LLM 정보·추천을 적극 제공한다 — 아래 "LLM 추천" 섹션이 그 구현이고,
// 산출물은 제안일 뿐 결정 기록(POST /route-decision)은 사람의 몫이다.

interface OpportunityRow {
  id: string; name: string; market_scope: string | null; value_chain_node: string | null;
  attractiveness_score: number | null; synergy_score: number | null;
  fit_verdict: "Go" | "Hold" | "Kill" | null; fit_rationale: string | null;
  rationale: string | null; synergy_rationale: string | null;
  market_size_krw_m: number | null; growth_rate: number | null;
  status: "identified" | "assessed" | "selected" | "dropped";
}
interface CommitteeSessionRow {
  sessionId: string; status: string; decisionMode: string | null; createdAt: string;
}
interface ScoreRow { criterion: string; score: number; evidence_note: string }
// 트랙 권고 어드바이저 (ADR-0104) — 결정론적 산출물. 권고는 참고일 뿐이며
// 결정 기록은 아래 폼의 인간 행위다 (경계 #2).
interface AdvisorySignal { key: string; label: string; leans: "greenfield" | "brownfield" | "neutral"; weight: number; note: string }
interface TrackAdvisory {
  recommendedTrack: "greenfield" | "brownfield" | "neutral";
  greenfieldScore: number;
  brownfieldScore: number;
  signals: AdvisorySignal[];
  baseRates: Array<{ track: string; decisions: number; with_entity_ic_go: number }>;
  reReviewTriggers: string[];
}
interface RouteDecision {
  id: string; track: "greenfield" | "brownfield"; sub_track: string | null;
  rationale: string; alternatives_considered: string | null; decided_by: string; decided_at: string;
  intent: string | null; override_flagged: number | null; staging_recommended: string | null;
  total_score: number | null; scores: ScoreRow[];
}
// LLM 추천 (결정 지원) — POST /api/opportunities/[id]/route-recommendation 응답.
// 제안일 뿐이며 source("llm"|"synthesis")로 출처를 화면에 명시한다.
interface RecoScore { criterion: string; score: number; evidence_note: string }
interface RouteRecommendation {
  source: "llm" | "synthesis";
  provider: string | null;
  note: string | null;
  recommendation: {
    track: "greenfield" | "brownfield";
    sub_track: string | null;
    intent: string | null;
    confidence: string | null;
    scores: RecoScore[] | null;
    rationale_draft: string;
    alternatives_draft: string | null;
    key_evidence: string[];
    cautions: string[];
  };
}

const GF_SUB: Record<string, string> = {
  existing_business_rbd: "기존 사업 R&BD 확장",
  intra_venture: "사내벤처(CVC)",
};
const BF_SUB: Record<string, string> = {
  m_and_a: "M&A",
  jv: "JV(합작)",
  strategic_investment: "전략적 투자",
  minority_investment: "소수지분 투자",
  partnership: "파트너십",
  rbd: "R&BD(공동연구)",
  corporate_venture: "사내벤처(CVC)",
};
const INTENT_LABEL: Record<string, string> = {
  integration: "통합 의도 — 대상을 우리 안으로 (M&A 중심)",
  capability_access: "역량접근 의도 — 대상의 역량을 빌려 쓴다 (JV·소수지분·파트너십 등)",
};
// LLM 추천 표시용 축약 라벨
const INTENT_SHORT: Record<string, string> = { integration: "통합 의도", capability_access: "역량접근 의도" };
const CONFIDENCE_LABEL: Record<string, string> = { high: "확신도 높음", medium: "확신도 중간", low: "확신도 낮음" };
// Stage 2 채점 기준 (각 20% × 1–3점)
const CRITERIA: Array<{ key: string; label: string; hint: string }> = [
  { key: "control_need", label: "통제 필요도", hint: "1=성과만 공유돼도 충분 ~ 3=운영 통제 없으면 위험" },
  { key: "capability_criticality", label: "역량 결정성", hint: "1=대체 가능 ~ 3=암묵적 지식·대체 불가" },
  { key: "market_uncertainty", label: "시장 불확실성", hint: "1=수요 검증됨 ~ 3=수요·규제 불확실" },
  { key: "integration_capacity", label: "통합 역량", hint: "1=통합 경험·여력 충분 ~ 3=통합 수용력 부족" },
  { key: "speed_to_capability", label: "역량확보 속도", hint: "1=천천히 구축 가능 ~ 3=즉시 확보 필요" },
];
const SCORE_LABEL: Record<number, string> = { 1: "낮음", 2: "중간", 3: "높음" };
// 사전배제 대상 라우트 — 통제 필요도=高 + 역량접근 의도에서 선택 불가
const OVERRIDDEN_SUBS = ["partnership", "rbd", "corporate_venture"];

export function RouteDecisionView() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [selected, setSelected] = useState<OpportunityRow | null>(null);
  const [decisions, setDecisions] = useState<RouteDecision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<"greenfield" | "brownfield">("greenfield");
  const [intent, setIntent] = useState<"" | "integration" | "capability_access">("");
  const [subTrack, setSubTrack] = useState("");
  const [rationale, setRationale] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [scores, setScores] = useState<Record<string, { score: number | null; note: string }>>({});
  const [advisory, setAdvisory] = useState<TrackAdvisory | null>(null);
  const [sessions, setSessions] = useState<Array<{ sessionId: string; status: string; decisionMode: string | null; createdAt: string }>>([]);
  const [saving, setSaving] = useState(false);
  // LLM 추천 (결정 지원) — 기회가 바뀌면 초기화한다.
  const [reco, setReco] = useState<RouteRecommendation | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const selectedId = searchParams.get("opportunity");
  const rationaleParam = searchParams.get("rationale");

  const loadRows = useCallback(() => {
    api.get<OpportunityRow[]>("/api/opportunities").then((r) => {
      setRows(r.data.filter((o) => o.status === "selected"));
    }).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const loadDecisions = useCallback((id: string) => {
    api.get<{ decisions: RouteDecision[] }>(`/api/opportunities/${encodeURIComponent(id)}/route-decision`)
      .then((r) => setDecisions(r.data.decisions))
      .catch((e) => setError(e instanceof Error ? e.message : "결정 이력 불러오기 실패"));
  }, []);

  // 트랙 권고 어드바이저 — 읽기 전용 참고 자료. 실패해도 결정 폼은 막지 않는다.
  const loadSessions = useCallback((id: string) => {
    api.get<Array<{ sessionId: string; status: string; decisionMode: string | null; createdAt: string }>>(`/api/opportunities/${encodeURIComponent(id)}/committee-sessions`)
      .then((r) => setSessions(r.data)).catch(() => setSessions([]));
  }, []);
  const loadAdvisory = useCallback((id: string) => {
    api.get<TrackAdvisory>(`/api/opportunities/${encodeURIComponent(id)}/route-advisory`)
      .then((r) => setAdvisory(r.data))
      .catch(() => setAdvisory(null));
  }, []);

  useEffect(() => { loadRows(); }, [loadRows]);

  useEffect(() => {
    if (!selectedId || rows === null) return;
    const found = rows.find((o) => o.id === selectedId) ?? null;
    setSelected(found);
    if (found) { loadDecisions(found.id); loadAdvisory(found.id); }
  }, [selectedId, rows, loadDecisions, loadAdvisory]);

  // S3 Short List handoff — pre-fill the rationale textarea from ?rationale=
  // once, as an editable starting point (not a locked value). Only applies
  // when the target opportunity is actually pre-selected.
  useEffect(() => {
    if (!selectedId || !rationaleParam) return;
    setRationale(rationaleParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, rationaleParam]);

  const openOpportunity = useCallback((o: OpportunityRow) => {
    window.history.replaceState(null, "", `/route-decision?opportunity=${encodeURIComponent(o.id)}`);
    setSelected(o);
    loadDecisions(o.id);
    loadAdvisory(o.id);
  }, [loadDecisions, loadAdvisory]);

  // 기회 전환 시 LLM 추천도 초기화 — 추천은 "선택된 기회" 전용 제안이다.
  useEffect(() => { setReco(null); setRecoError(null); }, [selected?.id]);

  const generateRecommendation = useCallback(async () => {
    if (!selected || recoLoading) return;
    setRecoLoading(true); setRecoError(null);
    try {
      const r = await api.post<RouteRecommendation>(`/api/opportunities/${encodeURIComponent(selected.id)}/route-recommendation`, {});
      setReco(r.data);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : "LLM 추천 생성 실패");
    } finally {
      setRecoLoading(false);
    }
  }, [selected, recoLoading]);

  // 추천 → 결정 폼 반영. 폼 채움일 뿐이며 기록은 결정 폼의 '결정 저장'(사람)이 한다.
  // 추천이 값을 내지 않은 필드(채점 초안 부재 등)는 기존 입력을 건드리지 않는다.
  function applyRecommendation() {
    if (!reco) return;
    const r = reco.recommendation;
    setTrack(r.track);
    if (r.intent) setIntent(r.intent as "integration" | "capability_access");
    if (r.sub_track) setSubTrack(r.sub_track);
    if (r.scores) {
      const next: Record<string, { score: number | null; note: string }> = {};
      for (const s of r.scores) next[s.criterion] = { score: s.score, note: s.evidence_note };
      setScores(next);
    }
    if (r.rationale_draft) setRationale(r.rationale_draft);
    if (r.alternatives_draft) setAlternatives(r.alternatives_draft);
    document.getElementById("route-form")?.scrollIntoView({ behavior: "smooth" });
  }

  function setScore(key: string, patch: Partial<{ score: number | null; note: string }>) {
    setScores((prev) => ({ ...prev, [key]: { score: prev[key]?.score ?? null, note: prev[key]?.note ?? "", ...patch } }));
  }

  const scored = CRITERIA.map((c) => ({ ...c, ...scores[c.key] ?? { score: null, note: "" } }));
  const allScored = scored.every((s) => s.score !== null && s.note.trim() !== "");
  const totalScore = allScored ? Math.round(scored.reduce((sum, s) => sum + (s.score ?? 0) * 0.2, 0) * 100) / 100 : null;
  // 사전배제: 통제 필요도=高 + 역량접근 + 라이선스/공동개발 성 라우트
  const overrideBlocked =
    track === "brownfield" && intent === "capability_access" &&
    scored.find((s) => s.key === "control_need")?.score === 3 &&
    subTrack !== "" && OVERRIDDEN_SUBS.includes(subTrack);
  // 기본 스테이징 권고: 시장 불확실성=高 + 통제 필요도=中 이하
  const stagingHint =
    track === "brownfield" && allScored &&
    scored.find((s) => s.key === "market_uncertainty")?.score === 3 &&
    (scored.find((s) => s.key === "control_need")?.score ?? 3) <= 2;
  // Brownfield 채점 의무 — 스펙 completionCriteria 강제 (Greenfield는 선택).
  const scoresRequired = track === "brownfield";
  const canSubmit =
    rationale.trim() !== "" &&
    (track === "greenfield" || (intent !== "" && allScored && !overrideBlocked)) &&
    (track === "brownfield" ? subTrack !== "" : true);

  function resetForm() {
    setIntent(""); setSubTrack(""); setRationale(""); setAlternatives(""); setScores({});
  }

  async function saveDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || saving) return;
    setSaving(true); setError(null);
    try {
      await api.post(`/api/opportunities/${selected.id}/route-decision`, {
        track,
        sub_track: subTrack || undefined,
        rationale,
        alternatives_considered: alternatives || undefined,
        intent: intent || undefined,
        // 5기준 채점 — Brownfield는 필수(spec completionCriteria), Greenfield는
        // 완료 시 함께 전송한다 (API는 양 트랙 모두 수용 — ADR-0104).
        scores: allScored ? scored.map((s) => ({ criterion: s.key, score: s.score, evidence_note: s.note })) : undefined,
      });
      resetForm();
      loadDecisions(selected.id);
    loadSessions(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "결정 저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const subs = track === "greenfield" ? GF_SUB : BF_SUB;

  return (
    <main>
      <StageFrame stageId="S4">
        선별된 기회의 진출방식을 결정하는 분기점입니다.
        Greenfield(자체 역량 진출)는 S5 역량 평가로, Brownfield(기존 기업·자산 결합)는
        S6 대상 후보 발굴로 진행됩니다. Brownfield ≠ M&A — 라우트 유형을 함께 선택합니다.
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── 선별된 기회 (칩) ── */}
      <section aria-label="선별된 기회" className="market-section">
        <SectionToolbar title="선별된 기회" icon="🎯" />
        {rows === null ? (
          <p>불러오는 중...</p>
        ) : rows.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
            선별(selected)된 기회가 없습니다 — <Link href="/opportunities?status=assessed" className="text-[color:var(--accent)] underline not-italic">기회 발굴</Link>에서
            시너지·적합성 평가(S3)를 마친 기회를 선별하면 여기 표시됩니다.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {rows.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={selected?.id === o.id}
                  className={`sizing-industry-chip ${selected?.id === o.id ? "sizing-industry-chip-active" : ""}`}
                  onClick={() => openOpportunity(o)}
                >
                  <span className="font-semibold">{o.name}</span>
                  <span className="sizing-chip-meta">매력도 {o.attractiveness_score ?? "—"} · 시너지 {o.synergy_score ?? "—"}</span>
                </button>
              ))}
            </div>
            {/* 선별 → 평가 진행 CTA — 기회 선택 직후 결정 폼으로 이동한다.
                실행 버튼이 아니라 이동이므로 경계 #2(사람 결정)와 무충돌. */}
            {selected ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href="#route-form" className="btn-ghost">▶ 평가 진행 — {selected.name} 진출방식 결정</a>
                <span className="text-[0.75rem] text-[color:var(--muted-fg)]">트랙 권고 확인 후 결정 폼(트랙·라우트·5기준 채점·근거)으로 이동합니다.</span>
              </div>
            ) : (
              <p className="mt-3 mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">기회를 선택하면 결정 근거·트랙 권고 어드바이저·결정 폼이 열립니다.</p>
            )}
          </>
        )}
      </section>

      {/* ── 결정 플로우 가이드 (ADR-0104) ── */}
      <ol aria-label="결정 플로우" className="market-section text-[0.85rem] space-y-1" style={{ paddingLeft: "1.2rem", listStyle: "decimal" }}>
        <li><a href="#evidence" className="text-[color:var(--accent)] underline">기회·근거 확인</a> — 발굴 근거·적합성 판정·시너지 권고를 검토합니다.</li>
        <li><a href="#advisory" className="text-[color:var(--accent)] underline">트랙 권고 검토</a> — 결정론 어드바이저와 <a href="#llm-reco" className="text-[color:var(--accent)] underline">LLM 추천(제안)</a>을 참고합니다.</li>
        <li><a href="#decision" className="text-[color:var(--accent)] underline">위원회 심의 (선택)</a> — 스티어링 위원회 의견이 필요하면 소집합니다.</li>
        <li><a href="#route-form" className="text-[color:var(--accent)] underline">결정 기록</a> — 트랙·라우트·근거를 기록합니다 (사람 결정).</li>
      </ol>

      {/* ── 결정 근거 (선택된 기회의 S1~S3 산출물 요약) ── */}
      {selected && (
        <section id="evidence" aria-label="결정 근거" className="market-section">
          <SectionToolbar title={`${selected.name} — 결정 근거`} icon="📋" />
          <dl className="text-[0.85rem] space-y-1">
            <div><dt className="inline font-semibold mr-1">시장:</dt><dd className="inline">{selected.market_scope ?? "—"}{selected.market_size_krw_m ? ` (규모 ${selected.market_size_krw_m.toLocaleString()} 백만원)` : ""}{selected.growth_rate !== null ? ` · CAGR ${(selected.growth_rate * 100).toFixed(1)}%` : ""}</dd></div>
            <div><dt className="inline font-semibold mr-1">발굴 근거:</dt><dd className="inline">{selected.rationale ?? "—"}</dd></div>
            <div><dt className="inline font-semibold mr-1">적합성 판정:</dt><dd className="inline">{selected.fit_verdict ?? "—"}{selected.fit_rationale ? ` — ${selected.fit_rationale}` : ""}</dd></div>
            <div><dt className="inline font-semibold mr-1">시너지 권고:</dt><dd className="inline">{selected.synergy_score ?? "—"}점{selected.synergy_rationale ? ` — ${selected.synergy_rationale}` : ""}</dd></div>
          </dl>
        </section>
      )}

      {/* ── 트랙 권고 어드바이저 (ADR-0104) — 읽기 전용 참고 자료 ── */}
      {selected && advisory && (
        <section id="advisory" aria-label="트랙 권고 어드바이저" className="market-section">
          <SectionToolbar title={`${selected.name} — 트랙 권고 어드바이저`} icon="🧭" />
          <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
            S1~S3 산출물에서 계산한 결정론적 권고입니다 — 참고 자료일 뿐이며, 결정은 아래 폼에서 사람이 기록합니다 (경계 #2).
          </p>
          <p className="mb-2">
            <span className="text-[0.82rem] mr-2">권고 트랙:</span>
            {advisory.recommendedTrack === "neutral" ? (
              <span className="status-chip status-not-started">중립 (neutral) — 우세 트랙 없음</span>
            ) : (
              <span className={`status-chip ${advisory.recommendedTrack === "brownfield" ? "status-amber" : "status-green"}`}>
                {advisory.recommendedTrack === "brownfield" ? "Brownfield" : "Greenfield"}
              </span>
            )}
          </p>
          <div className="mb-3" style={{ maxWidth: "36rem" }} aria-label="트랙 점수 비교">
            <p className="text-[0.78rem] mb-1">Greenfield <span className="tabular-nums">{advisory.greenfieldScore}</span></p>
            <div role="img" aria-label={`Greenfield 점수 ${advisory.greenfieldScore}/100`} className="mb-2" style={{ background: "var(--muted-fg)", opacity: 0.2, height: "0.5rem", borderRadius: "0.25rem" }}>
              <div style={{ width: `${advisory.greenfieldScore}%`, background: "var(--green-fg)", height: "100%", borderRadius: "0.25rem" }} />
            </div>
            <p className="text-[0.78rem] mb-1">Brownfield <span className="tabular-nums">{advisory.brownfieldScore}</span></p>
            <div role="img" aria-label={`Brownfield 점수 ${advisory.brownfieldScore}/100`} style={{ background: "var(--muted-fg)", opacity: 0.2, height: "0.5rem", borderRadius: "0.25rem" }}>
              <div style={{ width: `${advisory.brownfieldScore}%`, background: "var(--amber-fg, var(--accent))", height: "100%", borderRadius: "0.25rem" }} />
            </div>
          </div>
          <p className="text-[0.82rem] font-semibold mb-1">신호</p>
          <ul className="sizing-note-list mb-3">
            {advisory.signals.map((s) => (
              <li key={s.key}>
                <strong>{s.label}</strong>
                <span className={`status-chip ml-1 ${s.leans === "greenfield" ? "status-green" : s.leans === "brownfield" ? "status-amber" : "status-not-started"}`}>
                  {s.leans === "greenfield" ? "GF 우위" : s.leans === "brownfield" ? "BF 우위" : "중립"}
                </span>
                <span className="ml-1 text-[0.72rem] text-[color:var(--muted-fg)]">가중치 {s.weight}</span>
                <span className="block text-[0.75rem]">{s.note}</span>
              </li>
            ))}
          </ul>
          <p className="text-[0.82rem] font-semibold mb-1">기저율 (base rates)</p>
          <table className="data-table mb-3" aria-label="트랙 기저율">
            <caption className="sr-only">트랙 기저율</caption>
            <thead>
              <tr><th scope="col">트랙</th><th scope="col">과거 결정 수</th><th scope="col">Entity IC GO 동반</th></tr>
            </thead>
            <tbody>
              {advisory.baseRates.map((b) => (
                <tr key={b.track}>
                  <td className="text-[0.8rem]">{b.track}</td>
                  <td className="tabular-nums text-[0.8rem]">{b.decisions}</td>
                  <td className="tabular-nums text-[0.8rem]">{b.with_entity_ic_go}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {advisory.reReviewTriggers.length > 0 && (
            <div role="alert" className="mb-2">
              <p className="text-[0.82rem] text-[color:var(--amber-fg, var(--accent))] font-semibold mb-1">⚠ 재검토 트리거</p>
              <ul className="sizing-note-list">
                {advisory.reReviewTriggers.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── LLM 추천 (결정 지원) — 원칙(경계 #2): 제안은 LLM, 기록은 사람 ── */}
      {selected && (
        <section id="llm-reco" aria-label="LLM 추천 (결정 지원)" className="market-section">
          <SectionToolbar
            title={`${selected.name} — LLM 추천`}
            icon="🤖"
            actions={
              <button type="button" className="btn-ghost btn-sm" disabled={recoLoading} onClick={() => void generateRecommendation()}>
                {recoLoading ? "생성 중..." : reco ? "재생성" : "LLM 추천 생성"}
              </button>
            }
          />
          <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
            원칙 (경계 #2): 최종 결정은 사람이 기록합니다 — 이 섹션은 S1~S3 산출물과 결정론 어드바이저 신호에서 만든 <b>제안</b>이며, 폼에 반영한 뒤 자유롭게 수정할 수 있습니다.
          </p>
          {recoError && <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
          {!reco && !recoLoading && !recoError && (
            <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-0">
              LLM이 권장 트랙·라우트·5기준 채점 초안(점수+근거)과 결정 근거 서술 초안을 작성해 결정 폼 채움을 돕습니다.
            </p>
          )}
          {recoLoading && <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-0">S1~S3 산출물과 어드바이저 신호를 근거로 초안을 작성하는 중...</p>}
          {reco && (
            <>
              <p className="mb-2 flex flex-wrap items-center gap-1">
                <span className={`status-chip ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                  {reco.source === "llm" ? `LLM 제안${reco.provider ? ` · ${reco.provider}` : ""}` : "결정론 폴백"}
                </span>
                <span className={`status-chip ${reco.recommendation.track === "brownfield" ? "status-amber" : "status-green"}`}>
                  {reco.recommendation.track === "brownfield" ? "Brownfield" : "Greenfield"}
                </span>
                {reco.recommendation.sub_track && (
                  <span className="status-chip status-not-started">
                    라우트 제안: {(reco.recommendation.track === "brownfield" ? BF_SUB[reco.recommendation.sub_track] : GF_SUB[reco.recommendation.sub_track]) ?? reco.recommendation.sub_track}
                  </span>
                )}
                {reco.recommendation.intent && (
                  <span className="status-chip status-not-started">의도 제안: {INTENT_SHORT[reco.recommendation.intent] ?? reco.recommendation.intent}</span>
                )}
                {reco.recommendation.confidence && (
                  <span className="text-[0.72rem] text-[color:var(--muted-fg)]">{CONFIDENCE_LABEL[reco.recommendation.confidence] ?? `확신도 ${reco.recommendation.confidence}`}</span>
                )}
              </p>
              {reco.note && <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-2">{reco.note}</p>}
              {reco.recommendation.key_evidence.length > 0 && (
                <>
                  <p className="text-[0.82rem] font-semibold mb-1">핵심 근거</p>
                  <ul className="sizing-note-list mb-3">
                    {reco.recommendation.key_evidence.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </>
              )}
              {reco.recommendation.scores ? (
                <table className="data-table mb-3" aria-label="LLM 채점 초안">
                  <caption className="sr-only">LLM 채점 초안</caption>
                  <thead>
                    <tr><th scope="col">기준</th><th scope="col">제안 점수</th><th scope="col">근거 (제안)</th></tr>
                  </thead>
                  <tbody>
                    {reco.recommendation.scores.map((s) => (
                      <tr key={s.criterion}>
                        <td className="text-[0.8rem]">{CRITERIA.find((c) => c.key === s.criterion)?.label ?? s.criterion}</td>
                        <td className="tabular-nums text-[0.8rem]">{s.score} · {SCORE_LABEL[s.score] ?? ""}</td>
                        <td className="text-[0.75rem]">{s.evidence_note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-3">채점 초안 없음 — 결정 폼에서 직접 채점하세요.</p>
              )}
              {reco.recommendation.rationale_draft && (
                <p className="text-[0.8rem] mb-2"><span className="font-semibold">근거 초안:</span> {reco.recommendation.rationale_draft}</p>
              )}
              {reco.recommendation.alternatives_draft && (
                <p className="text-[0.8rem] mb-2"><span className="font-semibold">대안 검토 초안:</span> {reco.recommendation.alternatives_draft}</p>
              )}
              {reco.recommendation.cautions.length > 0 && (
                <>
                  <p className="text-[0.82rem] text-[color:var(--amber-fg, var(--accent))] font-semibold mb-1">⚠ 유의</p>
                  <ul className="sizing-note-list mb-3">
                    {reco.recommendation.cautions.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </>
              )}
              <div className="flex flex-wrap items-center gap-2 mb-0">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => confirm("LLM 추천을 결정 폼에 반영할까요?", applyRecommendation, {
                    body: "현재 폼의 트랙·라우트·채점·근거 입력을 추천 초안으로 덮어씁니다 — 반영 후에도 자유롭게 수정할 수 있고, 결정은 결정 폼의 '결정 저장'을 누른 사람에게 기록됩니다.",
                    confirmLabel: "반영",
                  })}
                >
                  ▶ 결정 폼에 반영
                </button>
                <span className="text-[0.75rem] text-[color:var(--muted-fg)]">반영은 폼 채움일 뿐입니다 — 최종 기록은 결정 폼의 &quot;결정 저장&quot; (사람 클릭).</span>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── 결정 폼 + 이력 ── */}
      {selected && (
        <section id="route-form" aria-label="진출방식 결정" className="market-section" style={{ scrollMarginTop: "6.5rem" }}>
          <SectionToolbar title={`${selected.name} — 진출방식 결정`} icon="⚖️" />
          <form onSubmit={saveDecision} className="sizing-new-form mb-4">
            <div className="flex flex-wrap items-end gap-3 mb-2">
              <label className="text-[0.78rem]">
                <span className="block mb-1">트랙 *</span>
                <select value={track} onChange={(e) => { setTrack(e.target.value as "greenfield" | "brownfield"); setIntent(""); setSubTrack(""); }} className="sizing-new-input">
                  <option value="greenfield">Greenfield — 자체 역량으로 진출</option>
                  <option value="brownfield">Brownfield — 기존 기업·자산과 결합</option>
                </select>
              </label>
              {track === "brownfield" && (
                <label className="text-[0.78rem]">
                  <span className="block mb-1">라우트 유형 * (Brownfield)</span>
                  <select value={subTrack} onChange={(e) => setSubTrack(e.target.value)} className="sizing-new-input">
                    <option value="">선택...</option>
                    {Object.entries(BF_SUB)
                      .filter(([k]) => !overrideBlocked || !OVERRIDDEN_SUBS.includes(k))
                      .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
              {track === "greenfield" && (
                <label className="text-[0.78rem]">
                  <span className="block mb-1">하위 트랙 (선택)</span>
                  <select value={subTrack} onChange={(e) => setSubTrack(e.target.value)} className="sizing-new-input">
                    <option value="">선택...</option>
                    {Object.entries(GF_SUB).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
            </div>

            {/* ── Stage 1: 의도 분기 ── */}
            {track === "brownfield" && (
              <fieldset className="mb-3">
                <legend className="text-[0.78rem] font-semibold mb-1">Stage 1 — 의도 분기 * (채점에 앞서 결정)</legend>
                <div className="flex flex-wrap gap-2">
                  {(["integration", "capability_access"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={intent === k}
                      className={`sizing-industry-chip ${intent === k ? "sizing-industry-chip-active" : ""}`}
                      onClick={() => setIntent(k)}
                    >
                      <span className="font-semibold">{INTENT_LABEL[k]}</span>
                      <span className="sizing-chip-meta">
                        {k === "integration" ? "라우트: M&A·전략적 투자 중심 — JV·소수지분은 단계적 옵션" : "라우트: JV·소수지분·파트너십 — 통제는 권리 바닥값으로 제한"}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {/* ── Stage 2: 5criteria × 20% × 1–3점 — Brownfield 필수, Greenfield도
                동일 스코어러로 채점해 전송한다 (API 양 트랙 수용 — ADR-0104) ── */}
            {(
              <fieldset className="mb-3">
                <legend className="text-[0.78rem] font-semibold mb-1">
                  Stage 2 — 5criteria 채점 {scoresRequired ? "* (각 20% × 1–3점, 근거 필수)" : "(각 20% × 1–3점 — Greenfield는 선택, 입력 시 함께 기록)"}
                  {totalScore !== null && <span className="ml-2 status-chip status-green">합산 {totalScore} / 3.0</span>}
                </legend>
                <table className="data-table" aria-label="5criteria 채점">
                  <caption className="sr-only">5criteria 채점</caption>
                  <thead>
                    <tr><th scope="col">기준</th><th scope="col">점수</th><th scope="col">근거 *</th></tr>
                  </thead>
                  <tbody>
                    {scored.map((c) => (
                      <tr key={c.key}>
                        <td className="text-[0.8rem]">
                          {c.label}
                          <span className="block text-[0.7rem] text-[color:var(--muted-fg)]">{c.hint}</span>
                        </td>
                        <td>
                          <div role="group" aria-label={`${c.label} 점수`} className="flex gap-1">
                            {[1, 2, 3].map((v) => (
                              <button
                                key={v}
                                type="button"
                                aria-pressed={c.score === v}
                                className={`status-chip ${c.score === v ? "status-green" : "status-not-started"}`}
                                onClick={() => setScore(c.key, { score: v })}
                              >
                                {v} · {SCORE_LABEL[v]}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td>
                          <input
                            value={c.note}
                            onChange={(e) => setScore(c.key, { note: e.target.value })}
                            placeholder="점수의 근거 (S1·S3 산출물 인용)"
                            aria-label={`${c.label} 근거`}
                            className="sizing-new-input sizing-new-input-sm"
                            style={{ width: "100%" }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {overrideBlocked && (
                  <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mt-2 mb-0">
                    사전배제: 통제 필요도=高 + 역량접근 의도에서는 파트너십·R&BD·CVC 라우트를 선택할 수 없습니다 (합산 점수와 무관 — ADR-0052).
                  </p>
                )}
                {stagingHint && (
                  <p className="text-[0.78rem] text-[color:var(--accent)] mt-2 mb-0">
                    스테이징 권고: 시장 불확실성이 高이고 통제 필요도가 中 이하 — 소수지분/공동개발 + 사전 협약된 step-up(call option / ROFR / 전환 트리거)을 권고합니다.
                  </p>
                )}
              </fieldset>
            )}

            <label className="text-[0.78rem] block mb-2">
              <span className="block mb-1">결정 근거 * (S1 시장분석·S3 적합성 판단을 인용 — 채점을 보완하는 서술)</span>
              <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} required className="sizing-new-input" style={{ width: "100%" }} placeholder="예: S3 적합성 평가 Go(시너지 72) — 자사 역량 보유, 시장 성장 지속..." />
            </label>
            <label className="text-[0.78rem] block mb-3">
              <span className="block mb-1">검토한 대안 (선택)</span>
              <textarea value={alternatives} onChange={(e) => setAlternatives(e.target.value)} rows={2} className="sizing-new-input" style={{ width: "100%" }} placeholder="고려했지만 선택하지 않은 트랙·라우트와 사유" />
            </label>
            <button type="submit" className="btn-ghost" disabled={saving || !canSubmit}>
              {saving ? "저장 중..." : "결정 저장"}
            </button>
            {track === "brownfield" && !allScored && (
              <span className="ml-2 text-[0.72rem] text-[color:var(--muted-fg)]">Brownfield 결정에는 5기준 채점(점수+근거)이 필요합니다.</span>
            )}
          </form>

          {decisions.length > 0 && (
            <div>
              <SectionToolbar title="결정 이력 (최신순)" count={decisions.length} />
              <div className="table-scroll">
<table className="data-table report-table" aria-label="진출방식 결정 이력">
                <caption className="sr-only">진출방식 결정 이력</caption>
                <thead>
                  <tr>
                    <th scope="col">트랙</th><th scope="col">라우트</th><th scope="col">의도</th>
                    <th scope="col">채점</th><th scope="col">근거</th><th scope="col">대안</th><th scope="col">결정자/일시</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <span className={`status-chip ${d.track === "brownfield" ? "status-amber" : "status-green"}`}>
                          {d.track === "brownfield" ? "Brownfield" : "Greenfield"}
                        </span>
                      </td>
                      <td className="text-[0.8rem]">{d.sub_track ? (d.track === "brownfield" ? BF_SUB[d.sub_track] ?? d.sub_track : GF_SUB[d.sub_track] ?? d.sub_track) : "—"}</td>
                      <td className="text-[0.75rem]">{d.intent ? (d.intent === "integration" ? "통합" : "역량접근") : "—"}</td>
                      <td className="text-[0.75rem]">
                        {d.total_score !== null ? (
                          <span title={(d.scores ?? []).map((s) => `${s.criterion}: ${s.score} — ${s.evidence_note}`).join("\n")}>
                            <strong className="tabular-nums">{d.total_score}</strong>/3.0
                          </span>
                        ) : "—"}
                        {d.staging_recommended && (
                          <span className="block text-[0.68rem] text-[color:var(--accent)]" title={d.staging_recommended}>step-up 권고</span>
                        )}
                      </td>
                      <td className="text-[0.8rem]">{d.rationale}</td>
                      <td className="text-[0.8rem] text-[color:var(--muted-fg)]">{d.alternatives_considered ?? "—"}</td>
                      <td className="text-[0.75rem] tabular-nums">{d.decided_by} · {d.decided_at.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
</div>
            </div>
          )}
        </section>
      )}
      {selected && sessions.length > 0 && (
        <section id="committee" aria-label="위원회 심의 이력" className="market-section">
          <SectionToolbar title="위원회 심의 이력" icon="🏛" />
          <ul className="text-[0.85rem] space-y-1">
            {sessions.map((s2) => (
              <li key={s2.sessionId}>
                <span className={`status-chip ${s2.status === "done" ? "status-green" : "status-in-progress"}`}>{s2.status}</span>{" "}
                {s2.decisionMode ?? "—"} · {s2.createdAt.slice(0, 10)} ·{" "}
                <a className="text-[color:var(--accent)] underline" href={`/api/opportunities/${encodeURIComponent(selected.id)}/committee-sessions/${s2.sessionId}/minutes`} target="_blank" rel="noreferrer">회의록</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section id="decision" aria-label="결정 기록">
        {selected && (
        <GateDecisionPanel opportunityId={selected.id} gates={["screening", "pre_fs"]} />
        )}
        {/* ADR-0097: route-steering-committee 심의 — 에이전트는 제안, 확정은 인간 */}
        {selected && (
        <CommitteePanel
          opportunityId={selected.id}
          committeeKey="route-steering-committee"
          committeeLabel="S4 진출방식 스티어링 위원회"
          gates={["pre_fs"]}
        />
        )}
      </section>
      {confirmDialog}
    </main>
  );
}

export default function RouteDecisionPage() {
  return (
    <Suspense fallback={null}>
      <RouteDecisionView />
    </Suspense>
  );
}
