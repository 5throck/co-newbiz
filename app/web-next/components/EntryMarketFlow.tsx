"use client";

// EntryMarketFlow — ADR-0179 presentational consolidation (2026-10-17
// decider feedback): the two previously disconnected S2 panels
// (TargetScopeEditor 대상 범위 + EntryMarketDerivationPanel 진입 시장 도출)
// become ONE card, 진입시장 산정 (ADR-0179), with a 3-step status rail.
// PRESENTATIONAL only — every route, audited write path and API payload is
// unchanged: the same GET endpoints are read (target-scope for the scope +
// linked S1 reference, entry-market-derivation for the link provenance and
// derivation presence) and the step components keep issuing the same
// human-only PUTs. Step gating: without an S1 link steps 2-3 render disabled
// with the reason and the path forward; with a link but no scope, step 3
// shows a warning that the scope verdict cannot be graded. The gating
// derivation itself is pure and lives in lib/entry-market-flow.ts.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { deriveEntryFlowStatus, type LinkProvenance } from "../lib/entry-market-flow.ts";
import { TargetScopeEditor, type LinkedSizingReference } from "./TargetScopeEditor.tsx";
import { EntryMarketDerivationPanel } from "./EntryMarketDerivationPanel.tsx";

interface FlowStatusResponse {
  link: { analysis_id: string; version_id: string } | null;
  link_provenance: LinkProvenance;
  newer_version_available: boolean;
  derivation: { steps: Array<Record<string, unknown>>; set_by: string; set_at: string } | null;
}

const STEP_TITLES = ["S1 링크", "대상 범위", "진입시장 유도"] as const;

function chipClass(tone: "info" | "warn" | "muted"): string {
  return tone === "info" ? "status-chip status-info" : tone === "warn" ? "status-chip status-warn" : "status-chip status-not-started";
}

