"use client";

// EntryMarketFlow - the consolidated 진입시장 산정 card (ADR-0179), now the
// 2026-10-17 entry-market flow redesign slice 1: ONE card, one state, one
// fetch. This component owns ALL loading (target-scope GET, entry-market
// derivation GET, sizing-link versions GET - one fetch each; the two step
// panels are pure presentational views fed by props). A single FlowState
// (pure derivation in lib/entry-market-flow-state.ts) drives the tabs, the
// persistent card-header status strip (state chip + linked S1 + the
// anchor-in-force line) and every tab's gating/warnings. Link-change
// reactions (design §5.3/OD-6): changing the linked S1 version with a
// derivation chain present shows a confirm-styled inline warning before the
// SAME human-only PUT (warn, never block); clearing the link with a chain
// present warns the chain becomes unreachable (GET 409 not_linked) and the
// anchor falls back to legacy.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import {
  deriveFlowState,
  NO_COMPLETED_VERSIONS,
  VERSION_PLACEHOLDER,
  REPIN_WARNING,
  UNLINK_CHAIN_WARNING,
  type LinkProvenance,
  type EntryTabKey,
  type EntryTab,
  type LegacyAnchor,
  TAB1_LABEL,
  TAB2_LABEL,
  TAB3_LABEL,
  NEWER_HINT,
} from "../lib/entry-market-flow-state.ts";
import { type TargetScope } from "../lib/target-scope.ts";
import { TabNav } from "./TabNav.tsx";
import { TargetScopeEditor, type LinkedSizingReference } from "./TargetScopeEditor.tsx";
import { EntryMarketDerivationPanel, type EntryMarketDerivationData } from "./EntryMarketDerivationPanel.tsx";

