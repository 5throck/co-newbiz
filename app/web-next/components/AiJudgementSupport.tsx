"use client";

// AiJudgementSupport — S8 decision tab, ONE section for both AI proposals
// (ADR-0118, boundary #2): "채택할 케이스" (adoption recommendation) and
// "게이트 판단" (gate brief). Proposals only; the person records the decision.
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { canWriteProject } from "../lib/project-write-access.ts";
import { GateBriefBody, type GateBriefData } from "./GateDecisionPanel.tsx";

export interface AdoptionReco {
  source: "llm" | "synthesis";
  provider: string | null;
  note: string | null;
  manifest: string[];
  recommendation: {
    recommended_model_id: string | null;
    rationale_draft: string;
    what_would_change: string | null;
    key_evidence: string[];
    cautions: string[];
  };
}

const CAP = "text-[length:var(--fs-caption)]";

export function AiJudgementSupport({ projectId, gate = "fs", cases, canAct, onApplyRationale }: {
  projectId: string;
  gate?: string;
  cases: Array<{ id: string; name: string }>;
  canAct: boolean;
  onApplyRationale: (text: string) => void;
}) {
  const { me } = useAuth();
  const canBrief = canWriteProject(me?.role);
  const [reco, setReco] = useState<AdoptionReco | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);
  const [brief, setBrief] = useState<GateBriefData | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  useEffect(() => { setReco(null); setRecoError(null); setBrief(null); setBriefError(null); }, [projectId]);

  const busy = recoLoading || briefLoading;
  const generated = !!reco || !!brief || !!recoError || !!briefError;
  if (!canAct && !canBrief) return null;

  const id = encodeURIComponent(projectId);
  async function generateReco() {
    setRecoLoading(true); setRecoError(null);
    try {
      const r = await api.post<AdoptionReco>(`/api/projects/${id}/business-case/adoption-recommendation`, {});
      setReco(r.data);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : "권고 생성 실패");
    } finally { setRecoLoading(false); }
  }
  async function generateBrief() {
    setBriefLoading(true); setBriefError(null);
    try {
      const r = await api.post<GateBriefData>(`/api/projects/${id}/gate-brief`, { gate });
      setBrief(r.data);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : "브리프 생성 실패");
    } finally { setBriefLoading(false); }
  }
  // Adoption recommendation first, then the gate brief (the two are independent; one failing never hides the other).
  async function generateAll() {
    if (busy) return;
    if (canAct) await generateReco();
    if (canBrief) await generateBrief();
  }

  return (
    <section className="market-section sizing-step mt-3" aria-label="AI 판단 지원">
      <h3 className="sizing-step-title text-[0.9rem]">🤖 AI 판단 지원</h3>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void generateAll()}>
          {busy ? "생성 중..." : generated ? "재생성" : "AI 판단 지원 생성"}
        </button>
        <span className={`${CAP} text-[color:var(--muted-fg)]`}>
          모두 제안일 뿐입니다 — 채택과 게이트 결정은 사람이 기록합니다 (경계 #2, ADR-0118).
        </span>
      </div>

      {canAct && (
        <div className="border border-[color:var(--border)] rounded-lg px-3 py-2 mb-2" aria-label="채택할 케이스">
          <h4 className="font-semibold text-[length:var(--fs-body)] mt-0 mb-1">채택할 케이스</h4>
          {recoError && <p role="alert" className={`${CAP} text-[color:var(--red-fg)] mb-1`}>{recoError}</p>}
          {recoLoading && <p className={`${CAP} text-[color:var(--muted-fg)] mb-0`}>케이스 수치와 킬 크라이테리아를 근거로 초안을 작성하는 중...</p>}
          {!reco && !recoLoading && !recoError && (
            <p className={`${CAP} text-[color:var(--muted-fg)] mb-0`}>권고 케이스와 근거, "무엇이 바뀌면 뒤집히는가" 초안을 작성합니다. ★ 권고안(결정론)과는 별개 제안입니다.</p>
          )}
          {reco && (
            <>
              <p className="mb-1 flex flex-wrap items-center gap-1">
                <span className={`status-chip ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                  {reco.source === "llm" ? `LLM 제안${reco.provider ? ` · ${reco.provider}` : ""}` : "결정론 폴백"}
                </span>
                {reco.recommendation.recommended_model_id && (
                  <span className="status-chip status-green">권고: {cases.find((c) => c.id === reco.recommendation.recommended_model_id)?.name ?? reco.recommendation.recommended_model_id}</span>
                )}
              </p>
              {reco.note && <p className={`${CAP} text-[color:var(--muted-fg)] mb-1`}>{reco.note}</p>}
              {reco.recommendation.rationale_draft && <p className={`${CAP} mb-1`}><span className="font-semibold">채택 근거 초안:</span> {reco.recommendation.rationale_draft}</p>}
              {reco.recommendation.what_would_change && <p className={`${CAP} mb-1`}><span className="font-semibold">권고가 뒤집히는 조건:</span> {reco.recommendation.what_would_change}</p>}
              {reco.recommendation.cautions.length > 0 && (
                <p className={`${CAP} text-[color:var(--amber-fg, var(--accent))] mb-1`}>⚠ {reco.recommendation.cautions.join(" / ")}</p>
              )}
              <p className={`${CAP} text-[color:var(--muted-fg)] mb-0`}>이 제안이 본 산출물: {reco.manifest.join(" · ")}</p>
            </>
          )}
        </div>
      )}

      {canBrief && (
        <div className="border border-[color:var(--border)] rounded-lg px-3 py-2" aria-label="게이트 판단">
          <h4 className="font-semibold text-[length:var(--fs-body)] mt-0 mb-1">게이트 판단</h4>
          {briefError && <p role="alert" className={`${CAP} text-[color:var(--red-fg)] mb-1`}>{briefError}</p>}
          {briefLoading && <p className={`${CAP} text-[color:var(--muted-fg)] mb-0`}>진행 산출물을 근거로 브리프를 작성하는 중...</p>}
          {!brief && !briefLoading && !briefError && (
            <p className={`${CAP} text-[color:var(--muted-fg)] mb-0`}>AI가 진행 산출물을 근거로 권고와 근거 초안을 작성해 줍니다 — 기록은 사람의 몫입니다.</p>
          )}
          {brief && <GateBriefBody briefData={brief} currentGate={gate} onApply={onApplyRationale} />}
        </div>
      )}
    </section>
  );
}
