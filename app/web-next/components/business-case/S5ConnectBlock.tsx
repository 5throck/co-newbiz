"use client";

// S5ConnectBlock - S8 `S5 연결` status + human-only actions at the top of the 설명·생성·권고 tab
// (Green Field only; decider feedback 2026-10-16, ADR-0178 follow-up). Shows where the S8
// investment numbers come from (S5 amounts vs ratio assumptions), the S5 simulation state and the
// pin's stale state. Amendment 2026-10-16: the pinned reference is the DEFAULT - the block reads
// `연결됨 (기본)`, and a person's revert keeps the copy (`복사본 (사람이 되돌림)`) with the connect
// button still available for re-linking or refreshing to the latest S5. Nothing runs automatically
// here; existing cases are never recalculated - the block always says that `자동 생성` has to be
// run again. Decision support only.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { useConfirm } from "../crud.tsx";
import {
  BASIS_LABEL,
  s5BasisHint,
  s5LinkageOf,
  s5ScopeNote,
  s5SourceLine,
  type InvestmentBasisKey,
} from "../../lib/s5-linkage-labels.ts";

interface PinView {
  path: "copy" | "pinned";
  optedIn: boolean;
  reverted?: boolean;
  pin: { id: string; planHash: string; pinnedAt: string; pinnedBy: string; reason: "initial" | "repin"; s5SimRunId: string | null } | null;
  state: "not_applicable" | "in_effect" | "stale";
  stale: boolean;
  reasons: string[];
}
interface ConnectView {
  sim: { state: "none" | "unconfirmed" | "confirmed" | "in_effect" | "stale"; staleReason: string | null; label: string; nextStep: string | null };
  run: { id: string; drawCount: number } | null;
}
interface ParamsResponse {
  params: { investmentBasis: InvestmentBasisKey; opexRatio: number; capexRatio: number; initialInvestmentRatio: number };
  s5_pin?: PinView | null;
  s5_connect?: ConnectView | null;
  track?: string | null;
  s5_pin_capex_total_krw_m?: number | null;
}
interface PlanSummary { totals: { capex: number; labor_opex: number; gov_rnd: number; staffing: number }; s5_sim_run_id: string | null }
interface ConnectPreview {
  import: { importable: number; manual_lines: number; capability_lines: number; skipped: Array<{ line: string; reason: string }> };
  pin: { has_pin: boolean; pinned: PlanSummary | null; current: PlanSummary; changed: boolean };
  confirmed_run_exists: boolean;
  current: { investment_basis: InvestmentBasisKey; s5_source: 0 | 1 };
  will_set: { investment_basis: "s5_plan" | null; s5_source: 1 };
}

const PIN_STALE_REASON: Record<string, string> = {
  source_changed: "S5 투자 계획·인력 계획·가정 범위·역량 판정이 고정 시점 이후 바뀌었습니다",
  newer_confirmed_run: "고정된 것보다 새로 확정된 S5 투자 시뮬레이션이 있습니다",
  pinned_run_superseded: "고정된 S5 시뮬레이션 실행이 새 실행으로 대체되었습니다",
  case_on_older_pin: "가장 최근 사례가 이전 고정 참조 기준으로 생성되었습니다",
};
const SIM_STALE_REASON: Record<string, string> = {
  run_confirmed_after_generation: "사례 생성 후 S5 투자 시뮬레이션이 확정되었습니다",
  run_changed: "확정된 S5 시뮬레이션 실행이 사례 생성 이후 바뀌었습니다",
  s5_lines_changed: "S5 투자 계획 또는 가정 범위가 확정 실행 이후 바뀌었습니다",
  run_missing: "사례가 참조한 S5 시뮬레이션 확정 실행을 찾을 수 없습니다",
};
const SKIP_REASON: Record<string, string> = {
  unit_unconfirmed: "단위 미확정",
  currency_non_krw: "KRW 외 통화",
  invalid_line: "이름·분류 누락",
  capability_unreflected_or_unpriced: "미반영 또는 비용 미산정 역량",
};
const fmt = (n: number): string => Math.round(n).toLocaleString("ko-KR");