export function EntryMarketFlow({ opportunityId, canAct }: { opportunityId: string; canAct: boolean }) {
  // Step-1 link state — owned here so the rail, the link management and the
  // gating of steps 2-3 share one source of truth.
  const [linked, setLinked] = useState<LinkedSizingReference | null>(null);
  const [scopeLoaded, setScopeLoaded] = useState(false);
  const [provenance, setProvenance] = useState<LinkProvenance>("none");
  const [newerVersion, setNewerVersion] = useState(false);
  const [derivationSet, setDerivationSet] = useState(false);
  const [versionInput, setVersionInput] = useState("");
  const [scopeSet, setScopeSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadScope = useCallback(async () => {
    try {
      const r = await api.get<{ scope: unknown; linked_sizing: LinkedSizingReference | null }>(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/target-scope`);
      setLinked(r.data.linked_sizing ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setScopeLoaded(true);
    }
  }, [opportunityId]);

  const loadFlow = useCallback(async () => {
    try {
      const r = await api.get<FlowStatusResponse>(`/api/opportunities/${encodeURIComponent(opportunityId)}/entry-market-derivation`);
      setProvenance(r.data.link_provenance);
      setNewerVersion(r.data.newer_version_available);
      setDerivationSet(r.data.derivation != null);
    } catch {
      // 409 not_linked — the honest unlinked state, never a blocking failure.
      setProvenance("none");
      setNewerVersion(false);
      setDerivationSet(false);
    }
  }, [opportunityId]);

  useEffect(() => {
    void loadScope();
    void loadFlow();
  }, [loadScope, loadFlow]);

  async function linkVersion() {
    const versionId = versionInput.trim();
    if (!versionId) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}/sizing-link`, { version_id: versionId });
      setVersionInput("");
      setNotice("S1 시장규모 분석을 연결했습니다.");
      await Promise.all([loadScope(), loadFlow()]);
    } catch (err) { setError(err instanceof Error ? err.message : "연결 실패"); }
    finally { setBusy(false); }
  }

  async function unlinkVersion() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}/sizing-link`, { analysis_id: null, version_id: null });
      setNotice("연결을 해제했습니다.");
      await Promise.all([loadScope(), loadFlow()]);
    } catch (err) { setError(err instanceof Error ? err.message : "해제 실패"); }
    finally { setBusy(false); }
  }

  const flow = deriveEntryFlowStatus({ linkProvenance: provenance, newerVersionAvailable: newerVersion, scopeSet, derivationSet });
  const enabled = flow.steps23Enabled;

  return (
    <section aria-label="진입시장 산정 (entry market, ADR-0179)" className="market-section" data-testid="entry-flow">
      <h3 className="text-[length:var(--fs-body)] font-semibold mb-1">
        진입시장 산정 <span className="status-chip status-info">ADR-0179</span>
      </h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        S1 시장규모 분석을 연결하고, 이 딜의 실제 대상 범위를 사람이 기록한 뒤, 배율 인자 사슬로 진입 시장을 도출하는 3단계 흐름입니다.
      </p>

      {/* 3-step status rail — chips only, pure presentation. */}
      <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="entry-flow-rail">
        {([flow.step1, flow.step2, flow.step3] as const).map((chip, i) => (
          <span key={i} className="flex items-center gap-1" data-testid={`entry-flow-step-${i + 1}`}>
            <span className="text-[length:var(--fs-caption)] font-semibold">{i + 1}. {STEP_TITLES[i]}</span>
            <span className={chipClass(chip.tone)}>{chip.label}</span>
          </span>
        ))}
        {flow.newerHint && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="entry-flow-newer-hint">더 최신 S1 버전 있음 — 수동 연결은 유지됩니다</span>}
      </div>

      {/* Step 1 — S1 link provenance chip + manual link/unlink management
          (moved verbatim from the former TargetScopeEditor slot). */}
      <div className="border-b border-[color:var(--border)] pb-2 mb-2" data-testid="entry-flow-link-step">
        <div className="text-[length:var(--fs-caption)] mb-1">
          <span className="status-chip status-info">S1 링크</span>{" "}
          {provenance === "auto" && <span className="status-chip status-info" data-testid="entry-market-link-auto">자동 연결</span>}
          {provenance === "manual" && <span className="text-[color:var(--muted-fg)]" data-testid="entry-market-link-manual">(수동 연결)</span>}
          {provenance === "none" && scopeLoaded && <span className="text-[color:var(--muted-fg)]" data-testid="entry-market-not-linked">연결된 S1 시장규모 분석이 없습니다 — 1단계에서 버전 ID로 연결하세요.</span>}
        </div>
        {canAct && (
          <div className="flex flex-wrap items-center gap-2" data-testid="target-scope-link-management">
            <input aria-label="연결할 S1 시장규모 버전 ID" placeholder="연결할 시장규모 버전 ID" value={versionInput}
              onChange={(e) => setVersionInput(e.target.value)} className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 12rem" }} />
            <button type="button" className="btn-ghost btn-sm" disabled={busy || versionInput.trim() === ""} onClick={() => void linkVersion()}>연결</button>
            {linked && (
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void unlinkVersion()}>연결 해제</button>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1">{error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-1">{notice}</p>}
      </div>

      {/* Step 2 — target scope (existing editor, now link-gated). */}
      <div className="border-b border-[color:var(--border)] pb-2 mb-2" data-testid="entry-flow-scope-step">
        <TargetScopeEditor
          opportunityId={opportunityId}
          canAct={canAct && enabled}
          linked={linked}
          disabledReason={flow.disableReason}
          onScopeChange={setScopeSet}
        />
      </div>

      {/* Step 3 — entry-market derivation (existing panel, now link-gated +
          scope-warned). */}
      <EntryMarketDerivationPanel
        opportunityId={opportunityId}
        canAct={canAct && enabled}
        scopeSet={scopeSet}
        disabledReason={flow.disableReason}
        scopeWarning={flow.step3ScopeWarning}
        onDataChanged={async () => { await Promise.all([loadScope(), loadFlow()]); }}
      />
    </section>
  );
}
