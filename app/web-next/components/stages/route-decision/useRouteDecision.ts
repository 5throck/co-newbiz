"use client";

// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { useState, useRef, useCallback, useEffect } from "react";
import { useConfirm } from "../../crud.tsx";
import { api, ApiError } from "../../../lib/api.ts";
import { CRITERIA, OVERRIDDEN_SUBS, GF_SUB, BF_SUB } from "./constants.ts";
import type { OpportunityRow, RouteDecision, AdvisoryResponse, RouteRecommendation, RouteDecisionDraft } from "./types.ts";
import { useTranslations } from "next-intl";

export function useRouteDecision({ opportunityId, rationaleParam, tabParam }: { opportunityId: string; rationaleParam?: string | null; tabParam?: string | null }) {const t = useTranslations("stages.s4.useRouteDecision"); const tc = useTranslations("common");

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
  // 리뷰 2026-10-22 (저니 F5) — 방금 기록된 결정의 트랙별 다음 단계 안내.
  const [savedNotice, setSavedNotice] = useState<{ track: "greenfield" | "brownfield" } | null>(null);
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
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadTheDecision")));
  }, []);
  const loadSessions = useCallback((id: string) => {
    api.get<Array<{ sessionId: string; status: string; decisionMode: string | null; createdAt: string }>>(`/api/opportunities/${encodeURIComponent(id)}/committee-sessions`)
      .then((r) => setSessions(r.data)).catch(() => setSessions([]));
  }, []);
  // 검토/안건은 URL로 고정된다 — 목업처럼 선택 칩 없이 바로 이 기회를 로드한다.
  // 단건 조회(GET /api/opportunities/{id})는 목록 조회와 달리 삭제 표시된
  // 행도 그대로 돌려준다 — 프로젝트로 승격된 뒤 사업 기회가 삭제 표시되어도
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
        setError(e instanceof Error ? e.message : tc("errors.loadFailed"));
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

  // 딥링크 ?tab= — 인박스의 brownfield pre_fs HOLD 링크가 위원회 심의 탭에
  // 바로 착륙하게 한다 (T-20261022-041). 알 수 없는 값은 기본 탭을 유지한다.
  useEffect(() => {
    if (tabParam === "competitive" || tabParam === "eval" || tabParam === "committee" || tabParam === "decision") {
      setTab(tabParam);
    }
  }, [tabParam]);

  const generateRecommendation = useCallback(async () => {
    if (!selected || recoLoading) return;
    setRecoLoading(true); setRecoError(null);
    try {
      const r = await api.post<RouteRecommendation>(`/api/opportunities/${encodeURIComponent(selected.id)}/route-recommendation`, {});
      setReco(r.data);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : t("failedToGenerateLlmRecommendation"));
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
    setSaving(true); setError(null); setSavedNotice(null);
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
      // 리뷰 2026-10-22 (저니 F5): 저장 성공이 조용히 끝나지 않게 — 트랙별 다음
      // 단계로 이어지는 전진 큐를 남긴다 (엔진 nextStage의 스킵 semantics와 동일:
      // greenfield→S5, brownfield→S6).
      setSavedNotice({ track });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToSaveTheDecision"));
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
      setError(err instanceof Error ? err.message : t("failedToSaveTheDraft"));
    } finally {
      setDraftSaving(false);
    }
  }

  const subs = track === "greenfield" ? GF_SUB : BF_SUB;
  return { opportunityId, selected, advisory, tab, setTab, error, savedNotice, confirmDialog, notFound, reco, canAct, recoLoading, generateRecommendation, recoError, confirm, applyRecommendation, decisions, saveDecision, track, setTrack, setIntent, setSubTrack, subTrack, subs, overrideBlocked, intent, stagingHint, rationale, setRationale, alternatives, setAlternatives, draftSaving, performSaveDraft, saving, canSubmit, draftSavedAt, totalScore, allScored, historyYear, historyMonth, historyOpen, setHistoryOpen, setHistoryYear, setHistoryMonth, sessions, scored, setScore };
}

export type RouteDecisionStageState = ReturnType<typeof useRouteDecision>;