export function S5ConnectBlock({ projectId, canAct, onChanged }: { projectId: string; canAct: boolean; onChanged?: () => void }) {
  const [data, setData] = useState<ParamsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const base = `/api/projects/${encodeURIComponent(projectId)}/business-case`;

  const load = useCallback(async () => {
    try {
      setData((await api.get<ParamsResponse>(`${base}/params`)).data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "S5 연결 상태를 불러오지 못했습니다.");
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  if (!data || data.track !== "greenfield") return null;
  const basis = data.params.investmentBasis;
  const pin = data.s5_pin ?? null;
  const link = s5LinkageOf(basis, pin?.path);
  const conn = data.s5_connect ?? null;
  const hint = s5BasisHint(basis);
  const pinned = pin?.path === "pinned";
  // 2026-10-16: the plan S8 uses carries no capex line at all — display-only warning.
  const capexZero = pinned && data.s5_pin_capex_total_krw_m === 0;
  const stale = !!pin?.pin && pin.state === "stale";
  const next = "이미 생성된 사례는 다시 계산되지 않으며 `자동 생성`을 다시 실행해야 반영됩니다. 의사결정 지원용이며 게이트·등급에는 영향이 없습니다.";

  function done(text: string) {
    setMsg(text); setErr(null);
    void load();
    onChanged?.();
  }

  async function startConnect() {
    setMsg(null); setErr(null); setBusy(true);
    try {
      const pv = (await api.get<{ preview: ConnectPreview }>(`${base}/s5-connect`)).data.preview;
      const skipped = pv.import.skipped.length > 0
        ? ` 가져오지 않는 항목 ${pv.import.skipped.length}건: ${pv.import.skipped.map((k) => `${k.line} (${SKIP_REASON[k.reason] ?? k.reason})`).join(", ")}.`
        : " 가져오지 않는 항목은 없습니다.";
      const run = pv.confirmed_run_exists ? " 확정된 S5 투자 시뮬레이션 실행이 있어 함께 고정됩니다." : " 확정된 S5 투자 시뮬레이션 실행이 없어 단일 지점 투자 계획으로 계산됩니다.";
      const d = pv.pin.current.totals;
      const totals = ` S5 계획 총액(백만원, 검토 기간 전체): 설비투자 ${fmt(d.capex)}, 인건비·운영비 ${fmt(d.labor_opex)}, 정부 R&D ${fmt(d.gov_rnd)}.`;
      const change = [
        pv.pin.has_pin ? "S5 고정 참조를 최신으로 갱신(이전 참조는 기록으로 남음)" : "S5 고정 참조를 스냅샷과 함께 만듦",
        pv.will_set.investment_basis ? `투자비 기준을 \`${BASIS_LABEL[pv.current.investment_basis]}\` → \`S5 투자 계획\`으로 변경` : `투자비 기준은 \`${BASIS_LABEL[pv.current.investment_basis]}\` 그대로 유지`,
        "`S5 계획 출처`를 고정 참조로 설정",
      ].join(" / ");
      confirm("S5와 연결하기", () => {
        void (async () => {
          setBusy(true);
          try {
            await api.post(`${base}/s5-connect`, {});
            done("S5와 연결했습니다. 이미 생성된 사례는 바뀌지 않았으며 `자동 생성`을 다시 실행해야 S5 금액으로 계산됩니다.");
          } catch (e) {
            setErr(e instanceof Error ? e.message : "S5 연결에 실패했습니다.");
          } finally {
            setBusy(false);
          }
        })();
      }, {
        body: `가져올 항목 ${pv.import.importable}건 (직접 입력 ${pv.import.manual_lines}건, 역량 해소 비용 ${pv.import.capability_lines}건).${skipped}${run}${totals} 변경 내용: ${change}. 한 번에 모두 적용되며 감사 기록이 남습니다. ${next}`,
        confirmLabel: "연결",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "연결할 수 있는 S5 투자 계획을 확인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function startUpdate() {
    setMsg(null); setErr(null); setBusy(true);
    try {
      const pv = (await api.get<{ preview: ConnectPreview }>(`${base}/s5-connect`)).data.preview;
      const dl = (a: number | undefined, b: number): string => (a === undefined ? fmt(b) : `${fmt(a)} → ${fmt(b)}`);
      const p = pv.pin.pinned?.totals; const c = pv.pin.current.totals;
      const diff = `총액(백만원) — 설비투자 ${dl(p?.capex, c.capex)}, 인건비·운영비 ${dl(p?.labor_opex, c.labor_opex)}, 정부 R&D ${dl(p?.gov_rnd, c.gov_rnd)}.`;
      confirm("최신 S5로 갱신", () => {
        void (async () => {
          setBusy(true);
          try {
            await api.post(`${base}/s5-pin`, {});
            done("S5 고정 참조를 최신으로 갱신했습니다. 이미 생성된 사례는 바뀌지 않았으며 `자동 생성`을 다시 실행해야 새 참조로 계산됩니다.");
          } catch (e) {
            setErr(e instanceof Error ? e.message : "S5 고정 참조 갱신에 실패했습니다.");
          } finally {
            setBusy(false);
          }
        })();
      }, {
        body: `${diff} 갱신하면 현재 고정 참조는 이전 기록으로 남고(삭제 아님) 새 참조가 만들어지며 투자비 복사본도 새 모델로 갱신됩니다(이전 모델은 보관). 투자비 기준과 \`S5 계획 출처\`는 바뀌지 않습니다. ${next}`,
        confirmLabel: "갱신",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "갱신할 S5 투자 계획을 확인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function startDisconnect() {
    setMsg(null); setErr(null);
    confirm("복사본으로 되돌리기", () => {
      void (async () => {
        setBusy(true);
        try {
          await api.post(`${base}/s5-disconnect`, {});
          done("복사본 사용으로 되돌렸습니다. 고정 참조 기록은 남아 있으며 `자동 생성`을 다시 실행해야 반영됩니다.");
        } catch (e) {
          setErr(e instanceof Error ? e.message : "복사본으로 되돌리지 못했습니다.");
        } finally {
          setBusy(false);
        }
      })();
    }, {
      body: `\`S5 계획 출처\`를 복사본(0)으로 바꿉니다. 고정 참조 기록과 투자비 기준은 그대로 남습니다. ${next}`,
      confirmLabel: "되돌리기",
      tone: "danger",
    });
  }

  const simChip = conn?.sim.state === "stale" ? "status-amber" : conn?.sim.state === "in_effect" ? "status-green" : "status-gray";
  const connectable = link !== "pinned";
  return (
    <section className="market-section sizing-step mb-3" aria-label="S5 연결" data-testid="s8-s5-connect-block">
      {confirmDialog}
      <h3 className="sizing-step-title">S5 연결 <span className="status-chip status-info">투자비가 S5 금액인지 가정 비율인지 확인</span></h3>
      <ul className="sizing-note-list" style={{ listStyle: "none", paddingLeft: 0 }}>
        <li data-testid="s8-s5-connect-source">
          <b>투자비 출처</b>{" "}
          <span className={`status-chip ${link === "pinned" ? "status-green" : link === "ratio" ? "status-amber" : "status-gray"}`}>
            {link === "pinned" ? "연결됨 (기본)" : link === "ratio" ? "연결 안 됨" : pin?.reverted ? "복사본 (사람이 되돌림)" : "복사본"}
          </span>{" "}
          {s5SourceLine(link, pin?.pin ?? null, data.params)}
        </li>
        <li data-testid="s8-s5-connect-basis">
          <b>적용 중인 투자비 기준</b> {BASIS_LABEL[basis] ?? basis}
          {hint && <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]"> — {hint}</span>}
        </li>
        <li data-testid="s8-s5-connect-sim">
          <b>S5 투자 시뮬레이션</b>{" "}
          <span className={`status-chip ${simChip}`}>{conn?.sim.state === "stale" && <span aria-hidden="true">⏱ </span>}{conn?.sim.label ?? "—"}</span>
          {conn?.sim.state === "stale" && conn.sim.staleReason && <> {SIM_STALE_REASON[conn.sim.staleReason] ?? conn.sim.staleReason}.</>}
          {conn?.sim.nextStep && (
            <> 다음 단계: {link === "ratio" && conn.sim.state !== "stale"
              ? "투자비 기준이 `비율 추정`이라 S5 시뮬레이션은 S8 계산에 쓰이지 않습니다 — 위 `S5와 연결하기` 후 `자동 생성`을 실행하세요."
              : conn.sim.nextStep}</>
          )}
        </li>
        {pin?.pin && (
          <li data-testid="s8-s5-connect-pin">
            <b>고정 참조 상태</b>{" "}
            <span className={`status-chip ${stale ? "status-amber" : "status-green"}`}>{stale && <span aria-hidden="true">⏱ </span>}{stale ? "재평가 필요" : "최신"}</span>
            {stale && <> {pin.reasons.map((r) => PIN_STALE_REASON[r] ?? r).join(" · ")}.</>}
            {!pinned && <> (현재 사용 중이 아님 — 복사본 사용)</>}
          </li>
        )}
        {capexZero && (
          <li data-testid="s8-s5-connect-capex-warning" role="note">
            <span className="status-chip status-amber"><span aria-hidden="true">⚠</span> 설비투자 없음</span>{" "}
            S5 계획에 설비투자(capex) 줄이 없습니다 — 설비투자가 있다면 S5 투자비 탭에 입력하세요.
          </li>
        )}
        <li data-testid="s8-s5-connect-scope" className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{s5ScopeNote(basis)}</li>
      </ul>

      {canAct && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="s8-s5-connect-actions">
          {connectable && (
            <button type="button" className="btn-ghost btn-sm" data-testid="s8-s5-connect-button" disabled={busy} onClick={() => void startConnect()}>S5와 연결하기</button>
          )}
          {pinned && stale && (
            <button type="button" className="btn-ghost btn-sm" data-testid="s8-s5-connect-update-button" disabled={busy} onClick={() => void startUpdate()}>최신 S5로 갱신</button>
          )}
          {pinned && (
            <button type="button" className="btn-ghost btn-sm" data-testid="s8-s5-connect-disconnect-button" disabled={busy} onClick={startDisconnect}>복사본으로 되돌리기</button>
          )}
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">사람이 직접 실행합니다 — 자동으로 바뀌는 것은 없고, 이미 생성된 사례는 `자동 생성`을 다시 실행해야 반영됩니다.</span>
        </div>
      )}
      {msg && <p role="status" data-testid="s8-s5-connect-result" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mt-1">✓ {msg}</p>}
      {err && <p role="alert" data-testid="s8-s5-connect-error" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1">✕ {err}</p>}
    </section>
  );
}
