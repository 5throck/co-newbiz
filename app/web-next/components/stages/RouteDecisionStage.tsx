"use client";

// S4 진출방식 결정 — 목업 v5 baseline(docs/designs/mockups/baseline-v5.html
// id="s4") 구조로 재작성. /deals/[id]/s4에 마운트되며 opportunityId는 URL의
// [id]로 고정된다(목업처럼 검토/안건 하나를 바로 보여준다 — 전역 기회 선택 칩 없음).
//
// 로직은 기존 /route-decision 화면(flow.spec v2.0.0, ADR-0052/0086/0104/0097)
// 그대로 유지한다 — 이 재작성은 시각 언어(.card/.control-chip)와 스코프(단일
// 검토/안건)만 목업에 맞춘다. 원칙(경계 #2, CLAUDE.md 2026-09-11 개정): 최종 결정은
// 사람이 기록하며, 화면은 LLM 정보·추천을 적극 제공한다 — "LLM 추천" 섹션이
// 그 구현이고, 산출물은 제안일 뿐 결정 기록(POST /route-decision)은 사람의 몫.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../lib/project-write-access.ts";
import { SectionToolbar } from "../layout.tsx";
import { CommitteePanel } from "../CommitteePanel.tsx";
import { Tabs } from "../ui.tsx";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { useConfirm } from "../crud.tsx";

// flow.spec v2.4.0 — 결정론 어드바이저(ADR-0104) + S1 시장·경쟁·역량 근거.
// GET /api/opportunities/{id}/route-advisory 응답. 권고·신호는 제안이며 결정
// 기록은 사람의 행위다(경계 #2).
interface AdvisorySignalView { key: string; label: string; leans: "greenfield" | "brownfield" | "neutral"; weight: number; note: string }
interface AdvisoryResponse {
  recommendedTrack: "greenfield" | "brownfield" | "neutral";
  greenfieldScore: number;
  brownfieldScore: number;
  signals: AdvisorySignalView[];
  reReviewTriggers: string[];
  s1Evidence: {
    industryName: string; versionNo: number | null;
    marketSizeUsdB: number | null; cagr: number | null;
    competitive: { structure: string; players: Array<{ name: string; tier: string; note: string }> } | null;
  } | null;
  capabilityGap: {
    total: number; evaluated: number; met: number; partial: number; unmet: number;
    coveragePct: number | null;
    unmetRows: Array<{ capability: string; resolution: string | null }>;
    // S3에서 확정한 필요 역량 수준 전체 행 (역량 관련 5기준 채점 근거)
    rows?: Array<{
      capability: string;
      source: string;
      held: { status: string; holders: string[]; evidence: string };
      resolution: string | null;
    }>;
  } | null;
}