interface FlowStatusResponse {
  link: { analysis_id: string; version_id: string } | null;
  link_provenance: LinkProvenance;
  newer_version_available: boolean;
  derivation: { steps: Array<Record<string, unknown>>; set_by: string; set_at: string | null } | null;
  computed: { anchor_value_krw_m: number; factor_product: number; entry_market_krw_m: number; steps: Array<{ base: string; factor: number; input: number; result: number }> } | null;
  reference: { version_no: number; confidence_grade: string | null; href: string; anchor_value_krw_m: number | null } | null;
  scope_flag: { status: string; reason: string; note: string } | null;
  confidence: { lowering_count: number; note: string } | null;
  region_caveat: string | null;
  max_steps: number;
  scope_set: boolean;
  scope_unit_basis: string | null;
  legacy_anchor: LegacyAnchor | null;
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
  // One source of truth - owned here, fed to every tab as props.
  const [linked, setLinked] = useState<LinkedSizingReference | null>(null);
  const [scope, setScope] = useState<TargetScope | null>(null);
  const [scopeLoaded, setScopeLoaded] = useState(false);
  const [flow, setFlow] = useState<FlowStatusResponse | null>(null);
  const [versionOptions, setVersionOptions] = useState<SizingVersionOption[]>([]);
  const [versionOptionsLoaded, setVersionOptionsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Confirm-styled inline warnings (warn, never block - design §5.3/OD-6).
  const [pendingRepin, setPendingRepin] = useState<string | null>(null);
  const [pendingUnlink, setPendingUnlink] = useState(false);
  // Page-local view state - switching tabs is NOT a route change.
  const [activeTab, setActiveTab] = useState<EntryTabKey>("link");

  const loadScope = useCallback(async () => {
    try {
      const r = await api.get<{ scope: TargetScope | null; linked_sizing: LinkedSizingReference | null }>(
        `/api/opportunities/${encodeURIComponent(opportunityId)}/target-scope`);
      setScope(r.data.scope ?? null);
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
      setFlow(r.data);
      setError(null);
    } catch {
      // 409 not_linked - the honest unlinked state, never a blocking failure.
      setFlow(null);
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

  const refetchAll = useCallback(async () => {
    await Promise.all([loadScope(), loadFlow()]);
  }, [loadScope, loadFlow]);

  async function doPin(versionId: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}/sizing-link`, { version_id: versionId });
      setPendingRepin(null);
      setNotice("S1 시장규모 분석을 연결했습니다.");
      await refetchAll();
    } catch (err) { setError(err instanceof Error ? err.message : "연결 실패"); }
    finally { setBusy(false); }
  }

  // Selecting a dropdown option pins via the EXISTING human-only governed
  // PUT (/sizing-link {version_id}). With a derivation chain present the
  // person first sees the confirm-styled re-pin warning; proceeding runs
  // the SAME PUT (warn, never block - OD-6).
  async function selectVersion(versionId: string) {
    if (!versionId || versionId === (linked?.version_id ?? "")) return;
    if (flow?.derivation != null) {
      setPendingRepin(versionId);
      return;
    }
    await doPin(versionId);
  }

  async function doUnlink() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}/sizing-link`, { analysis_id: null, version_id: null });
      setPendingUnlink(false);
      setNotice("연결을 해제했습니다.");
      await refetchAll();
    } catch (err) { setError(err instanceof Error ? err.message : "해제 실패"); }
    finally { setBusy(false); }
  }

  function unlinkVersion() {
    if (flow?.derivation != null) {
      setPendingUnlink(true);
      return;
    }
    void doUnlink();
  }

  const provenance: LinkProvenance = flow?.link_provenance ?? "none";
  const enabled = provenance !== "none";
  const scopeSet = scope != null;
  const derivationSet = flow?.derivation != null;
  const flowState = deriveFlowState({
    linkProvenance: provenance,
    newerVersionAvailable: flow?.newer_version_available ?? false,
    scopeSet,
    derivationSet,
    computed: flow?.computed ?? null,
    legacyAnchor: flow?.legacy_anchor ?? null,
    s1: linked ? { version_no: linked.version_no, confidence_grade: linked.confidence_grade } : null,
  });
  const tabs: EntryTab[] = [
    { key: "link", label: TAB1_LABEL, chip: flowState.chips.step1, locked: false, newerHint: flowState.warnings.staleLine != null ? NEWER_HINT : null },
    { key: "scope", label: TAB2_LABEL, chip: flowState.chips.step2, locked: provenance === "none", newerHint: null },
    { key: "derivation", label: TAB3_LABEL, chip: flowState.chips.step3, locked: provenance === "none", newerHint: null },
  ];

  const currentValue = linked?.version_id ?? "";

  return (
    <section aria-label="진입시장 산정 (entry market, ADR-0179)" className="market-section" data-testid="entry-flow">
      <h3 className="text-[length:var(--fs-body)] font-semibold mb-1">
        진입시장 산정 <span className="status-chip status-info">ADR-0179</span>
      </h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        S1 시장규모 분석을 연결하고, 이 딜의 실제 대상 범위를 사람이 기록한 뒤, 배율 인자 사슬로 진입 시장을 도출하는 3단계 흐름입니다.
      </p>

      {/* Persistent card-header status strip (design §5.1/§5.5) - the single
          place the anchor-in-force appears; visible in every tab. */}
      <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-caption)] mb-2" data-testid="entry-flow-header-strip">
        <span className={chipClass(flowState.header.stateChipTone)} data-testid="entry-flow-header-state">{flowState.header.stateChipLabel}</span>
        {flowState.header.s1Line && <span data-testid="entry-flow-header-s1">{flowState.header.s1Line}</span>}
        <span data-testid="entry-flow-header-anchor">{flowState.header.anchorLine}</span>
        {flowState.warnings.staleLine && (
          <span className="text-[color:var(--muted-fg)]" data-testid="entry-flow-header-stale">{flowState.warnings.staleLine}</span>
        )}
      </div>

