"use client";

// 매력도 평가·재평가 컨트롤 — /opportunities/[id] 상세 화면과 S2 퍼널 행
// (/deals/[id]/s2)이 같이 쓴다. 발굴(identified) 기회는 항상 입력을 열어 첫 평가를
// 받고(저장 시 평가 단계로 자동 진행), 평가(assessed) 기회는 "재평가" 토글로 입력을
// 연다. PUT /api/opportunities/{id}는 status 게이트가 없다(점수만 갱신) — 종결
// (selected/dropped)만 UI에서 막는다. AI 초안은 제안일 뿐, 저장은 사람이 누른다.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api.ts";

interface AttractivenessReco {
  recommendation: { suggested_score: number | null; rationale_draft: string };
}

export type AttractivenessStatus = "identified" | "assessed" | "selected" | "dropped";

export function AttractivenessReEvaluate({
  opportunityId,
  opportunityName,
  status,
  canAct,
  onSaved,
  inputId = "opp-score-input",
}: {
  opportunityId: string;
  /** 목록처럼 같은 화면에 컨트롤이 여러 개일 때 스크린리더용 이름. */
  opportunityName?: string;
  status: AttractivenessStatus;
  canAct: boolean;
  /** 저장 성공 후 호출 — 호출자가 표시 점수를 다시 불러온다. */
  onSaved: () => void;
  /** 페이지에 하나뿐이면 기본 id(딥링크 focus=score 대상)를 쓴다. 목록은 행별로 다른 id를 준다. */
  inputId?: string;
}) {
  const t = useTranslations("pages.opportunityDetail");
  const [draft, setDraft] = useState("");
  const [reco, setReco] = useState<AttractivenessReco | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reEvaluating, setReEvaluating] = useState(false);

  const firstEvaluation = status === "identified";
  const canReEvaluate = canAct && status === "assessed";
  const showControls = canAct && (firstEvaluation || (canReEvaluate && reEvaluating));

  // 재평가 토글을 열면 점수 입력으로 포커스를 옮긴다 (키보드·스크린리더 흐름).
  useEffect(() => {
    if (reEvaluating) document.getElementById(inputId)?.focus();
  }, [reEvaluating, inputId]);

  if (!canAct || (!firstEvaluation && !canReEvaluate)) return null;

  const base = `/api/opportunities/${encodeURIComponent(opportunityId)}`;

  async function evaluate() {
    const v = draft === "" ? null : Math.min(100, Math.max(0, Number(draft)));
    if (v === null || Number.isNaN(v)) {
      setError(t("errAttractRange"));
      return;
    }
    setError(null);
    try {
      await api.put(base, { attractiveness_score: v });
      // 매력도 평가 = 평가 단계 진행 — 발굴(identified) 상태면 자동으로
      // 평가(assessed)로 넘긴다 (퍼널이 평가 버튼 없이 막히지 않게, ADR-0127).
      if (firstEvaluation) await api.put(base, { status: "assessed" });
      setDraft("");
      setReco(null);
      setReEvaluating(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("attractEvalFailed"));
    }
  }

  async function generateDraft() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<AttractivenessReco>(`${base}/attractiveness-recommendation`, {});
      setReco(r.data);
      if (r.data.recommendation.suggested_score !== null) setDraft(String(r.data.recommendation.suggested_score));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("attractDraftFailed"));
    } finally {
      setBusy(false);
    }
  }

  const label = opportunityName ? `${t("attractiveness")} — ${opportunityName}` : t("attractiveness");

  return (
    <>
      {showControls && (
        <span className="flex flex-wrap items-center gap-1">
          <input
            id={inputId}
            type="number"
            min={0}
            max={100}
            aria-label={label}
            placeholder={t("attractPlaceholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="sizing-new-input sizing-new-input-sm"
            style={{ width: "7.5rem" }}
          />
          <button type="button" className="btn-ghost btn-sm" onClick={() => void evaluate()}>
            {t("evaluateButton")}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void generateDraft()}>
            {busy ? t("draftGenerating") : t("aiDraftButton")}
          </button>
          {canReEvaluate && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setReEvaluating(false);
                setDraft("");
                setError(null);
              }}
            >
              {t("reEvaluateClose")}
            </button>
          )}
          {reco && (
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {reco.recommendation.rationale_draft.slice(0, 160) || t("noDraft")}
            </span>
          )}
        </span>
      )}
      {canReEvaluate && !reEvaluating && (
        <button type="button" className="btn-ghost btn-sm" aria-expanded={false} onClick={() => setReEvaluating(true)}>
          {t("reEvaluateButton")}
          {opportunityName && <span className="sr-only"> — {opportunityName}</span>}
        </button>
      )}
      {error && (
        <span role="alert" className="block text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
          {error}
        </span>
      )}
    </>
  );
}
