// Client-safe display helpers for the 3-stage review surface (critique
// 2026-10-09, items 1/5/6/7). NO imports: consumed by client components, so it
// must not pull server modules (bun:sqlite) into the bundle.
//
// Boundary: this file only re-words AI 1st's deterministic English templates
// into Korean for display. It never changes what a reason MEANS, never turns a
// "could not verify" into anything softer, and never adds a pass/score.
// Stored review rows (and their content hashes) are untouched; unknown text
// (AI 2nd output, future templates) falls through unchanged.

export type BucketKey = "verified" | "could_not_verify" | "needs_judgement";

/** Korean bucket titles are fixed by the dissent condition (item 5); English is tooltip-only. */
export const BUCKET_TITLE: Record<BucketKey, { ko: string; en: string }> = {
  verified: { ko: "확인됨", en: "Verified" },
  could_not_verify: { ko: "확인하지 못함", en: "Could not verify" },
  needs_judgement: { ko: "판단 필요", en: "Needs judgement" },
};

/** Gate display names (the lowercase ids are internal identifiers). */
export const GATE_DISPLAY: Record<string, string> = {
  screening: "Screening",
  pre_fs: "Pre-FS",
  target_screening: "Target Screening",
  fs: "FS",
  dd: "DD",
  entity_ic: "Entity IC",
  group_ic: "Group IC",
  transition: "S12 전환",
};
export const gateDisplayName = (id: string): string => GATE_DISPLAY[id] ?? id;

const GATE_ID_RE = /\b(screening|pre_fs|target_screening|fs|dd|entity_ic|group_ic)\b(?= (?:진행 HOLD|게이트))/g;
/** Replace internal gate ids that precede "진행 HOLD" / "게이트" with display names. */
export const withGateNames = (text: string): string => text.replace(GATE_ID_RE, (g) => gateDisplayName(g));

/** Drop blank entries so an empty list never renders as a dangling label. */
export const cleanList = (xs: readonly (string | null | undefined)[] | null | undefined): string[] =>
  (xs ?? []).map((x) => (x ?? "").trim()).filter((x) => x.length > 0);

/** `보완 필요:` blocker text from a HOLD verdict; never renders an empty list. */
export function holdBlockerText(gate: string, missing: readonly (string | null | undefined)[] | null | undefined): string {
  return `${gate} 진행 HOLD — 보완 필요: ${cleanList(missing).join(", ") || "근거 확인"}`;
}

/** Join blocker strings: trims blanks and repairs a dangling "보완 필요:" label. */
export function joinBlockers(blockers: readonly string[] | null | undefined): string {
  return cleanList(blockers)
    .map((b) => (/보완 필요:\s*[.]*$/.test(b) ? b.replace(/보완 필요:\s*[.]*$/, "보완 필요: 근거 확인") : b))
    .join(" / ");
}

interface ItemLike {
  claim: string;
  reason: string;
  evidence_ref?: string;
}
export interface LocalizedItem {
  claim: string;
  reason: string;
  /** True when a catalog entry matched (false = shown as authored). */
  localized: boolean;
}

const stripDot = (s: string): string => s.replace(/\.+\s*$/, "");

