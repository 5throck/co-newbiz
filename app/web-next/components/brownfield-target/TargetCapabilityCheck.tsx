"use client";

// S7 `필요 역량 점검` (ADR-0171 slice 2): the per-target required-capability judgement, shown inside the
// technical evaluation card of the target detail. Shortlisted targets only (the selected target is one of
// them); long-list targets get a disabled note. Reuses the shared judgement editor against the
// target-scoped routes, so save/confirm/stale/history behave exactly like S5. It also surfaces the criteria
// reconcile detection (S3 rows added/removed/renamed after the criteria were seeded) with an explicit
// "S3 변경 반영" action. Confirmation is a human click on the editor's 판정 확정; AI output is never a decision.
import { useState } from "react";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../lib/project-write-access.ts";
import { CapabilityJudgementEditor } from "../stages/CapabilityJudgementEditor.tsx";
import type { ReconcilePlan } from "./types.ts";

export function TargetCapabilityCheck({ targetId, oppId, status, reconcile, refreshKey, onChanged }: {
  targetId: string;
  oppId: string;
  status: "pending" | "shortlisted" | "excluded";
  reconcile: ReconcilePlan | null | undefined;
  /** Changes when this target's technical verdicts changed, so the editor refetches (unsaved drafts are kept). */
  refreshKey: string;
  /** Called after a reconcile so the page reloads the criteria and scores. */
  onChanged: () => void;
}) {
  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bump, setBump] = useState(0);

  async function applyReconcile() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/brownfield/${encodeURIComponent(oppId)}/eval-criteria/reconcile`, {});
      setBump((n) => n + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "평가 기준을 맞추지 못했습니다.");
    } finally { setBusy(false); }
  }

  const out = reconcile && !reconcile.inSync ? reconcile : null;
  return (
    <section className="mt-3" aria-label="필요 역량 점검">
      <h5 className="text-[0.88rem] mb-1">필요 역량 점검 — 이 대상이 S3의 필요 역량을 확보·해소할 수 있는가</h5>
      {out && (
        <div className="legacy-model-notice mb-2" role="alert" data-testid="reconcile-notice">
          <p className="legacy-model-notice-text">
            S3 필요 역량과 S7 기술 평가 기준이 맞지 않습니다 —
            {out.missing.length > 0 && <> 추가된 역량 {out.missing.length}건({out.missing.slice(0, 3).map((m) => m.capability).join(", ")}{out.missing.length > 3 ? " 외" : ""})</>}
            {out.retire.length > 0 && <> · 삭제된 역량 {out.retire.length}건(기준만 보관 처리, 평가·판정 기록은 유지)</>}
            {out.relabel.length > 0 && <> · 이름이 바뀐 역량 {out.relabel.length}건</>}
            {out.reinstate.length > 0 && <> · 다시 생긴 역량 {out.reinstate.length}건</>}.
            사람이 입력한 가중치·판정은 지우지 않습니다.
          </p>
          {canAct && (
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void applyReconcile()}>
              {busy ? "반영 중…" : "S3 변경 반영 (평가 기준 맞추기)"}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}
      {status !== "shortlisted" ? (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="capability-check-disabled">숏리스트 후 점검 — 필요 역량 점검은 최종 후보로 선정된 대상에만 합니다.</p>
      ) : (
        <CapabilityJudgementEditor
          endpoint={`/api/brownfield/targets/${encodeURIComponent(targetId)}/capability-judgements`}
          s3Href={`/deals/${encodeURIComponent(oppId)}/s3`}
          refreshKey={`${refreshKey}:${bump}`}
          intro="이 대상이 S3에서 정의한 필요 역량을 확보할 수 있는지 사람이 판정합니다 — 판정과 확정은 대상별로 따로 하며, 위 기술 평가 항목의 판정·노트가 바뀌면 이 대상의 판정만 재판정 대상이 됩니다. 사업성 수치에 자동 반영되지 않으며 게이트·등급을 막지 않습니다."
        />
      )}
    </section>
  );
}