      {/* Tab control - each tab keeps its own status chip as its marker; tab 1
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

      {/* Step 1 body - S1 link dropdown (completed versions of the
          opportunity's industry, newest first), auto provenance chip and
          연결 해제. With a derivation chain present, changing the version or
          unlinking first shows the confirm-styled inline warnings below
          (proceed = the SAME human-only PUT). */}
      {activeTab === "link" && (
        <div className="border-b border-[color:var(--border)] pb-2 mb-2" data-testid="entry-flow-link-step" id={TAB_PANEL_ID.link} role="tabpanel" aria-label="S1 링크">
          <div className="text-[length:var(--fs-caption)] mb-1">
            {provenance === "auto" && <span className="status-chip status-info" data-testid="entry-market-link-auto">자동 연결</span>}
            {provenance === "manual" && <span data-testid="entry-market-link-manual">(수동 연결)</span>}
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
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={unlinkVersion}>연결 해제</button>
              )}
            </div>
          )}
          {/* Confirm-styled inline warnings - warn, never block (OD-6). */}
          {pendingRepin && (
            <div className="mt-1 mb-1 text-[length:var(--fs-caption)]" data-testid="entry-flow-repin-warning" role="alert">
              <span className="status-chip status-warn">앵커 재연결</span> {REPIN_WARNING}
              <span className="flex flex-wrap items-center gap-2 mt-1">
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void doPin(pendingRepin)} data-testid="entry-flow-repin-confirm">그래도 진행</button>
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setPendingRepin(null)}>취소</button>
              </span>
            </div>
          )}
          {pendingUnlink && (
            <div className="mt-1 mb-1 text-[length:var(--fs-caption)]" data-testid="entry-flow-unlink-warning" role="alert">
              <span className="status-chip status-warn">연결 해제</span> {UNLINK_CHAIN_WARNING}
              <span className="flex flex-wrap items-center gap-2 mt-1">
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void doUnlink()} data-testid="entry-flow-unlink-confirm">그래도 진행</button>
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setPendingUnlink(false)}>취소</button>
              </span>
            </div>
          )}
          {canAct && versionOptionsLoaded && versionOptions.length === 0 && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid="entry-flow-no-versions">
              {NO_COMPLETED_VERSIONS}
            </p>
          )}
          {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1">{error}</p>}
          {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-1">{notice}</p>}
        </div>
      )}

      {/* Steps 2-3 bodies - one visible at a time. Locked tabs stay visible
          and their bodies render the disable reason; with a link but no
          scope, step 3 keeps the 범위 미설정 warning. Props-fed: the parent
          owns ALL loading, children only edit + save through the same PUTs. */}
      {activeTab === "scope" && (
        <div data-testid="entry-flow-scope-step" id={TAB_PANEL_ID.scope} role="tabpanel" aria-label="대상 범위" className="mb-2">
          <TargetScopeEditor
            opportunityId={opportunityId}
            canAct={canAct && enabled}
            linked={linked}
            scope={scope}
            disabledReason={flowState.warnings.disableReason}
            onSaved={async (saved) => {
              setScope(saved);
              await refetchAll();
            }}
          />
        </div>
      )}
      {activeTab === "derivation" && (
        <div id={TAB_PANEL_ID.derivation} role="tabpanel" aria-label="진입시장 유도">
          <EntryMarketDerivationPanel
            opportunityId={opportunityId}
            canAct={canAct && enabled}
            scopeSet={scopeSet}
            disabledReason={flowState.warnings.disableReason}
            scopeWarning={flowState.warnings.scopeWarning}
            data={flow ? {
              reference: flow.reference ?? null,
              newer_version_available: flow.newer_version_available,
              derivation: flow.derivation,
              computed: flow.computed,
              scope_flag: flow.scope_flag,
              confidence: flow.confidence,
              region_caveat: flow.region_caveat,
              max_steps: flow.max_steps,
            } : null}
            onDataChanged={refetchAll}
          />
        </div>
      )}
    </section>
  );
}