/** Korean display text for AI 1st's deterministic templates (lib/review/ai-first.ts). */
export function localizeItem(it: ItemLike): LocalizedItem {
  const { claim, reason } = it;
  let m: RegExpExecArray | null;
  if ((m = /^Stage (S\d+) \((.*)\) completion predicate is satisfied$/.exec(claim))) {
    return {
      claim: `${m[1]} ${m[2]} 단계의 완료 조건이 충족되었습니다`,
      reason: "완료 조건을 결정론적으로 검사했습니다. 필요한 기록이 있다는 것만 확인하며, 내용이 옳다는 뜻은 아닙니다.",
      localized: true,
    };
  }
  if ((m = /^Substance of (S\d+) artifacts: (.*)$/.exec(claim))) {
    return {
      claim: `${m[1]} 산출물의 내용: ${m[2]}`,
      reason: "산출물이 있는지는 결정론적으로 확인했습니다. 내용이 충분한지는 검토자의 판단이 필요합니다.",
      localized: true,
    };
  }
  if ((m = /^Stage (S\d+) \((.*)\) does not apply to this track$/.exec(claim))) {
    return {
      claim: `${m[1]} ${m[2]} 단계는 이 트랙에 해당하지 않습니다`,
      reason: "프로세스 정의(트랙별 적용 단계)에 따른 판정입니다.",
      localized: true,
    };
  }
  if ((m = /^Stage (S\d+) \((.*)\) was not evaluated$/.exec(claim))) {
    return {
      claim: `${m[1]} ${m[2]} 단계는 평가하지 않았습니다`,
      reason: "기록된 KILL 결정으로 이 건이 종료되었습니다.",
      localized: true,
    };
  }
  if ((m = /^Stage (S\d+) \((.*)\) is incomplete$/.exec(claim))) {
    // reason = `${blockers.join(" / ") || fallback}${" Missing: a; b."}`
    const miss = /\s*Missing: (.*?)\.?\s*$/s.exec(reason);
    const head = miss ? reason.slice(0, miss.index) : reason;
    const blockers = head.trim() === "Completion predicate not satisfied." ? "완료 조건이 충족되지 않았습니다" : stripDot(withGateNames(head.trim()));
    const missing = miss ? cleanList(miss[1]!.split(";")) : [];
    return {
      claim: `${m[1]} ${m[2]} 단계가 아직 완료되지 않았습니다`,
      reason: `${blockers || "완료 조건이 충족되지 않았습니다"}.${missing.length > 0 ? ` 누락된 산출물: ${missing.join("; ")}.` : ""}`,
      localized: true,
    };
  }
  if ((m = /^Stage (S\d+) \((.*)\) is locked behind an incomplete predecessor$/.exec(claim))) {
    return {
      claim: `${m[1]} ${m[2]} 단계는 앞선 단계가 끝나지 않아 잠겨 있습니다`,
      reason: "순차 진입 조건이 충족되지 않아 이 단계의 산출물은 확인하지 않았습니다.",
      localized: true,
    };
  }
  if ((m = /^The (\S+) gate verdict \(go \/ hold \/ kill\)$/.exec(claim))) {
    return {
      claim: `${gateDisplayName(m[1]!)} 게이트 판정 (진행 / 보류 / 중단)`,
      reason: "게이트 승인과 투자 결정은 사람의 몫입니다. 이 검토는 근거와 빈틈만 보여줍니다.",
      localized: true,
    };
  }
  if ((m = /^The acceptance of stage (S\d+) artifact "(.*)"$/.exec(claim))) {
    return {
      claim: `${m[1]} 산출물 "${m[2]}"의 수용 여부`,
      reason: "게이트 승인과 투자 결정은 사람의 몫입니다. 이 검토는 근거와 빈틈만 보여줍니다.",
      localized: true,
    };
  }
  if (claim === "Accuracy, sourcing and internal consistency of artifact content") {
    return {
      claim: "산출물 내용의 정확성, 출처, 내부 일관성",
      reason: "AI 1차는 구조 완결성만 검사합니다. 어떤 기록의 내용도 읽거나 검증하지 않았습니다.",
      localized: true,
    };
  }
  return { claim, reason: withGateNames(reason), localized: false };
}

/** User-facing citation: no stage:S8 style identifiers. */
export function citationLabel(origin: string, reviewerDomain: string | null, ref?: string): string {
  const who = origin === "AI 1st" ? "AI 1차" : `AI 2차 · ${reviewerDomain ?? "?"}`;
  const m = ref ? /^stage:(S\d+)$/.exec(ref) : null;
  return m ? `${who} · ${m[1]} 단계` : who;
}

export interface BucketCounts {
  verified: number;
  could_not_verify: number;
  needs_judgement: number;
}
export function bucketCounts(
  stages: ReadonlyArray<Record<BucketKey, readonly unknown[]> & { performed: boolean; origin: string }>,
): BucketCounts {
  const out: BucketCounts = { verified: 0, could_not_verify: 0, needs_judgement: 0 };
  for (const s of stages) {
    if (!(s.performed || s.origin === "AI 1st")) continue;
    for (const k of Object.keys(out) as BucketKey[]) out[k] += s[k].length;
  }
  return out;
}
