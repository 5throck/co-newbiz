"use client";

// TargetScopeEditor — ADR-0179 slice 1: the person-set structured target
// scope on the S2 opportunity detail. Step 2 (대상 범위) of the consolidated
// 진입시장 산정 card (EntryMarketFlow): a person (analyst+) records which
// regions / segments / unit basis the deal actually addresses; agents never
// write it (PUT is human-only server-side). Amendment slice A: the LINKED
// S1 market-sizing reference display — while choosing a scope the person
// sees what the upstream numbers cover (declared scope, anchor value,
// confidence grade, open link), now rendered BESIDE the inputs via the
// `linked` prop owned by the parent flow. Presentational consolidation
// only — routes and payloads are unchanged. The version-ID link management
// moved to the parent's step 1; without an S1 link this editor renders
// disabled with the reason (`disabledReason`).
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { TARGET_SCOPE_REGIONS, TARGET_SCOPE_UNIT_BASES, TARGET_SCOPE_UNIT_BASIS_LABEL, type TargetScope } from "../lib/target-scope.ts";
import { extractSizingVersionScope } from "../lib/anchor-scope.ts";

/** Reference row of the LINKED S1 analysis/version: declared scope, anchor
 *  value, confidence grade and an href to open the S1 screen. Owned by the
 *  parent EntryMarketFlow (step 1 fetch) and passed down. */
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

export function TargetScopeEditor({ opportunityId, canAct, linked, disabledReason, onScopeChange }: {
  opportunityId: string;
  canAct: boolean;
  linked: LinkedSizingReference | null;
  disabledReason: string | null;
  onScopeChange?: (scopeSet: boolean) => void;
}) {
  const [scope, setScope] = useState<TargetScope | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [regions, setRegions] = useState<string[]>([]);
  const [segments, setSegments] = useState("");
  const [unitBasis, setUnitBasis] = useState<string>("krw_m_year");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback((s: TargetScope | null) => {
    setScope(s);
    setRegions(s?.regions ?? []);
    setSegments((s?.segments ?? []).join(", "));
    setUnitBasis(s?.unit_basis ?? "krw_m_year");
    onScopeChange?.(s != null);
  }, [onScopeChange]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ scope: TargetScope | null }>(`/api/opportunities/${encodeURIComponent(opportunityId)}/target-scope`);
      apply(r.data.scope);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoaded(true);
    }
  }, [opportunityId, apply]);

  useEffect(() => {
    void load();
  }, [load]);

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
      apply(r.data.scope);
      setNotice("대상 범위를 저장했습니다.");
    } catch (err) { setError(err instanceof Error ? err.message : "저장 실패"); }
    finally { setBusy(false); }
  }

  if (!canAct && !loaded && !disabledReason) return null;

  return (
    <section aria-label="대상 범위 (target scope)" className="market-section" data-testid="target-scope-editor">
      <h3 className="text-[length:var(--fs-body)] font-semibold mb-1">
        2. 대상 범위 <span className="status-chip status-info">사람 입력 (ADR-0179)</span>
      </h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        이 딜이 실제로 겨냥하는 시장 범위입니다. S8 시장 앵커와의 범위 불일치 점검에 사용됩니다.
      </p>
      {disabledReason && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="target-scope-disabled">{disabledReason}</p>
      )}
      {scope && (
        <p className="text-[length:var(--fs-caption)] mb-2" data-testid="target-scope-current">
          현재: {scope.regions.map((r) => REGION_LABEL[r] ?? r).join(" / ")}
          {scope.segments.length > 0 && ` · 세그먼트: ${scope.segments.join(", ")}`}
          {" · "}{TARGET_SCOPE_UNIT_BASIS_LABEL[scope.unit_basis]}
          <span className="text-[color:var(--muted-fg)]"> ({scope.set_by} · {scope.set_at.slice(0, 10)})</span>
        </p>
      )}
      {!scope && loaded && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="target-scope-empty">미설정 — 기본 시장 앵커 범위를 따릅니다.</p>}
      {/* ADR-0179 amendment slice A — reference display of the LINKED S1
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
          {linked.anchor_value_krw_m != null && ` · 앵커값: ${linked.anchor_value_krw_m.toLocaleString()} KRW M`}
          {linked.confidence_grade && ` · 신뢰도 ${linked.confidence_grade}`}
        </div>
      ) : (
        loaded && !disabledReason && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="target-scope-linked-empty">
            연결된 S1 시장규모 분석이 없습니다 — S1 분석을 연결하면 범위 선택이 상류 수치의 실제 커버리지에 근거하게 됩니다.
          </p>
        )
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1">{error}</p>}
      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-1">{notice}</p>}
      {canAct && (
        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0 m-0" disabled={disabledReason != null}>
            <legend className="sr-only">지역</legend>
            {TARGET_SCOPE_REGIONS.map((r) => (
              <label key={r} className="flex items-center gap-1 text-[length:var(--fs-caption)]">
                <input type="checkbox" disabled={disabledReason != null} checked={regions.includes(r)} onChange={() => toggleRegion(r)} /> {REGION_LABEL[r]}
              </label>
            ))}
          </fieldset>
          <input aria-label="세그먼트" placeholder="세그먼트 (쉼표 구분)" value={segments} onChange={(e) => setSegments(e.target.value)}
            disabled={disabledReason != null}
            className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 12rem" }} />
          <select aria-label="단위 기준" value={unitBasis} onChange={(e) => setUnitBasis(e.target.value)}
            disabled={disabledReason != null} className="sizing-new-input sizing-new-input-sm">
            {TARGET_SCOPE_UNIT_BASES.map((b) => <option key={b} value={b}>{TARGET_SCOPE_UNIT_BASIS_LABEL[b]}</option>)}
          </select>
          <button type="button" className="btn-ghost btn-sm" disabled={busy || regions.length === 0 || disabledReason != null} onClick={() => void save()}>저장</button>
        </div>
      )}
    </section>
  );
}
