"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { api } from "../../../lib/api.ts";
import { KNOCKOUT_IDS } from "../../../lib/brownfield-precheck.ts";
import { buildEvalBriefMd } from "./evalBrief.ts";
import type { useBrownfieldBase } from "./useBrownfieldBase.ts";
import type { useBrownfieldUniverse } from "./useBrownfieldUniverse.tsx";
import type { PrecheckDraftItem, ScreeningDraftResponse } from "./types.ts";
import { useTranslations } from "next-intl";

export function useBrownfieldTargets(prev: ReturnType<typeof useBrownfieldBase> & ReturnType<typeof useBrownfieldUniverse>) {const tr = useTranslations(); const t = useTranslations("stages.s67.useBrownfieldTargets");
  const { selected, newTarget, busy, setBusy, setError, setNewTarget, loadDetail, onSaved, precheckBusy, precheckDraft, setPrecheckBusy, setPrecheckDraft, setPrecheckDraftNote, recoBusy, setRecoBusy, setRecoProgress } = prev;


  async function addTarget(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !newTarget.company_name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/brownfield/${selected.opportunity.id}/targets`, {
        company_name: newTarget.company_name.trim(),
        dart_corp_code: newTarget.dart_corp_code.trim() || undefined,
      });
      setNewTarget({ company_name: "", dart_corp_code: "" });
      loadDetail(selected.opportunity.id);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToRegisterTheCandidate"));
    } finally {
      setBusy(false);
    }
  }

  // ── 사전 검토(대상 사전 검토 체크리스트) — 최종 후보 목록 후보의 최종 점검을 섹션
  // 카드에서 바로 기록한다(사용자 결정, 2026-09-16: 상세 화면·후보 전체 목록의
  // 사전 검토 표면은 제거, 이 곳이 유일한 기록 지점). 저장은 기존
  // screening_json 병합 라우트 재사용 — 사람이 저장한 판정은 초안이 덮지 않는다.
  // 수집 근거(사유·출처·구분)는 evidence로 함께 보내 후보 참고 저장소에 적립.
  async function savePrecheck(targetId: string) {
    if (!selected || precheckBusy) return;
    const draft = precheckDraft[targetId];
    if (!draft || Object.keys(draft).length === 0) return;
    const states: Record<string, string> = {};
    const evidenceMeta: Record<string, { rationale?: string; source_url?: string | null; kind?: string }> = {};
    for (const [itemId, d] of Object.entries(draft)) {
      if (!d.verdict) continue;
      states[itemId] = d.verdict;
      evidenceMeta[itemId] = { rationale: d.rationale, source_url: d.source_url ?? null, kind: d.kind };
    }
    if (Object.keys(states).length === 0) return;
    setPrecheckBusy(targetId); setError(null);
    try {
      await api.post(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets/${encodeURIComponent(targetId)}`, { states, evidence: evidenceMeta });
      setPrecheckDraft((prev) => { const n = { ...prev }; delete n[targetId]; return n; });
      setPrecheckDraftNote((prev) => { const n = { ...prev }; delete n[targetId]; return n; });
      loadDetail(selected.opportunity.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToSaveTheJudgement"));
    } finally {
      setPrecheckBusy(null);
    }
  }

  // 미판정 항목의 판정 제안 1건 수집 — 기확보 정보(전자공시 재무 정보·프로파일·
  // 공시)를 재검색하지 않고 활용하고, 부족한 정보만 서버가 웹검색한다. 결과는
  // 누적기(acc)에 병합되고 화면 상태에도 반영된다. 사람이 확정(저장)한 항목은
  // 건드리지 않고, 그 외 항목은 재실행 시 새 제안으로 갱신한다 — 이미 제안된
  // 항목을 스킵하면 다시 눌러도 변화가 없어 버튼이 죽어 보였다(사용자 리포트,
  // 2026-09-16). 실패는 삼키지 않고 호출자(소집 흐름)로 전파한다.
  async function draftPrecheckInto(targetId: string, acc: Record<string, Record<string, PrecheckDraftItem>>): Promise<void> {
    if (!selected) return;
    const res = await api.post<ScreeningDraftResponse>(
      `/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets/${encodeURIComponent(targetId)}/screening-draft`,
      {},
    );
    setPrecheckDraftNote((prev) => ({ ...prev, [targetId]: res.data.note ?? null }));
    const row = selected.targets.find((t) => t.id === targetId);
    const saved = row?.screening_json ? (JSON.parse(row.screening_json) as Record<string, string>) : {};
    const cur = { ...(acc[targetId] ?? {}) };
    for (const [itemId, d] of Object.entries(res.data.drafts ?? {})) {
      const already = saved[itemId];
      if (already && already !== "pending") continue; // 사람이 확정한 판정만 유지
      cur[itemId] = { verdict: d.verdict, rationale: d.rationale, source_url: d.source_url, kind: d.kind };
    }
    acc[targetId] = cur;
    setPrecheckDraft((prev) => ({ ...prev, [targetId]: cur }));
  }

  // ── 위원회 추천 검토 — 위원회 소집(CommitteePanel beforeConvene 훅)의 선행
  // 단계로 실행된다(사용자 결정, 2026-09-16: 사전 검토 제안 생성과 위원회 소집을
  // 하나의 흐름으로 통합 — 별도 버튼은 역할 중복). 최종 후보 목록 후보 전체의
  // 기확보 정보(재무·프로파일·공시)를 활용하고 부족한 정보만 검색해 판정 제안을
  // 만든 뒤, 그 제안을 포함한 심의 brief를 반환한다. 후보가 하나도 성공하지
  // 못하면 예외를 던져 소집을 막고 패널에 에러를 표시한다 — 부분 성공이면
  // 성공한 제안으로 소집을 진행한다.
  async function runCommitteePrecheck(): Promise<string | undefined> {
    if (!selected || recoBusy) return;
    setRecoBusy(true); setError(null);
    const failures: string[] = [];
    let lastError: Error | null = null;
    try {
      const acc: Record<string, Record<string, PrecheckDraftItem>> = { ...precheckDraft };
      for (let i = 0; i < shortlistedTargets.length; i++) {
        const target = shortlistedTargets[i];
        setRecoProgress(`${target.company_name} (${i + 1}/${shortlistedTargets.length})`);
        try {
          await draftPrecheckInto(target.id, acc);
        } catch (err) {
          failures.push(target.company_name);
          lastError = err instanceof Error ? err : new Error(String(err));
          setError(t("failedToGenerateProposalsP1", { p1: target.company_name, p2: lastError.message }));
        }
      }
      if (failures.length > 0 && failures.length === shortlistedTargets.length) {
        throw lastError ?? new Error(t("failedToGenerateJudgementProposals"));
      }
      return buildEvalBriefMd(selected.targets, selected.checklist, acc, tr);
    } finally {
      setRecoBusy(false);
      setRecoProgress(null);
    }
  }

  async function shortlist(targetId: string) {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/brownfield/${selected.opportunity.id}/targets/${targetId}/shortlist`, {});
      loadDetail(selected.opportunity.id);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToPromoteToThe"));
    } finally {
      setBusy(false);
    }
  }

  // 최종 후보 목록 순위 조정 — 이웃 행과 rank를 교환한다(사람이 확정하는 순위).
  async function rerank(targetId: string, direction: "up" | "down") {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/brownfield/${selected.opportunity.id}/targets/${targetId}/rerank`, { direction });
      loadDetail(selected.opportunity.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToChangeTheRank"));
    } finally {
      setBusy(false);
    }
  }

  const targets = selected?.targets ?? [];
  const shortlistedTargets = targets.filter((t) => t.status === "shortlisted");
  // 전치 테이블(항목 = 컬럼, 후보 = 행)의 Part 그룹 컬럼 수
  const checklistItems = selected?.checklist ?? [];
  const part1Count = checklistItems.filter((it) => KNOCKOUT_IDS.has(it.id)).length;
  const part2Count = checklistItems.length - part1Count;
  // 후보 전체 목록(심사 중) 구간만 재무·기술 평가 종합 점수로 잠정 정렬한다 —
  // 최종 후보 목록 승격 후 순위(rank)는 사람이 손으로 조정하는 영역이라 건드리지
  // 않는다(status가 다르면 비교 없이 0을 반환해 안정 정렬로 원래 그룹 순서를
  // 보존한다).
  const displayedTargets = targets
    .slice()
    .sort((a, b) => {
      if (a.status !== "pending" || b.status !== "pending") return 0;
      return (b.eval_summary?.combined ?? -1) - (a.eval_summary?.combined ?? -1);
    });
  // 평가 기반 잠정 순위 — 제외를 뺀 전 후보(pending + shortlisted) 대상.
  // 최종 후보 목록으로 승격해도 순위가 사라지지 않는다(사용자 리포트, 2026-09-16 —
  // 승격·제외 시 잠정 순위가 "—"로 사라지는 문제). 승격이 같은 점수 기준이므로
  // 순위 모집단도 같게 유지한다. 최종 후보 목록의 표시 순위(rank)는 별개(사람 조정).
  const evalRank = new Map(targets.filter((t) => t.status !== "excluded" && t.eval_summary?.combined != null)
    .slice()
    .sort((a, b) => (b.eval_summary?.combined ?? -1) - (a.eval_summary?.combined ?? -1))
    .map((t, i) => [t.id, i + 1]));
  const shortlistOrder = shortlistedTargets.map((t) => t.id);
  // 최종 후보 목록 후보 중 사전 검토(대상 사전 검토 체크리스트)가 미완료인 후보 수 —
  // 위원회 최종 검토 전 판정 기록 권장 신호(사용자 결정, 2026-09-16: 체크리스트는
  // 최종 후보 목록 후보의 "문제 없는지" 최종 점검 도구).
  const precheckIncomplete = shortlistedTargets.filter((t) => {
    const s = t.screening_summary;
    return !s || s.anyKnockOutFail || s.assessed < s.total || s.mandatoryOpen.length > 0;
  }).length;
  return { addTarget, targets, shortlistedTargets, displayedTargets, shortlistOrder, evalRank, shortlist, rerank, precheckIncomplete, checklistItems, part1Count, part2Count, savePrecheck, runCommitteePrecheck };
}

export type BrownfieldStageState = ReturnType<typeof useBrownfieldBase> & ReturnType<typeof useBrownfieldUniverse> & ReturnType<typeof useBrownfieldTargets>;
