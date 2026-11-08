"use client";

// 매력도 평가·재평가 컨트롤 — /opportunities/[id] 상세 화면과 S2 퍼널 행
// (/deals/[id]/s2)이 같이 쓴다. 발굴(identified) 기회는 항상 입력을 열어 첫 평가를
// 받고(저장 시 평가 단계로 자동 진행), 평가(assessed)·선택(selected, S4 확정 전·프로젝트
// 승격 전) 기회는 "재평가" 토글로 입력을 연다. PUT /api/opportunities/{id}는 status
// 게이트가 없다(점수만 갱신) — dropped와 S4 확정 이후는 UI에서만 막는다.
//
// 구성: 토글 버튼(AttractivenessReEvaluateToggle)과 편집기(AttractivenessEditor)를
// 분리해 퍼널이 좁은 작업 칸에는 토글만, 편집기는 행 아래 전폭 하위 행에 그릴 수 있게
// 했다. AttractivenessReEvaluate는 둘을 인라인으로 묶은 합성형(상세 화면용)이다.
// 재평가를 열면 AI 초안을 한 번 자동 요청해 제안으로 채운다 — 저장은 사람이 누른다.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api.ts";
import { type AttractivenessStatus, canReEvaluateAttractiveness } from "../lib/attractiveness-reevaluate.ts";

interface AttractivenessReco {
  recommendation: {
    suggested_score: number | null;
    rationale_draft: string;
    key_evidence?: string[];
    cautions?: string[];
  };
}

const DEFAULT_INPUT_ID = "opp-score-input";

/** 편집기 영역 id — 토글의 aria-controls 대상. 점수 입력 id에서 파생한다. */
export function attractivenessEditorId(inputId: string = DEFAULT_INPUT_ID): string {
  return `${inputId}-editor`;
}

/** 재평가 토글 id — 닫을 때 포커스를 되돌리는 대상. */
export function attractivenessToggleId(inputId: string = DEFAULT_INPUT_ID): string {
  return `${inputId}-toggle`;
}

export function AttractivenessReEvaluateToggle({
  opportunityName,
  open,
  onToggle,
  inputId = DEFAULT_INPUT_ID,
}: {
  opportunityName?: string;
  open: boolean;
  onToggle: () => void;
  inputId?: string;
}) {
  const t = useTranslations("pages.opportunityDetail");
  return (
    <button
      type="button"
      id={attractivenessToggleId(inputId)}
      className="btn-ghost btn-sm"
      aria-expanded={open}
      aria-controls={attractivenessEditorId(inputId)}
      onClick={onToggle}
    >
      {t("reEvaluateButton")}
      {opportunityName && <span className="sr-only"> — {opportunityName}</span>}
    </button>
  );
}

