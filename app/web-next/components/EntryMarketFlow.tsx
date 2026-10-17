"use client";

// EntryMarketFlow - the consolidated 진입시장 산정 card (ADR-0179), now the
// 2026-10-17 decider-feedback revision of the entry-market flow redesign:
// the PR 615 3-tab structure is REVERTED. The three steps render STACKED
// and always visible in one flow (section headers `1. S1 링크` /
// `2. 대상 범위` / `3. 진입시장 유도`, each carrying its status chip; step 1
// also the newer-version hint). Gating is unchanged: steps 2-3 editors
// disabled with a reason when unlinked; step 3 keeps the 범위 미설정
// warning when linked-but-scope-unset. This component owns ALL loading
// (target-scope GET, entry-market derivation GET, sizing-link versions GET
// - one fetch each). A single FlowState (pure derivation in
// lib/entry-market-flow-state.ts) drives the step headers, the persistent
// card-header status strip and the gating/warnings. Link-change
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
  type LegacyAnchor,
  TAB1_LABEL,
  TAB2_LABEL,
  TAB3_LABEL,
} from "../lib/entry-market-flow-state.ts";
import { type TargetScope } from "../lib/target-scope.ts";
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
  // ADR-0181 additive record inputs:
  market_brief: string | null;
  currency: string | null;
  growth_rate: number | null;
  fx: Array<{ currency: string; rate: number; volatility: number | null; set_by: string; set_at: string }>;
  matrix_regions: Array<{ code: string; label: string; weight: number }>;
  matrix_segments: Array<{ code: string; label: string }>;
  region_trends: Array<{ region: string; segments: Array<{ code: string; baseline: number | null; cagr: number | null }> }>;
}

/** The anchor currency suggested from the scope's unit basis (ADR-0181 §4):
 *  usd_m_year → USD, eur_m_year → EUR, krw_m_year / units_year → null (no FX
 *  needed). Unknown <ccy>_m_year patterns yield the upper-cased prefix. */
export function suggestedAnchorCurrency(unitBasis: string | null | undefined): string | null {
  if (!unitBasis) return null;
  if (unitBasis === "krw_m_year" || unitBasis === "units_year") return null;
  const m = unitBasis.match(/^([a-z]{3})_[mb]_year$/);
  return m ? m[1].toUpperCase() : null;
}

