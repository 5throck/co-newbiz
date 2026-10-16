"use client";

// TargetScopeEditor — ADR-0179 slice 1: the person-set structured target
// scope on the S2 opportunity detail. A person (analyst+) records which
// regions / segments / unit basis the deal actually addresses; agents never
// write it (PUT is human-only server-side). Slice 1 stores and displays it
// only — comparison against the market-sizing anchor is slice 2.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { TARGET_SCOPE_REGIONS, TARGET_SCOPE_UNIT_BASES, TARGET_SCOPE_UNIT_BASIS_LABEL, type TargetScope } from "../lib/target-scope.ts";

const REGION_LABEL: Record<string, string> = {
  kr: "국내 (KR)", we: "서유럽 (WE)", ee: "동유럽 (EE)", ru: "러시아 (RU)", na: "북미 (NA)", cn: "중국 (CN)", sea: "동남아 (SEA)", sa: "남미 (SA)", af: "아프리카 (AF)", me: "중동 (ME)", worldwide: "전 세계 (worldwide)",
};

export function TargetScopeEditor({ opportunityId, canAct }: { opportunityId: string; canAct: boolean }) {
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
  }, []);

  useEffect(() => {
    api.get<{ scope: TargetScope | null }>(`/api/opportunities/${encodeURIComponent(opportunityId)}/target-scope`)
      .then((r) => apply(r.data.scope))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => setLoaded(true));
  }, [opportunityId, apply]);

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

  if (!canAct && !loaded) return null;

  return (
    <section aria-label="대상 범위 (target scope)" className="market-section" data-testid="target-scope-editor">
      <h3 className="text-[length:var(--fs-body)] font-semibold mb-1">
        대상 범위 <span className="status-chip status-info">사람 입력 (ADR-0179)</span>
      </h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        이 딜이 실제로 겨냥하는 시장 범위입니다. S8 시장 앵커와의 범위 불일치 점검에 사용됩니다 (후속 슬라이스).
      </p>
      {scope && (
        <p className="text-[length:var(--fs-caption)] mb-2" data-testid="target-scope-current">
          현재: {scope.regions.map((r) => REGION_LABEL[r] ?? r).join(" / ")}
          {scope.segments.length > 0 && ` · 세그먼트: ${scope.segments.join(", ")}`}
          {" · "}{TARGET_SCOPE_UNIT_BASIS_LABEL[scope.unit_basis]}
          <span className="text-[color:var(--muted-fg)]"> ({scope.set_by} · {scope.set_at.slice(0, 10)})</span>
        </p>
      )}
      {!scope && loaded && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="target-scope-empty">미설정 — 기본 시장 앵커 범위를 따릅니다.</p>}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-1">{error}</p>}
      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-1">{notice}</p>}
      {canAct && (
        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0 m-0">
            <legend className="sr-only">지역</legend>
            {TARGET_SCOPE_REGIONS.map((r) => (
              <label key={r} className="flex items-center gap-1 text-[length:var(--fs-caption)]">
                <input type="checkbox" checked={regions.includes(r)} onChange={() => toggleRegion(r)} /> {REGION_LABEL[r]}
              </label>
            ))}
          </fieldset>
          <input aria-label="세그먼트" placeholder="세그먼트 (쉼표 구분)" value={segments} onChange={(e) => setSegments(e.target.value)}
            className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 12rem" }} />
          <select aria-label="단위 기준" value={unitBasis} onChange={(e) => setUnitBasis(e.target.value)} className="sizing-new-input sizing-new-input-sm">
            {TARGET_SCOPE_UNIT_BASES.map((b) => <option key={b} value={b}>{TARGET_SCOPE_UNIT_BASIS_LABEL[b]}</option>)}
          </select>
          <button type="button" className="btn-ghost btn-sm" disabled={busy || regions.length === 0} onClick={() => void save()}>저장</button>
        </div>
      )}
    </section>
  );
}
