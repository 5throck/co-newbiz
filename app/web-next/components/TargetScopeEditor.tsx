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
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { SCOPE_UNIT_BASIS_CAPTION, TARGET_SCOPE_REGIONS, TARGET_SCOPE_UNIT_BASIS_LABEL, resolveUnitBasis, type TargetScope, type TargetScopeUnitBasis } from "../lib/target-scope.ts";
import { extractSizingVersionScope } from "../lib/anchor-scope.ts";

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

const REGION_LABEL: Record<string, string> = {
  kr: "국내 (KR)", we: "서유럽 (WE)", ee: "동유럽 (EE)", ru: "러시아 (RU)", na: "북미 (NA)", cn: "중국 (CN)", sea: "동남아 (SEA)", sa: "남미 (SA)", af: "아프리카 (AF)", me: "중동 (ME)", worldwide: "전 세계 (worldwide)",
};

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
}) {
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
      const body = {
        regions,
        segments: segments.split(",").map((s) => s.trim()).filter(Boolean),
        unit_basis: unitBasis,
      };
      const r = await api.put<{ scope: TargetScope }>(`/api/opportunities/${encodeURIComponent(opportunityId)}/target-scope`, body);
      await onSaved(r.data.scope);
      setNotice("대상 범위를 저장했습니다.");
    } catch (err) { setError(err instanceof Error ? err.message : "저장 실패"); }
    finally { setBusy(false); }
  }

  if (!canAct && !scope && !disabledReason) return null;

  return (
    <section aria-label="대상 범위 (target scope)" className="market-section" data-testid="target-scope-editor">
      {/* ADR-0181: the section heading ("2. 대상 범위" + status chip) lives on
          the parent EntryMarketFlow step section — the child renders no title
          of its own (decider feedback 2026-10-18: the title appeared twice). */}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        이 딜이 실제로 겨냥하는 시장 범위입니다. S8 시장 앵커와의 범위 불일치 점검에 사용됩니다.
      </p>
      {disabledReason && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="target-scope-disabled">{disabledReason}</p>
      )}
      {scope && (
        <p className="text-[length:var(--fs-caption)] mb-2" data-testid="target-scope-current">
          현재 — 지역: {scope.regions.map((r) => REGION_LABEL[r] ?? r).join(" / ")}
          {` · 세그먼트: ${scope.segments.length > 0 ? scope.segments.join(", ") : "—"}`}
          {" · "}{(TARGET_SCOPE_UNIT_BASIS_LABEL as Record<string, string>)[scope.unit_basis] ?? scope.unit_basis}
          <span className="text-[color:var(--muted-fg)]"> ({scope.set_by} · {scope.set_at.slice(0, 10)})</span>
        </p>
      )}
      {!scope && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="target-scope-empty">미설정 — 기본 시장 앵커 범위를 따릅니다.</p>}
      {/* ADR-0179 amendment slice A - reference display of the LINKED S1
          analysis beside the scope inputs (design §12.1 (b)). Reference
          only; nothing set automatically. */}
      {linked ? (
        <div className="text-[length:var(--fs-caption)] mb-2" data-testid="target-scope-linked-sizing">
          <span className="status-chip status-info">연결된 S1 시장규모 분석</span>{" "}
          <a href={linked.href} className="underline">S1 화면에서 열기</a>
          {" · "}v{linked.version_no}
          {linked.scope
            ? ` · 근거 범위: ${linked.scope.regions.map((r) => REGION_LABEL[r] ?? r).join(" / ")}${linked.scope.segments.length > 0 ? ` · 세그먼트: ${linked.scope.segments.join(", ")}` : ""}${linked.scope.unit_basis ? ` · 단위: ${linked.scope.unit_basis}` : ""}`
            : " · 근거 범위 미기재 (범위 지정 시장규모 미연결)"}
          {/* Slice 4 (OD-3): unit_basis as data in the reference strip, not an
              input — the value the PUT body sends is shown, so the person
              never reads it as an absolute-value field. */}
          <span className="text-[color:var(--muted-fg)]" data-testid="target-scope-unit-basis">
            {" · "}단위 기준: {(TARGET_SCOPE_UNIT_BASIS_LABEL as Record<string, string>)[unitBasis] ?? unitBasis} ({SCOPE_UNIT_BASIS_CAPTION})
          </span>
          {linked.anchor_value_krw_m != null && ` · 앵커값: ${linked.anchor_value_krw_m.toLocaleString()} KRW M`}
          {linked.confidence_grade && ` · 신뢰도 ${linked.confidence_grade}`}
        </div>
      ) : (
        !disabledReason && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="target-scope-linked-empty">
            연결된 S1 시장규모 분석이 없습니다 — S1 분석을 연결하면 범위 선택이 상류 수치의 실제 커버리지에 근거하게 됩니다.
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
              <legend className="text-[length:var(--fs-caption)] font-semibold px-1">지역</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {(matrixRegions.length > 0
                  ? matrixRegions.map((r) => ({ code: r.code, label: `${r.label} (S1 가중치 ${r.weight}%)` }))
                  : TARGET_SCOPE_REGIONS.map((r) => ({ code: r, label: REGION_LABEL[r] }))
                ).map((r) => (
                  <label key={r.code} className="flex items-center gap-1 text-[length:var(--fs-caption)]">
                    <input type="checkbox" disabled={disabledReason != null} checked={regions.includes(r.code)} onChange={() => toggleRegion(r.code)} /> {r.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="border border-[color:var(--border)] rounded p-2 min-w-0" disabled={disabledReason != null} data-testid="target-scope-segment-group">
              <legend className="text-[length:var(--fs-caption)] font-semibold px-1">세그먼트</legend>
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
              <input aria-label="세그먼트 직접 입력" placeholder="직접 입력 (쉼표 구분)" value={segments} onChange={(e) => setSegments(e.target.value)}
                disabled={disabledReason != null}
                className="sizing-new-input sizing-new-input-sm w-full" />
            </fieldset>
          </div>
          <button type="button" className="btn-ghost btn-sm" disabled={busy || regions.length === 0 || disabledReason != null} onClick={() => void save()}>저장</button>
        </div>
      )}
    </section>
  );
}
