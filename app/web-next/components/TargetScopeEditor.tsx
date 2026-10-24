"use client";

// TargetScopeEditor - ADR-0179 slice 1: the person-set structured target
// scope on the S2 opportunity detail. Step 2 (대상 범위) of the consolidated
// 진입시장 산정 card (EntryMarketFlow), now PROPS-FED (2026-10-17 entry-market
// flow redesign slice 1): the parent owns ALL loading and passes the scope +
// linked-S1 reference in; the editor's own GET is deleted. It only edits and
// saves through the SAME human-only PUT (routes and payloads unchanged).
// Amendment slice A reference display (linked S1 scope/anchor/confidence)
// stays. Redesign slice 4 (design §7/§5.2, OD-3): the unit_basis select moves
// OUT of the input row (regions + segments are the only person inputs) and
// renders as DATA inside the linked-S1 reference strip with the
// `앵커의 단위 구분 — 절대값 입력이 아닙니다` caption. unit_basis still rides
// the PUT body unchanged (the control merely moves; the value is initialized
// from the linked version's declared scope, falling back to krw_m_year).
import { TranslatorFn } from "../i18n/config.ts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { SCOPE_UNIT_BASIS_CAPTION, TARGET_SCOPE_REGIONS, TARGET_SCOPE_UNIT_BASIS_LABEL, resolveUnitBasis, type TargetScope, type TargetScopeUnitBasis } from "../lib/target-scope.ts";
import { extractSizingVersionScope } from "../lib/anchor-scope.ts";
import { useTranslations } from "next-intl";

/** Reference row of the LINKED S1 analysis/version: declared scope, anchor
 *  value, confidence grade and an href to open the S1 screen. Owned by the
 *  parent EntryMarketFlow and passed down. */
export interface LinkedSizingReference {
  analysis_id: string;
  version_id: string;
  version_no: number;
  scope: ReturnType<typeof extractSizingVersionScope>;
  anchor_value_krw_m: number | null;
  confidence_grade: string | null;
  href: string;
}

const REGION_LABEL = (tr: TranslatorFn): Record<string, string> => ({
  kr: "components.targetScope.editor.domesticKr", we: "components.targetScope.editor.westernEuropeWe", ee: "components.targetScope.editor.easternEuropeEe", ru: "components.targetScope.editor.russiaRu", na: "components.targetScope.editor.northAmericaNa", cn: "components.targetScope.editor.chinaCn", sea: "components.targetScope.editor.southeastAsiaSea", sa: "components.targetScope.editor.southAmericaSa", af: "components.targetScope.editor.africaAf", me: "components.targetScope.editor.middleEastMe", worldwide: "components.targetScope.editor.worldwide",
});

