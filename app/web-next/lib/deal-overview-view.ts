// Pure view helpers for the deal overview page (design 2026-10-11-deal-overview-ui-refinement).
// Client-safe, no React. Every new Korean string below is INTERIM-WORDING (design O-1).
import type { FactState, KeyFact, NextAction } from "./deal-overview.ts";

export type RailStatus = "complete" | "current" | "skipped" | "pending";

/** Process stage statuses -> the four rail states (blocked/locked/terminated read as not yet reached). */
export function railStatusFromStages(stages: ReadonlyArray<{ id: string; status: string }>): Record<string, RailStatus> {
  const out: Record<string, RailStatus> = {};
  for (const s of stages) {
    out[s.id] = s.status === "complete" ? "complete" : s.status === "current" ? "current" : s.status === "skipped" ? "skipped" : "pending";
  }
  return out;
}

export interface NextActionCopy {
  /** The sentence naming what to do. */
  what: string;
  /** Why this is the next step. */
  why: string;
  /** Specific primary-button label. */
  cta: string;
}

// INTERIM-WORDING: all strings in this function.
export function nextActionCopy(a: NextAction): NextActionCopy {
  const r = a.reason;
  switch (a.type) {
    case "record_artifact":
      return {
        what: a.subject.endsWith("기록") ? a.subject : `${a.subject} 기록`,
        why: r.type === "artifact_missing" ? `${r.stageId} ${r.stageName} 완료에 필요합니다 (${r.done}/${r.total} 완료)` : "",
        cta: `${a.buttonTarget} 열기`,
      };
    case "request_gate_decision":
      return { what: `${a.subject} 결정 요청`, why: `${a.subject} 게이트 결정이 있어야 다음 단계로 진행합니다`, cta: `${a.subject} 결정 열기` };
    case "await_countersign":
      // Resolved through the catalog (pages.dealOverview.awaitCountersign*) by the page.
      return { what: "", why: "", cta: "" };
    case "advance_stage":
      return { what: `${a.subject} 단계로 진행`, why: r.type === "stage_complete" ? `${r.stageId} ${r.stageName}의 완료 조건을 모두 채웠습니다` : "", cta: `${a.buttonTarget} 열기` };
    case "resolve_hold":
      return { what: `${a.subject} 보류 해소`, why: "보류가 해소될 때까지 진행이 멈춥니다", cta: `${a.subject} 보류 해소하기` };
  }
}

// INTERIM-WORDING
export function holdAgeText(ageDays: number | null): string | null {
  if (ageDays == null) return null;
  return ageDays === 0 ? "오늘 보류됨" : `${ageDays}일째 보류`;
}

// INTERIM-WORDING
export const FACT_LABEL: Record<KeyFact["key"], string> = {
  attractiveness: "매력도",
  synergy: "시너지",
  track: "트랙",
  gate: "게이트",
  project: "프로젝트",
};

export interface FactView {
  key: KeyFact["key"];
  label: string;
  state: FactState;
  text: string;
  note: string | null;
  href: string | null;
  linkText: string | null;
}

// INTERIM-WORDING: pending/missing/none wording.
export function factView(f: KeyFact, stageName: (id: string) => string | null): FactView {
  const base = { key: f.key, label: FACT_LABEL[f.key], state: f.state, href: f.href ?? null };
  switch (f.state) {
    case "pending": {
      const at = f.applicableFromStage;
      return { ...base, text: at ? `${at}${stageName(at) ? ` ${stageName(at)}` : ""} 단계에서 결정` : f.value.text, note: null, href: null, linkText: null };
    }
    case "missing":
      return { ...base, text: f.value.text, note: null, linkText: f.href ? "기록하러 가기" : null };
    case "none":
      return { ...base, text: `${f.value.text}: ${f.note ?? "결정 없음"}`, note: null, linkText: f.href ? "결정 화면 열기" : null };
    case "value":
      return { ...base, text: f.value.text, note: f.note, linkText: f.key === "gate" && f.href ? "결정 화면 열기" : null };
  }
}

/** Decision -> visual kind for gate chips (icon + text, never colour alone). */
export function gateChipKind(decision: string): "go" | "kill" | "hold" {
  return decision === "go" ? "go" : decision === "kill" ? "kill" : "hold";
}

/** Latest hold decision timestamp per gate from a gate-decisions `history` (DESC by decided_at). */
export function holdDatesFromHistory(
  history: ReadonlyArray<{ gate: string; decision: string; decided_at: string }> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of history ?? []) if (h.decision === "hold" && !(h.gate in out)) out[h.gate] = h.decided_at;
  return out;
}

export function documentTitle(name: string | null, eyebrow: string): string {
  return name ? `${name} - ${eyebrow}` : eyebrow;
}
