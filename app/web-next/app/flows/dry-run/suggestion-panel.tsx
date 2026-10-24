"use client";

// AI 제안 패널 (화면 설계 2026-10-24 §7, J4 "개선 제안 수용/기각" — §6.7 제안 전용).
// POST /api/flows/dry-run/suggest 의 응답을 제안 카드로 렌더한다. 모든 카드에
// "제안 전용" amber 칩(/agents 표면과 동일 칩 — 경계 #2 일관성). "수용" affordance는
// 이 세션의 오버라이드 편집기 폼 상태를 채우는 것만 수행한다(onApplyOverride /
// onApplyAgent 콜백) — 저장소 파일 쓰기 경로는 이 컴포넌트에 존재하지 않는다(§12-4).
// available:false(LLM 미구성·검증 실패)는 "제안 생성 불가" + 사유 — 가짜 제안 금지.
import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "../../../components/ui.tsx";
import { api } from "../../../lib/api.ts";
import { fmtDateTime, type DryRunSuggestion } from "../flows-view-lib.ts";

type ProposalType = NonNullable<DryRunSuggestion["proposal"]>["type"];

const PROPOSAL_TYPE_KEY: Record<ProposalType, string> = {
  prompt_improvement: "proposalTypePromptImprovement",
  agent_reassignment: "proposalTypeAgentReassignment",
};

export function SuggestionPanel({
  promptKey,
  recentFailures,
  onApplyOverride,
  onApplyAgent,
}: {
  promptKey: string;
  /** 근거 블록용 최근 실패 수 — 상위 화면이 런 레저 데이터를 이미 들고 있으면 전달(선택).
   *  서버가 자체 실패 조회를 수행하므로 이 값은 카드 근거 문구 보조일 뿐이다. */
  recentFailures?: number;
  /** 프롬프트 개선 수용 — 오버라이드 편집기 본문을 채운다(폼 상태만, 저장 없음). */
  onApplyOverride: (improvedSystem: string) => void;
  /** 재배정 수용 — 오버라이드 편집기의 에이전트 select를 채운다(폼 상태만). */
  onApplyAgent: (agentKey: string) => void;
}) {
  const t = useTranslations("pages.flows.dryRunSession");
  const [suggestion, setSuggestion] = useState<DryRunSuggestion | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);

  async function suggest() {
    if (busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      const r = await api.post<DryRunSuggestion>("/api/flows/dry-run/suggest", {
        promptKey,
        ...(note.trim() || recentFailures
          ? { evidence: { ...(note.trim() ? { note: note.trim() } : {}), ...(recentFailures ? { recentFailures } : {}) } }
          : {}),
      });
      setSuggestion(r.data);
      setAppliedKey(null);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : t("suggestFailed"));
    } finally {
      setBusy(false);
    }
  }

  function applyOverride(system: string) {
    onApplyOverride(system);
    setAppliedKey("override");
  }

  function applyAgent(key: string) {
    onApplyAgent(key);
    setAppliedKey(key);
  }

  return (
    <section aria-label={t("suggestionSection")} className="market-section">
      <div className="section-toolbar">
        <span className="section-title">
          <h2>{t("suggestionTitle")}</h2>
          {suggestion && <span className="section-meta">{t("proposalOnlyMeta")}</span>}
        </span>
        <span className="toolbar-filters">
          <label className="text-[length:var(--fs-caption)]">
            <span className="sr-only">{t("evidenceNoteSrOnly")}</span>
            <input
              className="sizing-new-input sizing-new-input-sm"
              value={note}
              maxLength={300}
              placeholder={t("evidenceNotePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <Button size="sm" disabled={busy} onClick={() => void suggest()}>
            {busy ? t("suggesting") : suggestion ? t("suggestAgain") : t("suggestCta")}
          </Button>
        </span>
      </div>
      <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        {t("suggestNote")}
      </p>

      {errorText && (
        <p role="alert" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">✕ {errorText}</p>
      )}

      {suggestion === null ? (
        <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{t("noSuggestionYet")}</p>
      ) : !suggestion.available ? (
        <p role="alert" className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          <span className="status-chip status-not-started">{t("suggestUnavailableChip")}</span>{" "}
          {suggestion.reason ?? t("reasonNotProvided")}{t("suggestUnavailableTail")}
        </p>
      ) : (
        suggestion.proposal && (
          <div className="sizing-grade-card">
            <div className="flex flex-wrap items-center gap-1 mb-2">
              <span className="status-chip status-in-progress">{t(PROPOSAL_TYPE_KEY[suggestion.proposal.type])}</span>
              <span className="status-chip status-amber">{t("proposalOnlyMeta")}</span>
            </div>
            <p className="mb-2 text-[length:var(--fs-body)]">{suggestion.proposal.rationale}</p>

            {/* 근거 블록 — 런 레저 딥링크로 검증 가능하게(벤치 A1-5 "개선 근거" 정신). */}
            <details className="mb-2">
              <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">
                {t("evidenceSummary", { p1: suggestion.evidence.recentFailures, p2: recentFailures !== undefined ? t("evidenceRefSuffix", { p1: recentFailures }) : "" })}
              </summary>
              {suggestion.evidence.recentFailures === 0 ? (
                <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noRecentFailures")}</p>
              ) : (
                <ul className="ml-4 mb-0 list-disc text-[length:var(--fs-caption)]">
                  {suggestion.evidence.failures.map((f, i) => (
                    <li key={i} className="mb-1">
                      <span className="tabular-nums">{fmtDateTime(f.createdAt)}</span> — <code style={{ wordBreak: "break-all" }}>{f.error || t("noErrorMessage")}</code>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 mb-0 text-[length:var(--fs-caption)]">
                <Link href="/flows?tab=ledger" className="text-[color:var(--accent)] underline">{t("viewFailuresInLedger")}</Link>
              </p>
            </details>

            {suggestion.proposal.type === "prompt_improvement" && suggestion.proposal.improvedSystem && (
              <>
                <p className="mb-1 text-[length:var(--fs-caption)] font-semibold">{t("improvedPromptHeading")}</p>
                <pre className="mb-2 text-[length:var(--fs-caption)]" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "14rem", overflowY: "auto" }}>
                  {suggestion.proposal.improvedSystem}
                </pre>
                <Button size="sm" onClick={() => applyOverride(suggestion.proposal!.improvedSystem!)}>
                  {t("acceptOverrideCta")}
                </Button>
              </>
            )}

            {suggestion.proposal.type === "agent_reassignment" && suggestion.proposal.candidateAgents.length > 0 && (
              <>
                <p className="mb-1 text-[length:var(--fs-caption)] font-semibold">{t("candidatesHeading", { p1: suggestion.proposal.candidateAgents.length })}</p>
                <ul className="ml-4 mb-2 list-disc text-[length:var(--fs-caption)]">
                  {suggestion.proposal.candidateAgents.map((c) => (
                    <li key={c.key} className="mb-1">
                      <code className="dd-item-id">{c.key}</code> — {c.rationale}{" "}
                      <Button size="sm" onClick={() => applyAgent(c.key)}>{t("reassignCta")}</Button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {appliedKey && (
              <p role="status" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("appliedStatus")}
              </p>
            )}
            <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("proposalOnlyNote")}
            </p>
          </div>
        )
      )}
    </section>
  );
}