export function TargetScopeEditor({ opportunityId, canAct, linked, scope, matrixRegions, matrixSegments, disabledReason, onSaved }: {
  opportunityId: string;
  canAct: boolean;
  linked: LinkedSizingReference | null;
  scope: TargetScope | null;
  /** ADR-0181 slice 2 — the LINKED S1 matrix's own regions (read-only S1
   *  data): the entry region is picked FROM S1 when the matrix has any,
   *  falling back to the fixed enum. */
  matrixRegions: Array<{ code: string; label: string; weight: number }>;
  matrixSegments: Array<{ code: string; label: string }>;
  disabledReason: string | null;
  onSaved: (saved: TargetScope) => void | Promise<void>;
}) {const tr = useTranslations(); const t = useTranslations("components.targetScope.editor"); const tc = useTranslations("common");
  // Local form state, initialized from the parent-owned scope prop.
  const [regions, setRegions] = useState<string[]>([]);
  const [segments, setSegments] = useState("");
  // ADR-0181 §4: the resolved basis may be a multi-currency pattern
  // (`eur_m_year`, …) — the state carries the wider string form; the PUT body
  // and the label lookup both accept it.
  const [unitBasis, setUnitBasis] = useState<ReturnType<typeof resolveUnitBasis>>("krw_m_year");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Slice 4: unit_basis is no longer a person input — it is carried as data
  // for the PUT body. Initialized from the person-saved scope, falling back
  // to the LINKED version's declared unit_basis, then to krw_m_year.
  const applyScope = useCallback((s: TargetScope | null, l: LinkedSizingReference | null) => {
    setRegions(s?.regions ?? []);
    setSegments((s?.segments ?? []).join(", "));
    setUnitBasis(resolveUnitBasis(s?.unit_basis, l?.scope?.unit_basis ?? null));
  }, []);

  useEffect(() => {
    applyScope(scope, linked);
  }, [scope, linked, applyScope]);

  function toggleRegion(r: string) {
    if (r === "worldwide") {
      setRegions((cur) => (cur.includes("worldwide") ? [] : ["worldwide"]));
      return;
    }
    setRegions((cur) => {
      const next = cur.includes("worldwide") ? [r] : cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r];
      return next;
    });
  }

  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try {
      // ADR-0181 follow-up: unit_basis is NOT a scope input — the unit comes
      // from the linked S1 declaration (analysis unit_basis / $B convention).
      const body = {
        regions,
        segments: segments.split(",").map((s) => s.trim()).filter(Boolean),
      };
      const r = await api.put<{ scope: TargetScope }>(`/api/opportunities/${encodeURIComponent(opportunityId)}/target-scope`, body);
      await onSaved(r.data.scope);
      setNotice(t("targetScopeSaved"));
    } catch (err) { setError(err instanceof Error ? err.message : tc("saveFailed")); }
    finally { setBusy(false); }
  }

  if (!canAct && !scope && !disabledReason) return null;

  return (
    <section aria-label={t("targetScope")} className="market-section" data-testid="target-scope-editor">
      {/* ADR-0181: the section heading ("2. 대상 범위" + status chip) lives on
          the parent EntryMarketFlow step section — the child renders no title
          of its own (decider feedback 2026-10-18: the title appeared twice). */}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {t("theMarketScopeThisDeal")}
      </p>
      {disabledReason && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="target-scope-disabled">{disabledReason}</p>
      )}
      {scope && (
        <p className="text-[length:var(--fs-caption)] mb-2" data-testid="target-scope-current">
          {t("currentRegion")} {scope.regions.map((r) => REGION_LABEL(tr)[r] ?? r).join(" / ")}
          {t("segmentsP1", { p1: scope.segments.length > 0 ? scope.segments.join(", ") : "—" })}
          {" · "}{(TARGET_SCOPE_UNIT_BASIS_LABEL as Record<string, string>)[scope.unit_basis] ?? scope.unit_basis}
          <span className="text-[color:var(--muted-fg)]"> ({scope.set_by} · {scope.set_at.slice(0, 10)})</span>
        </p>
      )}
      {!scope && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="target-scope-empty">{t("notSetFollowsTheDefault")}</p>}
      {/* ADR-0179 amendment slice A - reference display of the LINKED S1
          analysis beside the scope inputs (design §12.1 (b)). Reference
          only; nothing set automatically. */}
      {linked ? (
        <div className="text-[length:var(--fs-caption)] mb-2" data-testid="target-scope-linked-sizing">
          <span className="status-chip status-info">{t("linkedS1MarketSizingAnalysis")}</span>{" "}
          <a href={linked.href} className="underline">{t("openOnTheS1Screen")}</a>
          {" · "}v{linked.version_no}
          {linked.scope
            ? t("evidenceScopeP1", { p1: `${linked.scope.regions.map((r) => REGION_LABEL(tr)[r] ?? r).join(" / ")}${linked.scope.segments.length > 0 ? t("segmentsP12", { p1: linked.scope.segments.join(", ") }) : ""}${linked.scope.unit_basis ? t("unitP1", { p1: linked.scope.unit_basis }) : ""}` })
            : t("evidenceScopeNotFilledScoped")}
          {/* Slice 4 (OD-3): unit_basis as data in the reference strip, not an
              input — the value the PUT body sends is shown, so the person
              never reads it as an absolute-value field. */}
          <span className="text-[color:var(--muted-fg)]" data-testid="target-scope-unit-basis">
            {" · "}{t("unitBasis")} {unitBasis ? (TARGET_SCOPE_UNIT_BASIS_LABEL as Record<string, string>)[unitBasis] ?? unitBasis : t("undeclaredCannotEstimateInKrw")} ({SCOPE_UNIT_BASIS_CAPTION})
          </span>
          {linked.anchor_value_krw_m != null && t("anchorValueP1KrwM", { p1: linked.anchor_value_krw_m.toLocaleString() })}
          {linked.confidence_grade && t("confidenceP1", { p1: linked.confidence_grade })}
        </div>
      ) : (
        !disabledReason && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="target-scope-linked-empty">
            {t("noLinkedS1MarketSizing")}
          </p>
        )
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1">{error}</p>}
      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-1">{notice}</p>}
      {canAct && (
        <div>
          {/* ADR-0181 (decider feedback 2026-10-18): 지역과 세그먼트 are TWO
              distinct, VISUALLY SEPARATED groups — bordered fieldsets with
              visible legends, side by side. The entry region is picked FROM
              the linked S1 matrix (with its S1 weight shown) when the matrix
              has regions; the fixed enum is the fallback. S1 stays frozen
              (read-only). */}
          <div className="grid md:grid-cols-2 gap-3 mb-2">
            <fieldset className="border border-[color:var(--border)] rounded p-2 min-w-0" disabled={disabledReason != null} data-testid="target-scope-region-group">
              <legend className="text-[length:var(--fs-caption)] font-semibold px-1">{t("region")}</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {(matrixRegions.length > 0
                  ? [
                      ...matrixRegions.map((r) => ({ code: r.code, label: t("p1S1WeightP2", { p1: r.label, p2: r.weight }) })),
                      // legacy-saved codes absent from the matrix list must
                      // stay UNCHECKABLE — render them so a person can remove
                      // them (ADR-0181 verification finding, 2026-10-18).
                      ...regions
                        .filter((c) => !matrixRegions.some((r) => r.code === c))
                        .map((c) => ({ code: c, label: t("p1PreviouslySavedCode", { p1: c }) })),
                    ]
                  : TARGET_SCOPE_REGIONS.map((r) => ({ code: r, label: REGION_LABEL(tr)[r] }))
                ).map((r) => (
                  <label key={r.code} className="flex items-center gap-1 text-[length:var(--fs-caption)]">
                    <input type="checkbox" disabled={disabledReason != null} checked={regions.includes(r.code)} onChange={() => toggleRegion(r.code)} /> {r.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="border border-[color:var(--border)] rounded p-2 min-w-0" disabled={disabledReason != null} data-testid="target-scope-segment-group">
              <legend className="text-[length:var(--fs-caption)] font-semibold px-1">{t("segment")}</legend>
              {matrixSegments.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1">
                  {matrixSegments.map((s) => (
                    <label key={s.code} className="flex items-center gap-1 text-[length:var(--fs-caption)]">
                      <input
                        type="checkbox"
                        disabled={disabledReason != null}
                        checked={segments.split(",").map((x) => x.trim()).filter(Boolean).includes(s.code)}
                        onChange={() => {
                          const cur = segments.split(",").map((x) => x.trim()).filter(Boolean);
                          const next = cur.includes(s.code) ? cur.filter((x) => x !== s.code) : [...cur, s.code];
                          setSegments(next.join(", "));
                        }}
                      /> {s.label}
                    </label>
                  ))}
                </div>
              )}
              <input aria-label={t("enterSegmentDirectly")} placeholder={t("enterDirectlyCommaSeparated")} value={segments} onChange={(e) => setSegments(e.target.value)}
                disabled={disabledReason != null}
                className="sizing-new-input sizing-new-input-sm w-full" />
            </fieldset>
          </div>
          <button type="button" className="btn-ghost btn-sm" disabled={busy || regions.length === 0 || disabledReason != null} onClick={() => void save()}>{tc("save")}</button>
        </div>
      )}
    </section>
  );
}
