"use client";

// EntryMarketFlow — ADR-0179 presentational consolidation (2026-10-17
// decider feedback): the two previously disconnected S2 panels
// (TargetScopeEditor + EntryMarketDerivationPanel) become ONE card,
// 진입시장 산정 (ADR-0179), now a TAB control (TabNav, page-local
// active-tab state — not a route change). Each tab renders its own step
// body, one at a time; each tab keeps its own status chip and tab 1
// carries the newer-version hint. Gating unchanged: locked tabs stay
// VISIBLE and their bodies render the disable reason; link-without-scope
// keeps the step-3 warning. Step 1 replaces the raw version-ID text input
// + 연결 button with a DROPDOWN of the industry's completed S1 versions
// (additive GET /api/opportunities/[id]/sizing-link/versions); selecting
// a version performs the SAME human-only governed PUT on /sizing-link —
// no new write path. 연결 해제 stays. The default selection is the
// auto-linked (latest completed) version. The gating/tab derivation is
// pure and lives in lib/entry-market-flow.ts.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import {
  deriveEntryFlowStatus,
  deriveEntryTabs,
  NO_COMPLETED_VERSIONS,
  VERSION_PLACEHOLDER,
  type LinkProvenance,
  type EntryTabKey,
} from "../lib/entry-market-flow.ts";
import { TabNav } from "./TabNav.tsx";
import { TargetScopeEditor, type LinkedSizingReference } from "./TargetScopeEditor.tsx";
import { EntryMarketDerivationPanel } from "./EntryMarketDerivationPanel.tsx";

interface FlowStatusResponse {
  link: { analysis_id: string; version_id: string } | null;
  link_provenance: LinkProvenance;
  newer_version_available: boolean;
  derivation: { steps: Array<Record<string, unknown>>; set_by: string; set_at: string | null } | null;
}

interface SizingVersionOption {
  id: string;
  version_no: number;
  industry_name: string;
  scope: { regions: string[]; segments: string[]; unit_basis: string | null } | null;
  confidence_grade: string | null;
  completed_at: string | null;
}

const TAB_PANEL_ID: Record<EntryTabKey, string> = {
  link: "entry-flow-panel-link",
  scope: "entry-flow-panel-scope",
  derivation: "entry-flow-panel-derivation",
};

function chipClass(tone: "info" | "warn" | "muted"): string {
  return tone === "info"
    ? "status-chip status-info"
    : tone === "warn"
      ? "status-chip status-warn"
      : "status-chip status-not-started";
}