interface OpportunityRow {
  id: string; name: string; market_scope: string | null; value_chain_node: string | null;
  attractiveness_score: number | null; synergy_score: number | null;
  rationale: string | null; synergy_rationale: string | null;
  market_size_krw_m: number | null; growth_rate: number | null;
  status: "identified" | "assessed" | "selected" | "dropped";
  project_id: string | null;
  deleted_at: string | null;
}
interface ScoreRow { criterion: string; score: number; evidence_note: string }
interface RouteDecision {
  id: string; track: "greenfield" | "brownfield"; sub_track: string | null;
  rationale: string; alternatives_considered: string | null; decided_by: string; decided_at: string;
  intent: string | null; override_flagged: number | null; staging_recommended: string | null;
  total_score: number | null; scores: ScoreRow[];
  // ADR-0135 — 권위 행 표시. 대체된 결정은 이력에 남되 is_current=0이다.
  is_current: number; superseded_by: string | null;
}
// ADR-0124 — 열린 초안(status='draft'). 완결성 검증이 없어 필드가 비어있을 수 있다.
interface RouteDecisionDraft {
  id: string; track: "greenfield" | "brownfield"; sub_track: string | null;
  rationale: string | null; alternatives_considered: string | null; intent: string | null;
  updated_at: string | null; scores: ScoreRow[];
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

export function RouteDecisionStage({ opportunityId, rationaleParam }: { opportunityId: string; rationaleParam?: string | null }) {
  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
  // 2026-09-14 전체 재설계 (docs/designs/mockups/2026-09-14-s4-route-decision-redesign.html
  // 승인 목업) — 탭 3개: 결정(기본) / 평가 근거 / 위원회 심의. 결정 이력은 별도 탭이
  // 아니라 결정 탭 안의 접힘 섹션으로 이동했다. 섹션은 display 토글로 유지(마운트
  // 상태 유지) — 폼 상태가 탭 전환에 영향받지 않는다.
  // 탭 순서 — 근거(경쟁 구조·평가 근거·위원회 심의)를 먼저 보고 결정은 마지막에
  // 한다(2026-09-15 사용자 요구). 기본 탭도 첫 번째(경쟁 구조).
  const [tab, setTab] = useState<"decision" | "competitive" | "eval" | "committee">("competitive");
  // 결정 이력 접힘 섹션 — 결정을 막 저장했을 때만 자동으로 펼쳐 결과를 바로 보여준다.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState<OpportunityRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [decisions, setDecisions] = useState<RouteDecision[]>([]);
  // 결정 이력 년/월 필터 — 케이스가 쌓이면 한 화면에 다 보여주는 대신
  // 연도·월 단위로 좁혀 볼 수 있게 한다. 빈 값("")은 전체.
  const [historyYear, setHistoryYear] = useState("");
  const [historyMonth, setHistoryMonth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<"greenfield" | "brownfield">("greenfield");
  const [intent, setIntent] = useState<"" | "integration" | "capability_access">("");
  const [subTrack, setSubTrack] = useState("");
  const [rationale, setRationale] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [scores, setScores] = useState<Record<string, { score: number | null; note: string }>>({});
  const [sessions, setSessions] = useState<Array<{ sessionId: string; status: string; decisionMode: string | null; createdAt: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  // S1 시장·경쟁·역량 근거 + 결정론 어드바이저 (flow.spec v2.4.0, ADR-0104).
  const [advisory, setAdvisory] = useState<AdvisoryResponse | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const draftLoadedRef = useRef(false);
  // LLM 추천 (결정 지원)
  const [reco, setReco] = useState<RouteRecommendation | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const loadDecisions = useCallback((id: string) => {
    api.get<{ decisions: RouteDecision[]; draft: RouteDecisionDraft | null }>(`/api/opportunities/${encodeURIComponent(id)}/route-decision`)
      .then((r) => {
        setDecisions(r.data.decisions);
        // 폼 초기값 복원 — 열린 초안이 있으면 그것을, 없으면 가장 최근에
        // 기록된 결정을 반영한다(둘 다 없으면 컴포넌트 기본값인 Greenfield가
        // 그대로 남는다 — 실제로는 아무것도 결정된 적 없는 상태에서만 맞는
        // 값이다). 처음 로드될 때 한 번만 반영하고, 이후 사용자 입력을
        // 재조회 때 덮어쓰지 않는다.
        const d = r.data.draft;
        // ADR-0135: "가장 최근" 결정이 아니라 권위 행(is_current=1)을 복원한다.
        const latestFinal = r.data.decisions.find((x) => x.is_current === 1) ?? null;
        if (!draftLoadedRef.current) {
          if (d) {
            setTrack(d.track);
            setSubTrack(d.sub_track ?? "");
            setRationale(d.rationale ?? "");
            setAlternatives(d.alternatives_considered ?? "");
            if (d.intent) setIntent(d.intent as "integration" | "capability_access");
            if (d.scores.length) {
              const next: Record<string, { score: number | null; note: string }> = {};
              for (const s of d.scores) next[s.criterion] = { score: s.score, note: s.evidence_note };
              setScores(next);
            }
            setDraftSavedAt(d.updated_at);
          } else if (latestFinal) {
            setTrack(latestFinal.track);
            setSubTrack(latestFinal.sub_track ?? "");
            if (latestFinal.intent) setIntent(latestFinal.intent as "integration" | "capability_access");
          }
        }
        draftLoadedRef.current = true;
      })
      .catch((e) => setError(e instanceof Error ? e.message : "결정 이력 불러오기 실패"));
  }, []);
  const loadSessions = useCallback((id: string) => {
    api.get<Array<{ sessionId: string; status: string; decisionMode: string | null; createdAt: string }>>(`/api/opportunities/${encodeURIComponent(id)}/committee-sessions`)
      .then((r) => setSessions(r.data)).catch(() => setSessions([]));
  }, []);
  // 검토/안건은 URL로 고정된다 — 목업처럼 선택 칩 없이 바로 이 기회를 로드한다.
  // 단건 조회(GET /api/opportunities/{id})는 목록 조회와 달리 삭제 표시된
  // 행도 그대로 돌려준다 — 프로젝트로 승격된 뒤 원본 기회가 삭제 표시되어도
  // 그 S4 결정 이력은 계속 열람할 수 있어야 한다.
  useEffect(() => {
    let alive = true;
    api.get<OpportunityRow>(`/api/opportunities/${encodeURIComponent(opportunityId)}`).then((r) => {
      if (!alive) return;
      setSelected(r.data);
      setNotFound(false);
      loadDecisions(r.data.id);
      loadSessions(r.data.id);
    }).catch((e) => {
      if (!alive) return;
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true);
      } else {
        setError(e instanceof Error ? e.message : "불러오기 실패");
      }
    });
    return () => { alive = false; };
  }, [opportunityId, loadDecisions, loadSessions]);

  // S1 근거 + 결정론 어드바이저 — 마운트 1회. 실패해도 결정 폼은 동작한다.
  useEffect(() => {
    let alive = true;
    api.get<AdvisoryResponse>(`/api/opportunities/${encodeURIComponent(opportunityId)}/route-advisory`)
      .then((r) => { if (alive) setAdvisory(r.data); })
      .catch(() => { if (alive) setAdvisory(null); });
    return () => { alive = false; };
  }, [opportunityId]);

  // S3 Short List handoff — pre-fill the rationale textarea from ?rationale=
  // once, as an editable starting point (not a locked value).
  useEffect(() => {
    if (!rationaleParam) return;
    setRationale(rationaleParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rationaleParam]);

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
    setTab("decision");
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
  // 채점 의무 — 스펙 v2.2.0+ completionCriteria (ADR-0104 트랙 간 비교 가능성):
  // 양 트랙 모두 intent + 5criteria 채점이 필수다. 검토한 대안도 requiredArtifacts
  // 이므로 최종 "결정"에 필수다 (v2.4.1 정합 — 초안 "저장"은 여전히 자유).
  const canSubmit =
    rationale.trim() !== "" &&
    intent !== "" &&
    allScored &&
    alternatives.trim() !== "" &&
    !overrideBlocked &&
    (track === "brownfield" ? subTrack !== "" : true);

  function resetForm() {
    setIntent(""); setSubTrack(""); setRationale(""); setAlternatives(""); setScores({});
    // 결정 확정 시 서버 쪽 초안 행은 final로 바뀌어 사라진다 — 화면의
    // "초안 저장됨" 표시도 함께 지워야 방금 확정된 것을 초안처럼 보이지 않게 한다.
    setDraftSavedAt(null);
  }

  // 저장 로직 본체 — 의사결정 탭의 <form onSubmit>과 채점 탭의 독립 저장
  // 버튼(폼 밖) 양쪽에서 호출한다. 둘 다 같은 state(track/scores/rationale
  // 등)를 공유하므로 어느 탭에서 눌러도 결과는 동일하다.
  async function performSave() {
    if (!selected || saving) return;
    setSaving(true); setError(null);
    try {
      await api.post(`/api/opportunities/${selected.id}/route-decision`, {
        track,
        sub_track: subTrack || undefined,
        rationale,
        alternatives_considered: alternatives || undefined,
        intent: intent || undefined,
        scores: allScored ? scored.map((s) => ({ criterion: s.key, score: s.score, evidence_note: s.note })) : undefined,
      });
      resetForm();
      loadDecisions(selected.id);
      loadSessions(selected.id);
      setHistoryOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "결정 저장 실패");
    } finally {
      setSaving(false);
    }
  }

  function saveDecision(e: React.FormEvent) {
    e.preventDefault();
    void performSave();
  }

  // ADR-0124 — "저장"(초안). 완결성 검증이 없다: 트랙만 있어도, 채점이
  // 하나도 없어도 저장된다. "결정"(performSave)과 별개의 액션이다.
  async function performSaveDraft() {
    if (!selected || draftSaving) return;
    setDraftSaving(true); setError(null);
    try {
      const r = await api.put<{ updated_at: string }>(`/api/opportunities/${selected.id}/route-decision/draft`, {
        track,
        sub_track: subTrack || undefined,
        rationale: rationale || undefined,
        alternatives_considered: alternatives || undefined,
        intent: intent || undefined,
        scores: scored.map((s) => ({ criterion: s.key, score: s.score, evidence_note: s.note })),
      });
      draftLoadedRef.current = true;
      setDraftSavedAt(r.data.updated_at);
    } catch (err) {
      setError(err instanceof Error ? err.message : "초안 저장 실패");
    } finally {
      setDraftSaving(false);
    }
  }

  if (notFound) {
    return (
      <div className="card">
        <p className="text-[0.85rem] text-[color:var(--muted-fg)]">
          선별(selected)된 기회를 찾을 수 없습니다 — S3 시너지·적합성 평가를 마친 기회만 여기서 진출방식을 결정할 수 있습니다.
        </p>
      </div>
    );
  }
  if (!selected) {
    return <div className="card"><p>불러오는 중...</p></div>;
  }

  const subs = track === "greenfield" ? GF_SUB : BF_SUB;

  return (
    <>
      <ReviewBuckets entityType="opportunity" entityId={opportunityId} artifacts={stageArtifactTabs("S4")} />
      {/* ── 진출방식 추천 — 탭 밖 상시 노출 (2026-09-14 재설계). 예전엔 이 카드와
          "의사결정" 탭 안의 룰 기반 추천이 서로 다른 표면에서 겹치는 얘기를 했다.
          이제 신호(항상 있음) → AI 서술(선택, 신호를 풀어씀) 하나의 위계로 통합한다.
          "제안" 칩은 기존 status-chip 클래스만 재사용 — 새 CSS 없음. ── */}
      {selected && advisory !== null && (() => {
        const trackLabel = advisory.recommendedTrack === "neutral" ? "중립 (신호 부족)" : advisory.recommendedTrack === "greenfield" ? "Greenfield" : "Brownfield";
        const supporting = advisory.signals
          .filter((s) => s.leans === advisory.recommendedTrack)
          .sort((a, b) => b.weight - a.weight);
        const neutralCount = advisory.signals.filter((s) => s.leans === "neutral").length;
        const gfPct = Math.round((advisory.greenfieldScore / Math.max(1, advisory.greenfieldScore + advisory.brownfieldScore)) * 100);
        return (
          <div className="card" id="reco-card">
            <h2 className="flex items-center gap-2">
              진출방식 추천 <span className="status-chip status-not-started">제안</span>
            </h2>
            <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
              원칙 (경계 #2): 최종 결정은 사람이 기록합니다 — 이 카드는 S1~S3 산출물에서 자동으로 만든 <b>제안</b>이며, 아래 &quot;결정&quot; 탭에 반영한 뒤 자유롭게 수정할 수 있습니다.
            </p>
            <p className="text-[0.95rem] mb-0">
              추천: <strong className={advisory.recommendedTrack === "greenfield" ? "text-[color:var(--green-fg)]" : advisory.recommendedTrack === "brownfield" ? "text-[color:var(--amber-fg)]" : undefined}>{trackLabel}</strong>
            </p>
            <div className="route-score-bar" role="img" aria-label={`Greenfield ${advisory.greenfieldScore}점, Brownfield ${advisory.brownfieldScore}점`}>
              <div className="route-score-bar-seg gf" style={{ width: `${gfPct}%` }} />
              <div className="route-score-bar-seg bf" style={{ width: `${100 - gfPct}%` }} />
            </div>
            <div className="route-score-legend mb-2">
              <span>Greenfield <strong className="tabular-nums">{advisory.greenfieldScore}</strong></span>
              <span>Brownfield <strong className="tabular-nums">{advisory.brownfieldScore}</strong></span>
            </div>
            {advisory.recommendedTrack !== "neutral" && (
              <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-1">
                신호 {advisory.signals.length}건 중 {supporting.length}건이 {trackLabel}, {neutralCount}건 중립 (근거 전체는{" "}
                <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setTab("eval")}>평가 근거 탭</button>)
              </p>
            )}
            {advisory.reReviewTriggers.length > 0 && (
              <p className="text-[0.75rem] text-[color:var(--amber-fg)] mb-2">점검: {advisory.reReviewTriggers.join(" / ")}</p>
            )}
            {supporting.length > 0 ? (
              <ul className="sizing-note-list mb-2">
                {supporting.map((s) => <li key={s.key}>{s.label} — {s.note}</li>)}
              </ul>
            ) : (
              <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">신호가 뚜렷한 방향을 가리키지 않습니다.</p>
            )}

            {/* AI 서술 초안 — 신호 요약을 문장으로 확장한 LLM 초안. 기존 reco 상태 그대로. */}
            <div className="sizing-grade-card mb-3">
              <h4 className="text-[0.85rem] mb-2 flex items-center gap-2">
                AI 서술 초안
                {reco && (
                  <span className="status-chip status-not-started">
                    {reco.source === "llm" ? `제안 · LLM${reco.provider ? ` · ${reco.provider}` : ""}` : "제안 · 결정론 폴백"}
                  </span>
                )}
                {canAct && reco && (
                  <button type="button" className="btn-ghost btn-sm ml-auto" disabled={recoLoading} onClick={() => void generateRecommendation()}>
                    재생성
                  </button>
                )}
              </h4>
              {recoError && <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
              {canAct && !reco && !recoLoading && !recoError && (
                <div className="flex flex-wrap items-center gap-2 mb-0">
                  <button type="button" className="btn-ghost" onClick={() => void generateRecommendation()}>
                    ▶ LLM 추천 생성
                  </button>
                  <span className="text-[0.75rem] text-[color:var(--muted-fg)]">권장 트랙·라우트·5기준 채점 초안(점수+근거)과 결정 근거 서술 초안을 작성해 채움을 돕습니다.</span>
                </div>
              )}
              {recoLoading && <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-0">S1~S3 산출물과 어드바이저 신호를 근거로 초안을 작성하는 중...</p>}
              {reco && (
                <>
                  {reco.note && <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-2">{reco.note}</p>}
                  {reco.recommendation.rationale_draft && (
                    <p className="text-[0.8rem] mb-2"><span className="font-semibold">근거 초안:</span> {reco.recommendation.rationale_draft}</p>
                  )}
                  {reco.recommendation.alternatives_draft && (
                    <p className="text-[0.8rem] mb-2"><span className="font-semibold">대안 검토 초안:</span> {reco.recommendation.alternatives_draft}</p>
                  )}
                  {reco.recommendation.cautions.length > 0 && (
                    <>
                      <p className="text-[0.82rem] text-[color:var(--amber-fg, var(--accent))] font-semibold mb-1">유의</p>
                      <ul className="sizing-note-list mb-0">
                        {reco.recommendation.cautions.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>

            {canAct && reco && (
              <div className="flex flex-wrap items-center gap-2 mb-0">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => confirm("추천을 결정 탭에 반영할까요?", applyRecommendation, {
                    body: "현재 입력한 트랙·라우트·채점·근거를 추천 초안으로 덮어씁니다 — 반영 후에도 자유롭게 수정할 수 있고, 결정은 결정 탭의 '결정' 버튼을 누른 사람에게 기록됩니다.",
                    confirmLabel: "반영",
                  })}
                >
                  결정 탭에 반영
                </button>
                <span className="text-[0.75rem] text-[color:var(--muted-fg)]">반영은 입력값 채움일 뿐입니다 — 최종 기록은 &quot;결정&quot; 탭의 &apos;결정&apos; 버튼 (사람 클릭).</span>
              </div>
            )}
          </div>
        );
      })()}
      {selected && advisory === null && (
        <div className="card" id="reco-card">
          <h2>진출방식 추천</h2>
          <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-0">
            추천을 불러오지 못했습니다 — 새로고침하거나 S1 시장분석·S3 필요 역량 수준을 먼저 완료하세요.
          </p>
        </div>
      )}

      <Tabs
        label="S4 결정 탭"
        active={tab}
        onSelect={(k) => setTab(k as typeof tab)}
        tabs={[
          { key: "competitive", label: "경쟁 구조" },
          { key: "eval", label: "평가 근거" },
          { key: "committee", label: "위원회 심의" },
          { key: "decision", label: "결정" },
        ]}
      />

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── 의사결정 탭: 트랙·라우트·의도 선택 + 근거 + 저장 (채점은 별도 탭) ── */}
      {tab === "decision" && (
        <div className="card">
          <h2>
            {selected.name} — 트랙·라우트 결정{" "}
            <span className={`status-chip ${decisions.length > 0 ? "status-green" : "status-amber"}`}>
              {decisions.length > 0 ? "결정 기록됨" : "결정 대기"}
            </span>
          </h2>
          <div className="route-fact-grid">
            <div className="route-fact-card">
              <span className="route-fact-label">시장</span>
              <span className="route-fact-value">
                {selected.market_scope ?? "—"}
                {selected.market_size_krw_m ? ` (규모 ${selected.market_size_krw_m.toLocaleString()} 백만원)` : ""}
                {selected.growth_rate !== null ? ` · CAGR ${(selected.growth_rate * 100).toFixed(1)}%` : ""}
              </span>
            </div>
            <div className="route-fact-card">
              <span className="route-fact-label">발굴 근거</span>
              <span className="route-fact-value">{selected.rationale ?? "—"}</span>
            </div>
          </div>

          <form id="route-form" onSubmit={saveDecision}>
          <fieldset disabled={!canAct} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="flex flex-wrap items-end gap-4 mb-3">
              <label className="text-[0.8rem]">
                <span className="block mb-1 font-medium">트랙 <span className="text-[color:var(--red-fg)]">*</span></span>
                <select value={track} onChange={(e) => { setTrack(e.target.value as "greenfield" | "brownfield"); setIntent(""); setSubTrack(""); }} className="sizing-new-input">
                  <option value="greenfield">Greenfield — 자체 역량으로 진출</option>
                  <option value="brownfield">Brownfield — 기존 기업·자산과 결합</option>
                </select>
              </label>
              <label className="text-[0.8rem]">
                <span className="block mb-1 font-medium">라우트 {track === "brownfield" ? <><span className="text-[color:var(--red-fg)]">*</span> (Brownfield)</> : "(선택)"}</span>
                <select value={subTrack} onChange={(e) => setSubTrack(e.target.value)} className="sizing-new-input">
                  <option value="">선택...</option>
                  {Object.entries(subs)
                    .filter(([k]) => !overrideBlocked || !OVERRIDDEN_SUBS.includes(k))
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="text-[0.8rem]">
                <span className="block mb-1 font-medium">의도 (Stage 1) <span className="text-[color:var(--red-fg)]">*</span></span>
                <select value={intent} onChange={(e) => setIntent(e.target.value as "" | "integration" | "capability_access")} className="sizing-new-input">
                  <option value="">선택...</option>
                  <option value="integration">통합</option>
                  <option value="capability_access">역량접근</option>
                </select>
              </label>
            </div>
            {overrideBlocked && (
              <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mb-2">
                사전배제: 통제 필요도=高 + 역량접근 의도에서는 파트너십·R&BD·CVC 라우트를 선택할 수 없습니다 (합산 점수와 무관).
              </p>
            )}
            {stagingHint && (
              <p className="text-[0.78rem] text-[color:var(--accent)] mb-2">
                스테이징 권고: 시장 불확실성이 高이고 통제 필요도가 中 이하 — 소수지분/공동개발 + 사전 협약된 step-up(call option / ROFR / 전환 트리거)을 권고합니다.
              </p>
            )}
            <label className="text-[0.78rem] block mb-2">
              <span className="block mb-1">결정 근거 * (S1 시장분석·S3 적합성 판단을 인용 — 채점을 보완하는 서술)</span>
              <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} required className="sizing-new-input" style={{ width: "100%" }} placeholder="예: S3 적합성 평가 Go(시너지 72) — 자사 역량 보유, 시장 성장 지속..." />
            </label>
            <label className="text-[0.78rem] block mb-3">
              <span className="block mb-1">검토한 대안 * (고려했으나 선택하지 않은 트랙·라우트와 사유 — 초안 저장은 선택, 결정은 필수)</span>
              <textarea value={alternatives} onChange={(e) => setAlternatives(e.target.value)} rows={2} required className="sizing-new-input" style={{ width: "100%" }} placeholder="고려했지만 선택하지 않은 트랙·라우트와 사유" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {canAct && (
                <button type="button" className="btn-ghost" disabled={draftSaving} onClick={() => void performSaveDraft()}>
                  {draftSaving ? "저장 중..." : "저장"}
                </button>
              )}
              {canAct && (
                <button type="submit" className="btn-primary" disabled={saving || !canSubmit}>
                  {saving ? "확정 중..." : "결정"}
                </button>
              )}
              <span className="text-[0.75rem] text-[color:var(--muted-fg)]">
                {draftSavedAt && `초안 저장됨 · ${draftSavedAt.slice(0, 16).replace("T", " ")} · `}
                {totalScore !== null ? `합산 ${totalScore} / 3.0 · ` : ""}양 트랙 공통 채점 · 사전배제 검증 자동
                {canAct && !allScored && (
                  <>
                    {" · "}
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setTab("eval")}>평가 근거 탭에서 5기준 완료 →</button>
                  </>
                )}
              </span>
            </div>
            <p className="text-[0.72rem] text-[color:var(--muted-fg)] mt-1 mb-0">
              저장 = 초안을 서버에 보관(완결성 검증 없음) · 결정 = 5기준·근거 완료 후 불변 기록
            </p>
          </fieldset>
          </form>

          {/* ── 결정 이력 — 과거 기록 열람용 참고자료라 기본 접힘(2026-09-14
              재설계). 오늘 결정에 필요한 평가 근거와 달리, 접혀 있어도
              감사성이 훼손되지 않는다. ── */}
          {(() => {
            const years = [...new Set(decisions.map((d) => d.decided_at.slice(0, 4)))].sort().reverse();
            const months = historyYear
              ? [...new Set(decisions.filter((d) => d.decided_at.slice(0, 4) === historyYear).map((d) => d.decided_at.slice(5, 7)))].sort()
              : [];
            const filtered = decisions.filter((d) =>
              (!historyYear || d.decided_at.slice(0, 4) === historyYear) &&
              (!historyMonth || d.decided_at.slice(5, 7) === historyMonth),
            );
            return (
              <details className="sizing-grade-card mt-3" open={historyOpen} onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
                <summary className="cursor-pointer text-[0.85rem] font-semibold">결정 이력 ({decisions.length}건) 보기</summary>
                <div className="mt-2">
                  {decisions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <label className="text-[0.75rem]">
                        <span className="sr-only">연도</span>
                        <select
                          value={historyYear}
                          onChange={(e) => { setHistoryYear(e.target.value); setHistoryMonth(""); }}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="">전체 연도</option>
                          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
                        </select>
                      </label>
                      <label className="text-[0.75rem]">
                        <span className="sr-only">월</span>
                        <select
                          value={historyMonth}
                          onChange={(e) => setHistoryMonth(e.target.value)}
                          disabled={!historyYear}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="">전체 월</option>
                          {months.map((m) => <option key={m} value={m}>{Number(m)}월</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                  {decisions.length === 0 ? (
                    <p className="text-[0.85rem] text-[color:var(--muted-fg)]">아직 기록된 결정이 없습니다.</p>
                  ) : filtered.length === 0 ? (
                    <p className="text-[0.85rem] text-[color:var(--muted-fg)]">선택한 기간에 기록된 결정이 없습니다.</p>
                  ) : (
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
                          {filtered.map((d) => (
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
                  )}
                  {sessions.length > 0 && (
                    <>
                      <SectionToolbar title="위원회 심의 이력" />
                      <ul className="text-[0.85rem] space-y-1">
                        {sessions.map((s2) => (
                          <li key={s2.sessionId}>
                            <span className={`status-chip ${s2.status === "done" ? "status-green" : "status-in-progress"}`}>{s2.status}</span>{" "}
                            {s2.decisionMode ?? "—"} · {s2.createdAt.slice(0, 10)} ·{" "}
                            <a className="text-[color:var(--accent)] underline" href={`/api/opportunities/${encodeURIComponent(selected.id)}/committee-sessions/${s2.sessionId}/minutes`} target="_blank" rel="noreferrer">회의록</a>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </details>
            );
          })()}
        </div>
      )}

      {/* ── 경쟁 구조 탭 (2026-09-14, 평가 근거에서 분리): S1 경쟁 구조 근거만
          단독으로 — 신호별 근거·필요 역량 수준·채점과 섞이지 않게 별도 탭으로 둔다. ── */}
      {tab === "competitive" && (
        <div className="card">
          <h2>{selected.name} — 경쟁 구조</h2>
          {advisory === null ? (
            <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-0">
              근거를 불러오지 못했습니다 — 새로고침하거나 S1 시장분석을 먼저 완료하세요.
            </p>
          ) : advisory.s1Evidence?.competitive ? (
            <>
              <h4 className="text-[0.85rem] mb-1">
                경쟁 구조 (S1 v{advisory.s1Evidence.versionNo ?? "?"} — {advisory.s1Evidence.industryName})
              </h4>
              <p className="text-[0.8rem] mb-1">{advisory.s1Evidence.competitive.structure}</p>
              {advisory.s1Evidence.competitive.players.length > 0 && (
                <div className="table-scroll">
                  <table className="data-table mb-0" aria-label="경쟁 구조 — 주요 기업">
                    <caption className="sr-only">경쟁 구조 — 주요 기업</caption>
                    <thead>
                      <tr><th scope="col">기업</th><th scope="col">티어</th><th scope="col">비고</th></tr>
                    </thead>
                    <tbody>
                      {advisory.s1Evidence.competitive.players.map((p) => (
                        <tr key={p.name}>
                          <td className="cell-primary">{p.name}</td>
                          <td>
                            <span className={`status-chip ${p.tier === "leader" ? "status-green" : p.tier === "challenger" ? "status-amber" : "status-not-started"}`}>
                              {p.tier === "leader" ? "리더" : p.tier === "challenger" ? "도전자" : "니치"}
                            </span>
                          </td>
                          <td className="text-[0.75rem]">{p.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-0">
              경쟁 구조 미기록 —{" "}
              {selected.market_scope ? (
                <Link href={`/market?industry=${encodeURIComponent(selected.market_scope)}`} className="text-[color:var(--accent)] underline">S1 리포트</Link>
              ) : (
                <span>S1 리포트</span>
              )}
              {" "}에서 재분석으로 집중도·주요 플레이어를 보강하세요.
            </p>
          )}
        </div>
      )}

      {/* ── 평가 근거 탭 (2026-09-14 재설계): 신호별 근거·필요 역량 수준·5기준 채점 —
          감사 가능한 형태 그대로 유지한다(삭제하지 않음). 경쟁 구조는 별도
          탭으로 분리했다. 위 "진출방식 추천" 카드는 이 근거를 요약한 것이고,
          이 탭은 "왜 이 딜이 이 점수를 받았는가"의 전체 근거다. 역량 결정성·
          시장 불확실성 두 5기준이 바로 이 근거를 인용해 채점하므로 근거와
          채점을 한 탭에 둔다. ── */}
      {tab === "eval" && (
        <div className="card">
          <h2>{selected.name} — 진출방식 적합도 평가 근거</h2>

          <div className="sizing-grade-card mb-3" aria-label="S1 시장·경쟁·역량 평가">
            {advisory === null ? (
              <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-0">
                근거를 불러오지 못했습니다 — 새로고침하거나 S1 시장분석·S3 필요 역량 수준을 먼저 완료하세요.
              </p>
            ) : (
              <>
                {/* 신호 테이블 — 판정에 필요한 건 "근거 있음"의 확인이므로 요약 카드가
                    본문이다. 표는 기본 접고(필요 역량 상세와 같은 패턴), 요약에 건수를
                    표시한다 (2026-09-18 리뷰: eval 탭이 지나치게 길었다). */}
                <details className="mb-3">
                  <summary className="cursor-pointer text-[0.85rem]">신호별 근거 (S1~S3 — {advisory.signals.length}건)</summary>
                  <h4 className="text-[0.85rem] mb-2 mt-2">신호별 근거 (S1~S3)</h4>
                  <div className="table-scroll">
                    <table className="data-table mb-3" aria-label="신호별 근거">
                      <caption className="sr-only">신호별 근거</caption>
                      <thead>
                        <tr><th scope="col">신호</th><th scope="col">방향</th><th scope="col">가중치</th><th scope="col">근거</th></tr>
                      </thead>
                      <tbody>
                        {advisory.signals.map((s) => (
                          <tr key={s.key}>
                            <td className="text-[0.8rem]">{s.label}</td>
                            <td>
                              <span className={`status-chip ${s.leans === "greenfield" ? "status-green" : s.leans === "brownfield" ? "status-amber" : "status-not-started"}`}>
                                {s.leans === "greenfield" ? "그린필드" : s.leans === "brownfield" ? "브라운필드" : "중립"}
                              </span>
                            </td>
                            <td className="tabular-nums text-[0.8rem]">{s.weight}</td>
                            <td className="text-[0.75rem]">{s.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>

                {advisory.capabilityGap ? (
                  <>
                    {/* 제목과 요약 칩을 한 줄에 나란히 배치 (2026-09-15 사용자 요구) */}
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h4 className="text-[0.85rem] m-0">필요 역량 수준</h4>
                      <span className="status-chip status-not-started">필요 역량 <strong className="ml-1">{advisory.capabilityGap.total}건</strong></span>
                      <span className="status-chip status-green">충족 <strong className="ml-1">{advisory.capabilityGap.met}건</strong></span>
                      <span className="status-chip status-amber">부분 충족 <strong className="ml-1">{advisory.capabilityGap.partial}건</strong></span>
                      <span className="status-chip status-not-started">미충족 <strong className="ml-1">{advisory.capabilityGap.unmet}건</strong></span>
                      {advisory.capabilityGap.coveragePct !== null && (
                        <span className="status-chip status-not-started">충족률 <strong className="ml-1">{advisory.capabilityGap.coveragePct}%</strong></span>
                      )}
                    </div>
                    {advisory.capabilityGap.unmetRows.length > 0 && (
                      <p className="text-[0.78rem] mb-0">
                        미충족: {advisory.capabilityGap.unmetRows.map((r) => r.capability).join(", ")}
                        <span className="text-[color:var(--muted-fg)]"> — 그룹/계열사 프로필 기준, 내부(자사 단독) 역량 평가는 추후 보강</span>
                      </p>
                    )}
                    {/* S3에서 확정한 필요 역량 수준 전체 행 — 역량 관련 5기준
                        (역량 결정성·통합 역량·역량확보 속도) 채점의 직접 근거
                        (2026-09-15 사용자 요구). 행이 많아 접힘 스캐폴드로 제공 —
                        기본 닫힘, 요약(요약: 충족 X·부분 Y·미보유 Z·미판정 W)만
                        표시하고 열면 전체 레지스터가 나온다. 읽기 전용. */}
                    {advisory.capabilityGap.rows && advisory.capabilityGap.rows.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[0.78rem] text-[color:var(--accent)]">
                          필요 역량 수준 상세 ({advisory.capabilityGap.rows.length}건
                          {advisory.capabilityGap.coveragePct !== null ? ` · 충족률 ${advisory.capabilityGap.coveragePct}%` : ""}) 보기
                        </summary>
                        <div className="table-scroll mt-2">
                          <table className="data-table mb-0" aria-label="필요 역량 수준 레지스터 (S3 연계)">
                            <caption className="sr-only">필요 역량 수준 레지스터 — S3 연계, 읽기 전용</caption>
                            <thead>
                              <tr>
                                <th scope="col">필요 역량</th><th scope="col">보유 판정</th>
                                <th scope="col">보유 주체·근거</th><th scope="col">해소 힌트</th>
                              </tr>
                            </thead>
                            <tbody>
                              {advisory.capabilityGap.rows.map((r) => (
                                <tr key={r.capability}>
                                  <td className="cell-primary">
                                    <span className="font-semibold text-[0.8rem]">{r.capability}</span>
                                    <span className="block text-[0.7rem] text-[color:var(--muted-fg)]">
                                      출처: {r.source === "s2_sketch" ? "S2 스케치" : r.source === "s1_factors" ? "S1 요인" : r.source === "synergy_area" ? "S3 시너지 영역" : "수동"}
                                    </span>
                                  </td>
                                  <td>
                                    <span className={`status-chip ${r.held.status === "met" ? "status-green" : r.held.status === "partial" ? "status-amber" : r.held.status === "unmet" ? "status-red" : "status-not-started"}`}>
                                      {r.held.status === "met" ? "충족" : r.held.status === "partial" ? "부분 충족" : r.held.status === "unmet" ? "미보유" : "미판정"}
                                    </span>
                                  </td>
                                  <td className="text-[0.75rem]">
                                    {r.held.status !== "unevaluated" && (r.held.holders.length > 0 || r.held.evidence) ? (
                                      <>
                                        {r.held.holders.length > 0 && <span className="block">{r.held.holders.join(", ")}</span>}
                                        {r.held.evidence && <span className="block text-[color:var(--muted-fg)]">{r.held.evidence}</span>}
                                      </>
                                    ) : "—"}
                                  </td>
                                  <td className="text-[0.75rem]">{r.resolution ? (r.resolution === "build" ? "구축" : r.resolution === "partner" ? "파트너" : r.resolution === "hire" ? "영입" : "투자") : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </>
                ) : (
                  <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-0">
                    필요 역량 수준 미작성 —{" "}
                    <Link href={`/deals/${encodeURIComponent(opportunityId)}/s3`} className="text-[color:var(--accent)] underline">S3 시너지 탭</Link>
                    {" "}에서 필요 역량과 보유 판정을 기록하세요.
                  </p>
                )}
              </>
            )}
          </div>

          <h4 className="text-[0.85rem] mb-1">5기준 채점 (Stage 2, 각 20%)</h4>
          {/* route_decision_score.intent는 NOT NULL이라 의도가 없으면 서버가 채점 행을
              통째로 버린다(draft/route.ts) — 원래 의도 선택은 "결정" 탭에만 있어서, 이
              탭에서 채점만 채우고 저장하면 "초안 저장됨"은 뜨지만 채점은 저장되지
              않고 되돌아왔을 때 빈 화면으로 보이는 혼란이 있었다. 이 탭에서도 바로
              고칠 수 있게 같은 상태를 공유하는 선택자를 둔다. */}
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <label className="text-[0.8rem]">
              <span className="block mb-1 font-medium">의도 (Stage 1) <span className="text-[color:var(--red-fg)]">*</span></span>
              <select value={intent} disabled={!canAct} onChange={(e) => setIntent(e.target.value as "" | "integration" | "capability_access")} className="sizing-new-input">
                <option value="">선택...</option>
                <option value="integration">통합</option>
                <option value="capability_access">역량접근</option>
              </select>
            </label>
            {canAct && intent === "" && (
              <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mb-0">
                의도를 선택하지 않으면 아래 채점·근거는 저장되지 않습니다 (서버가 의도 없는 채점을 저장하지 않음).
              </p>
            )}
          </div>
          <table className="data-table mb-2" aria-label="5기준 채점">
            <caption className="sr-only">5기준 채점</caption>
            <thead>
              <tr><th scope="col">기준 (각 20%)</th><th scope="col">채점 1–3</th><th scope="col">근거 *</th></tr>
            </thead>
            <tbody>
              {scored.map((c) => (
                <tr key={c.key}>
                  <td className="text-[0.8rem]">
                    {c.label}
                    <span className="block text-[0.7rem] text-[color:var(--muted-fg)]">{c.hint}</span>
                    {/* 역량 관련 3기준 — S3 필요 역량 수준 레지스터를 채점 참고로
                        직접 인용한다(2026-09-15 사용자 요구). */}
                    {["capability_criticality", "integration_capacity", "speed_to_capability"].includes(c.key) && advisory?.capabilityGap && (
                      <span className="block text-[0.7rem] mt-0.5" style={{ color: "var(--accent)" }}>
                        역량 참고: {advisory.capabilityGap.total}건 중 충족 {advisory.capabilityGap.met}·부분 {advisory.capabilityGap.partial}·미보유 {advisory.capabilityGap.unmet}
                        {advisory.capabilityGap.coveragePct !== null ? ` (충족률 ${advisory.capabilityGap.coveragePct}%)` : ""}
                        {advisory.capabilityGap.unmetRows.length > 0 ? ` · 미보유: ${advisory.capabilityGap.unmetRows.slice(0, 2).map((r) => r.capability).join(", ")}${advisory.capabilityGap.unmetRows.length > 2 ? " 외" : ""}` : ""}
                      </span>
                    )}
                  </td>
                  <td>
                    <div role="group" aria-label={`${c.label} 점수`} className="flex gap-1">
                      {[1, 2, 3].map((v) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={c.score === v}
                          disabled={!canAct}
                          className={`control-chip ${c.score === v ? "status-green" : ""}`}
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
                      disabled={!canAct}
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
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {canAct && (
              <button type="button" className="btn-ghost" disabled={draftSaving} onClick={() => void performSaveDraft()}>
                {draftSaving ? "저장 중..." : "저장"}
              </button>
            )}
            <span className="text-[0.75rem] text-[color:var(--muted-fg)]">
              {draftSavedAt && `초안 저장됨 · ${draftSavedAt.slice(0, 16).replace("T", " ")} · `}
              {totalScore !== null ? `합산 ${totalScore} / 3.0 · ` : ""}양 트랙 공통 채점 · 사전배제 검증 자동
            </span>
            <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => setTab("decision")}>결정 탭으로 →</button>
          </div>

          {/* ── 판정 규칙 — 이 딜과 무관한 고정 규칙 참고용. 예전엔 모달이었으나
              탭 안 접힘으로 단순화(2026-09-14). ── */}
          <details>
            <summary className="cursor-pointer text-[0.78rem] text-[color:var(--accent)]">판정 규칙 보기 (참고용 — 이 딜과 무관한 고정 규칙)</summary>
            <div className="mt-2">
              <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
                LLM이 아니라 이미 시스템에 기록된 S1~S3 데이터를 아래 고정 규칙으로 채점하는 방식입니다.
                신호별로 Greenfield/Brownfield 방향과 가중치(1~3)를 매기고, 트랙별 가중치 합을 100점 만점 비율로 환산해
                한쪽이 60점 이상이면 그 트랙을 추천하며, 그렇지 않으면 &quot;중립(신호 부족)&quot;으로 표시합니다. 위 &quot;신호별
                근거&quot; 표가 바로 이 규칙을 이 딜에 적용한 결과입니다.
              </p>
              <table className="data-table" aria-label="판정 규칙">
                <caption className="sr-only">판정 규칙</caption>
                <thead>
                  <tr><th scope="col">신호</th><th scope="col">판정 기준</th><th scope="col">방향</th><th scope="col">가중치</th></tr>
                </thead>
                <tbody>
                  <tr><td className="cell-primary">시장 성장률 (S1)</td><td>CAGR 15% 이상 — 고성장</td><td>Greenfield</td><td>3</td></tr>
                  <tr><td className="cell-primary">시장 성장률 (S1)</td><td>CAGR 15% 미만 — 성숙 시장</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">경쟁 구조 (S1)</td><td>독과점·집중 시장</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">경쟁 구조 (S1)</td><td>분산·불명확</td><td>중립</td><td>1</td></tr>
                  <tr><td className="cell-primary">시너지 확정 (S3)</td><td>사람이 확정한 점수 60 이상</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">시너지 확정 (S3)</td><td>사람이 확정한 점수 60 미만</td><td>중립</td><td>2</td></tr>
                  <tr><td className="cell-primary">시너지 권고 (S3)</td><td>사람 확정 전 권고값</td><td>중립</td><td>1</td></tr>
                  <tr><td className="cell-primary">역량 충족률 (S3 필요 역량 수준)</td><td>보유 역량 70% 이상</td><td>Greenfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">역량 충족률 (S3 필요 역량 수준)</td><td>보유 역량 40% 이하</td><td>Brownfield</td><td>2</td></tr>
                  <tr><td className="cell-primary">역량 충족률 (S3 필요 역량 수준)</td><td>40~70% (중간)</td><td>중립</td><td>1</td></tr>
                </tbody>
              </table>
              <p className="text-[0.78rem] text-[color:var(--muted-fg)] mt-3 mb-1">
                함께 제공되는 정보 — 해당 근거가 아직 없을 때(예: S1 미완료, 필요 역량 수준 미작성)는 그 신호가 중립·약한 가중치로 처리됩니다.
              </p>
              <ul className="sizing-note-list mb-2">
                <li><b>기저율</b> — 과거 트랙별 결정 건수와 그중 Entity IC를 통과한 건수를 함께 보여줍니다.</li>
                <li><b>재점검 트리거</b> — 추천과 실제 데이터가 모순될 때(예: Brownfield 추천인데 쇼트리스트가 비어 있음) 경고합니다.</li>
              </ul>
              <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-0">
                원칙 (경계 #2): 이 추천은 제안일 뿐이며, 최종 트랙 결정은 결정 탭의 결정 폼에 사람이 직접 기록합니다.
              </p>
            </div>
          </details>
        </div>
      )}

      {/* ── 위원회 심의 탭 (ADR-0097) — 에이전트는 제안, 확정은 인간 ── */}
      {tab === "committee" && (
        <div className="card">
          <CommitteePanel
            opportunityId={selected.id}
            committeeKey="route-steering-committee"
            committeeLabel="S4 진출방식 스티어링 위원회"
            gates={["pre_fs"]}
          />
        </div>
      )}

      {confirmDialog}
    </>
  );
}