export function AttractivenessEditor({
  opportunityId,
  opportunityName,
  status,
  onSaved,
  onClose,
  autoDraft = false,
  autoFocus = false,
  inputId = DEFAULT_INPUT_ID,
}: {
  opportunityId: string;
  opportunityName?: string;
  status: AttractivenessStatus;
  /** 저장 성공 후 호출 — 호출자가 표시 점수를 다시 불러온다. */
  onSaved: () => void;
  /** 재평가 닫기(재평가 모드에서만 버튼이 나온다). 저장 성공 시에도 호출한다. */
  onClose?: () => void;
  /** 편집기가 열릴 때 AI 초안을 한 번 자동 요청한다 (페이지 로드 시 호출 금지 — 열 때만). */
  autoDraft?: boolean;
  /** 열릴 때 점수 입력으로 포커스를 옮긴다 (키보드·스크린리더 흐름). */
  autoFocus?: boolean;
  inputId?: string;
}) {
  const t = useTranslations("pages.opportunityDetail");
  const tc = useTranslations("common");
  const [draft, setDraft] = useState("");
  const [reco, setReco] = useState<AttractivenessReco["recommendation"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRequested = useRef(false);

  const firstEvaluation = status === "identified";
  const base = `/api/opportunities/${encodeURIComponent(opportunityId)}`;

  useEffect(() => {
    if (autoFocus) document.getElementById(inputId)?.focus();
  }, [autoFocus, inputId]);

  // 열릴 때 한 번만 — StrictMode 이중 실행에도 ref가 요청을 한 번으로 묶는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열림 시점 1회 요청이 의도 (generateDraft는 매 렌더 새로 만들어진다)
  useEffect(() => {
    if (!autoDraft || autoRequested.current) return;
    autoRequested.current = true;
    void generateDraft(true);
  }, [autoDraft]);

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
      onSaved();
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("attractEvalFailed"));
    }
  }

  // auto=true(열림 자동 요청)는 사용자가 이미 입력한 값을 덮어쓰지 않는다.
  async function generateDraft(auto = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<AttractivenessReco>(`${base}/attractiveness-recommendation`, {});
      setReco(r.data.recommendation);
      const score = r.data.recommendation.suggested_score;
      if (score !== null) setDraft((prev) => (auto && prev !== "" ? prev : String(score)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("attractDraftFailed"));
    } finally {
      setBusy(false);
    }
  }

  const label = opportunityName ? `${t("attractiveness")} — ${opportunityName}` : t("attractiveness");
  const evidence = reco?.key_evidence ?? [];
  const cautions = reco?.cautions ?? [];

  return (
    <div id={attractivenessEditorId(inputId)} aria-busy={busy} className="flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-center gap-1">
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
        {onClose && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setDraft("");
              setError(null);
              onClose();
            }}
          >
            {t("reEvaluateClose")}
          </button>
        )}
        <span role="status" className="sr-only">
          {busy ? t("draftGenerating") : ""}
        </span>
      </div>
      {reco && (
        <div className="min-w-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          <p className="m-0">
            <span className="status-chip status-amber mr-1">{tc("proposal")}</span>
            <span className="[overflow-wrap:anywhere]">{reco.rationale_draft || t("noDraft")}</span>
          </p>
          {evidence.length > 0 && (
            <div className="mt-1">
              <span className="font-semibold">{t("keyEvidenceLabel")}</span>
              <ul className="m-0 pl-4 list-disc [overflow-wrap:anywhere]">
                {evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {cautions.length > 0 && (
            <div className="mt-1">
              <span className="font-semibold">{t("cautionsLabel")}</span>
              <ul className="m-0 pl-4 list-disc [overflow-wrap:anywhere]">
                {cautions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="m-0 mt-1">{t("aiProposalNotice")}</p>
        </div>
      )}
      {error && (
        <span role="alert" className="block text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
          {error}
        </span>
      )}
    </div>
  );
}

/** 합성형(인라인) — 상세 화면처럼 전폭이 있는 곳에서 토글과 편집기를 한 자리에 그린다. */
export function AttractivenessReEvaluate({
  opportunityId,
  opportunityName,
  status,
  canAct,
  s4Confirmed = false,
  hasProject = false,
  onSaved,
  inputId = DEFAULT_INPUT_ID,
}: {
  opportunityId: string;
  /** 목록처럼 같은 화면에 컨트롤이 여러 개일 때 스크린리더용 이름. */
  opportunityName?: string;
  status: AttractivenessStatus;
  canAct: boolean;
  /** S4 진출방식 결정 확정 여부(API route_confirmed) — 확정 후엔 selected 재평가를 숨긴다. */
  s4Confirmed?: boolean;
  /** 프로젝트로 승격됐는지(project_id) — 승격 후엔 selected 재평가를 숨긴다. */
  hasProject?: boolean;
  /** 저장 성공 후 호출 — 호출자가 표시 점수를 다시 불러온다. */
  onSaved: () => void;
  /** 페이지에 하나뿐이면 기본 id(딥링크 focus=score 대상)를 쓴다. 목록은 행별로 다른 id를 준다. */
  inputId?: string;
}) {
  const [open, setOpen] = useState(false);
  const firstEvaluation = status === "identified";
  const canReEvaluate = canReEvaluateAttractiveness(status, canAct, { s4Confirmed, hasProject });

  if (!canAct || (!firstEvaluation && !canReEvaluate)) return null;

  function close() {
    setOpen(false);
    document.getElementById(attractivenessToggleId(inputId))?.focus();
  }

  return (
    <>
      {canReEvaluate && (
        <AttractivenessReEvaluateToggle
          opportunityName={opportunityName}
          open={open}
          onToggle={() => (open ? close() : setOpen(true))}
          inputId={inputId}
        />
      )}
      {(firstEvaluation || open) && (
        <AttractivenessEditor
          opportunityId={opportunityId}
          opportunityName={opportunityName}
          status={status}
          onSaved={onSaved}
          onClose={canReEvaluate ? close : undefined}
          autoDraft={canReEvaluate}
          autoFocus={canReEvaluate}
          inputId={inputId}
        />
      )}
    </>
  );
}