export function EntryMarketFlow({ opportunityId, canAct }: { opportunityId: string; canAct: boolean }) {
  // Link state — owned here so the tabs, the dropdown-driven link
  // management and the gating of tabs 2-3 share one source of truth.
  const [linked, setLinked] = useState<LinkedSizingReference | null>(null);
  const [scopeLoaded, setScopeLoaded] = useState(false);
  const [provenance, setProvenance] = useState<LinkProvenance>("none");
  const [newerVersion, setNewerVersion] = useState(false);
  const [derivationSet, setDerivationSet] = useState(false);
  const [versionOptions, setVersionOptions] = useState<SizingVersionOption[]>([]);
  const [versionOptionsLoaded, setVersionOptionsLoaded] = useState(false);
  const [scopeSet, setScopeSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Page-local view state — switching tabs is NOT a route change.
  const [activeTab, setActiveTab] = useState<EntryTabKey>("link");

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

  const loadVersions = useCallback(async () => {
    try {
      const r = await api.get<{ versions: SizingVersionOption[] }>(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/sizing-link/versions`);
      setVersionOptions(r.data.versions ?? []);
    } catch {
      setVersionOptions([]); // degrade to an empty dropdown, never a blocking failure
    } finally {
      setVersionOptionsLoaded(true);
    }
  }, [opportunityId]);

  useEffect(() => {
    void loadScope();
    void loadFlow();
    void loadVersions();
  }, [loadScope, loadFlow, loadVersions]);

  // Selecting a dropdown option pins via the EXISTING human-only governed
  // PUT (/sizing-link {version_id}) — the same audited write path as before,
  // no new one. The default selection is the auto-linked latest completed
  // version (the dropdown preselects the current link).
  async function selectVersion(versionId: string) {
    if (!versionId || versionId === (linked?.version_id ?? "")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}/sizing-link`, { version_id: versionId });
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
  const tabs = deriveEntryTabs(flow);
  const enabled = flow.steps23Enabled;
  const active = tabs.find((t) => t.key === activeTab) ?? tabs[0];
  const currentValue = linked?.version_id ?? "";

  return (
    <section aria-label="진입시장 산정 (entry market, ADR-0179)" className="market-section" data-testid="entry-flow">
      <h3 className="text-[length:var(--fs-body)] font-semibold mb-1">
        진입시장 산정 <span className="status-chip status-info">ADR-0179</span>
      </h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        S1 시장규모 분석을 연결하고, 이 딜의 실제 대상 범위를 사람이 기록한 뒤, 배율 인자 사슬로 진입 시장을 도출하는 3단계 흐름입니다.
      </p>

      {/* Tab control — each tab keeps its own status chip as its marker; tab 1
          additionally carries the newer-version hint. Locked tabs 2-3 stay
          visible (chip + disabled reason inside their bodies). */}
      <div data-testid="entry-flow-rail">
        <TabNav
          tabs={tabs.map((t) => ({
            key: t.key,
            label: t.label,
            panelId: TAB_PANEL_ID[t.key],
            marker: (
              <span className="flex items-center gap-1">
                <span className={chipClass(t.chip.tone)} data-testid={`entry-flow-step-${t.key}`}>{t.chip.label}</span>
                {t.newerHint && (
                  <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="entry-flow-newer-hint">
                    더 최신 S1 버전 있음
                  </span>
                )}
              </span>
            ),
          }))}
          active={activeTab}
          onSelect={(k) => setActiveTab(k as EntryTabKey)}
          label="진입시장 산정 단계"
        />
      </div>

      {/* Step 1 body — S1 link dropdown (completed versions of the
          opportunity's industry, newest first), auto provenance chip and
          연결 해제. Default selection = the auto-linked latest completed
          version (the current link is preselected). */}
      {activeTab === "link" && (
        <div className="border-b border-[color:var(--border)] pb-2 mb-2" data-testid="entry-flow-link-step" id={TAB_PANEL_ID.link} role="tabpanel" aria-label="S1 링크">
          <div className="text-[length:var(--fs-caption)] mb-1">
            {provenance === "auto" && <span className="status-chip status-info" data-testid="entry-market-link-auto">자동 연결</span>}
            {provenance === "manual" && <span className="text-[color:var(--muted-fg)]" data-testid="entry-market-link-manual">(수동 연결)</span>}
            {provenance === "none" && scopeLoaded && (
              <span className="text-[color:var(--muted-fg)]" data-testid="entry-market-not-linked">연결된 S1 시장규모 분석이 없습니다 — 1단계에서 버전을 선택해 연결하세요.</span>
            )}
          </div>
          {canAct && (
            <div className="flex flex-wrap items-center gap-2" data-testid="target-scope-link-management">
              <select
                aria-label="연결할 S1 시장규모 버전"
                className="sizing-new-input sizing-new-input-sm"
                style={{ flex: "1 1 16rem" }}
                disabled={busy}
                value={currentValue}
                onChange={(e) => void selectVersion(e.target.value)}
                data-testid="entry-flow-version-select"
              >
                <option value="" disabled>{VERSION_PLACEHOLDER}</option>
                {versionOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {`v${v.version_no} · ${v.industry_name} · ${v.confidence_grade ?? "-"} · ${(v.completed_at ?? "").slice(0, 10)}`}
                  </option>
                ))}
              </select>
              {linked && (
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void unlinkVersion()}>연결 해제</button>
              )}
            </div>
          )}
          {canAct && versionOptionsLoaded && versionOptions.length === 0 && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid="entry-flow-no-versions">{NO_COMPLETED_VERSIONS}</p>
          )}
          {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1">{error}</p>}
          {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-1">{notice}</p>}
        </div>
      )}

      {/* Steps 2-3 bodies — one visible at a time. Locked tabs stay visible
          and their bodies render the disable reason (both panels take
          disabledReason and render it — the person sees why and what
          unlocks); with a link but no scope, step 3 keeps the warning. */}
      {activeTab === "scope" && (
        <div data-testid="entry-flow-scope-step" id={TAB_PANEL_ID.scope} role="tabpanel" aria-label="대상 범위" className="mb-2">
          <TargetScopeEditor
            opportunityId={opportunityId}
            canAct={canAct && enabled}
            linked={linked}
            disabledReason={flow.disableReason}
            onScopeChange={setScopeSet}
          />
        </div>
      )}
      {activeTab === "derivation" && (
        <div id={TAB_PANEL_ID.derivation} role="tabpanel" aria-label="진입시장 유도">
          <EntryMarketDerivationPanel
            opportunityId={opportunityId}
            canAct={canAct && enabled}
            scopeSet={scopeSet}
            disabledReason={flow.disableReason}
            scopeWarning={flow.step3ScopeWarning}
            onDataChanged={async () => { await Promise.all([loadScope(), loadFlow()]); }}
          />
        </div>
      )}
    </section>
  );
}