interface SizingVersionOption {
  id: string;
  version_no: number;
  industry_name: string;
  scope: { regions: string[]; segments: string[]; unit_basis: string | null } | null;
  confidence_grade: string | null;
  completed_at: string | null;
}

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

  // ── ADR-0181 slice 2/3: 진입 시장 정보 (market_brief) + 다통화 기준 환율 ──
  const [brief, setBrief] = useState<string>("");
  const [fxRows, setFxRows] = useState<Array<{ currency: string; rate: string; volatility: string }>>([]);
  const [metaBusy, setMetaBusy] = useState(false);
  useEffect(() => {
    setBrief(flow?.market_brief ?? "");
    setFxRows((flow?.fx ?? []).map((r) => ({ currency: r.currency, rate: String(r.rate), volatility: r.volatility != null ? String(r.volatility) : "" })));
  }, [flow?.market_brief, flow?.fx]);
  const anchorCurrencySuggestion = suggestedAnchorCurrency(flow?.scope_unit_basis ?? null);
  async function saveMeta() {
    setMetaBusy(true); setError(null); setNotice(null);
    try {
      const body: Record<string, unknown> = {};
      if ((flow?.market_brief ?? "") !== brief) body.market_brief = brief.trim() === "" ? null : brief.trim();
      const parsedFx = fxRows
        .filter((r) => r.currency.trim() !== "" && r.rate.trim() !== "")
        .map((r) => ({
          currency: r.currency.trim().toUpperCase(),
          rate: Number(r.rate),
          volatility: r.volatility.trim() === "" ? null : Number(r.volatility),
        }));
      for (const r of parsedFx) {
        if (!/^[A-Z]{3}$/.test(r.currency) || r.currency === "KRW") throw new Error(`환율 통화 ${r.currency}는 3자 대문자 코드(KRW 제외)여야 합니다.`);
        if (!Number.isFinite(r.rate) || r.rate <= 0) throw new Error(`${r.currency} 환율은 0보다 큰 숫자여야 합니다.`);
        if (r.volatility != null && (!Number.isFinite(r.volatility) || r.volatility < 0 || r.volatility > 0.5)) {
          throw new Error(`${r.currency} 변동폭은 0~0.5 비율이어야 합니다 (예: 0.10 = ±10%).`);
        }
      }
      if (JSON.stringify(parsedFx) !== JSON.stringify((flow?.fx ?? []).map((r) => ({ currency: r.currency, rate: r.rate, volatility: r.volatility })))) {
        body.fx = parsedFx;
      }
      if (Object.keys(body).length === 0) {
        setNotice("변경된 내용이 없습니다.");
        return;
      }
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}/entry-market-derivation`, body);
      setNotice("진입 시장 정보·환율을 저장했습니다.");
      await refetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setMetaBusy(false);
    }
  }

  const flowState = deriveFlowState({
    linkProvenance: provenance,
    newerVersionAvailable: flow?.newer_version_available ?? false,
    scopeSet,
    derivationSet,
    computed: flow?.computed ?? null,
    legacyAnchor: flow?.legacy_anchor ?? null,
    s1: linked ? { version_no: linked.version_no, confidence_grade: linked.confidence_grade } : null,
  });
  // 2026-10-17 decider decision: the PR 615 tab control is REVERTED — the
  // three steps render STACKED and always visible; the step labels stay as
  // section headers with their status chips; gating is unchanged.
  const newerHintOnStep1 = flowState.warnings.staleLine != null;

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

      {/* Stacked steps (2026-10-17 decider decision: the PR 615 tab control
          is REVERTED) - every step header and body always visible in one
          flow. Step 1 body - S1 link dropdown (completed versions of the
          opportunity's industry, newest first), auto provenance chip and
          연결 해제. With a derivation chain present, changing the version or
          unlinking first shows the confirm-styled inline warnings below
          (proceed = the SAME human-only PUT). */}
      <div data-testid="entry-flow-steps">
      <section aria-label={TAB1_LABEL} data-testid="entry-flow-step-section-link">
        <h4 className="text-[length:var(--fs-body)] font-semibold mt-2 mb-1 flex items-center gap-1 flex-wrap">
          {TAB1_LABEL}
          <span className={chipClass(flowState.chips.step1.tone)} data-testid="entry-flow-step-link">{flowState.chips.step1.label}</span>
          {newerHintOnStep1 && (
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="entry-flow-newer-hint">
              더 최신 S1 버전 있음
            </span>
          )}
        </h4>
        <div className="border-b border-[color:var(--border)] pb-2 mb-2" data-testid="entry-flow-link-step">
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
      </section>

      {/* Steps 2-3 - stacked, always visible (PR 615 tab control REVERTED).
          Their editors stay gated (disabled with reason when unlinked); with
          a link but no scope, step 3 keeps the 범위 미설정 warning. Props-fed:
          the parent owns ALL loading, children only edit + save through the
          same PUTs. ADR-0181: step 2 feeds the editor the S1 matrix's own
          regions/segments (S1 frozen — read-only), and the integrated flow
          gains the market-brief input and the per-currency FX editor between
          steps 2 and 3. */}
      <section aria-label={TAB2_LABEL} data-testid="entry-flow-step-section-scope">
        <h4 className="text-[length:var(--fs-body)] font-semibold mt-2 mb-1 flex items-center gap-1 flex-wrap">
          {TAB2_LABEL}
          <span className={chipClass(flowState.chips.step2.tone)} data-testid="entry-flow-step-scope">{flowState.chips.step2.label}</span>
        </h4>
        <div data-testid="entry-flow-scope-step" className="mb-2">
          <TargetScopeEditor
            opportunityId={opportunityId}
            canAct={canAct && enabled}
            linked={linked}
            scope={scope}
            matrixRegions={flow?.matrix_regions ?? []}
            matrixSegments={flow?.matrix_segments ?? []}
            disabledReason={flowState.warnings.disableReason}
            onSaved={async (saved) => {
              setScope(saved);
              await refetchAll();
            }}
          />
        </div>
      </section>

      {/* ADR-0181 slices 2+3 — 진입 시장 정보 (market_brief, the person's
          market context for the AI draft) and the PER-CURRENCY reference FX
          rates (개산 + Monte Carlo volatility source). One audited human PUT. */}
      <section aria-label="진입 시장 정보·기준 환율" data-testid="entry-flow-step-section-meta" className="market-section">
        <h4 className="text-[length:var(--fs-body)] font-semibold mt-2 mb-1 flex items-center gap-1 flex-wrap">
          진입 시장 정보 · 기준 환율
          <span className={chipClass(enabled ? "info" : "muted")}>{enabled ? "입력 가능" : "S1 연결 필요"}</span>
        </h4>
        {enabled ? (
          <div className="mb-2">
            <label className="text-[length:var(--fs-caption)] block mb-1">
              진입하고자 하는 시장에 대한 정보 (AI 배수 추천의 근거로 사용됩니다)
              <textarea
                className="sizing-new-input sizing-new-input-sm w-full"
                rows={2}
                maxLength={2000}
                value={brief}
                disabled={metaBusy}
                placeholder="예: 유럽 Stage V 규제 대응 건설장비용 유압 브레이커 — 신규 규제 수요 중심"
                onChange={(e) => setBrief(e.target.value)}
                data-testid="entry-flow-market-brief"
              />
            </label>
            <div className="text-[length:var(--fs-caption)] mb-1">
              기준 환율 (원/통화 — 개산과 환 리스크 변동폭의 기준)
              {anchorCurrencySuggestion && (
                <span className="ml-1 text-[color:var(--muted-fg)]">앵커 통화 제안: {anchorCurrencySuggestion}</span>
              )}
            </div>
            {fxRows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 mb-1" data-testid={`entry-flow-fx-row-${i}`}>
                <input aria-label="통화 코드" className="sizing-new-input sizing-new-input-sm" style={{ width: "5rem" }} value={r.currency}
                  disabled={metaBusy} onChange={(e) => setFxRows((cur) => cur.map((x, j) => (j === i ? { ...x, currency: e.target.value.toUpperCase() } : x)))} />
                <input aria-label="원/통화 환율" className="sizing-new-input sizing-new-input-sm" style={{ width: "8rem" }} placeholder="예: 1400" value={r.rate}
                  disabled={metaBusy} onChange={(e) => setFxRows((cur) => cur.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
                <input aria-label="변동폭 (비율)" className="sizing-new-input sizing-new-input-sm" style={{ width: "8rem" }} placeholder="변동폭 0.10" value={r.volatility}
                  disabled={metaBusy} onChange={(e) => setFxRows((cur) => cur.map((x, j) => (j === i ? { ...x, volatility: e.target.value } : x)))} />
                <button type="button" className="btn-ghost btn-sm" disabled={metaBusy}
                  onClick={() => setFxRows((cur) => cur.filter((_, j) => j !== i))}>삭제</button>
              </div>
            ))}
            {canAct && (
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <button type="button" className="btn-ghost btn-sm" disabled={metaBusy}
                  onClick={() => setFxRows((cur) => [...cur, { currency: anchorCurrencySuggestion ?? "", rate: "", volatility: "0.1" }])}
                  data-testid="entry-flow-fx-add">
                  통화 추가
                </button>
                <button type="button" className="btn-ghost btn-sm" disabled={metaBusy} onClick={() => void saveMeta()} data-testid="entry-flow-meta-save">
                  진입 시장 정보·환율 저장
                </button>
                {flow?.currency && (
                  <span className="text-[color:var(--muted-fg)]">
                    앵커 통화: {flow.currency}
                    {(flow?.fx ?? []).some((r) => r.currency === flow.currency)
                      ? ""
                      : " — 기준 환율 미설정 (개산·환 리스크 비활성)"}
                  </span>
                )}
              </div>
            )}
            {canAct && anchorCurrencySuggestion && !(flow?.fx ?? []).some((r) => r.currency === anchorCurrencySuggestion) && fxRows.length === 0 && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                앵커가 {anchorCurrencySuggestion} 기준입니다 — 통화 추가로 기준 환율을 설정하세요.
              </p>
            )}
          </div>
        ) : (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            S1 시장규모 분석을 연결하면 진입 시장 정보와 기준 환율을 입력할 수 있습니다.
          </p>
        )}
      </section>
      <section aria-label={TAB3_LABEL} data-testid="entry-flow-step-section-derivation">
        <h4 className="text-[length:var(--fs-body)] font-semibold mt-2 mb-1 flex items-center gap-1 flex-wrap">
          {TAB3_LABEL}
          <span className={chipClass(flowState.chips.step3.tone)} data-testid="entry-flow-step-derivation">{flowState.chips.step3.label}</span>
        </h4>
        <div data-testid="entry-flow-derivation-step">
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
              growth_rate: flow.growth_rate,
              currency: flow.currency,
              region_trends: flow.region_trends,
            } : null}
            onDataChanged={refetchAll}
          />
        </div>
      </section>
      </div>
    </section>
  );
}

