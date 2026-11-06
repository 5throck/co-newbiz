// Client-safe display helpers for the 3-stage review surface (critique
// 2026-10-09, items 1/5/6/7). Client-safe only: no server modules (bun:sqlite)
// may be pulled into the bundle. The review-item-keys catalog is pure
// constants, so importing it stays client-safe.
import { REVIEW_ITEM_KEYS, isReviewItemKey, type ReviewItemKey } from "./review-item-keys.ts";
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
  entity_ic: "법인 심의",
  group_ic: "그룹 심의",
  transition: "S12 전환",
};
export const gateDisplayName = (id: string): string => GATE_DISPLAY[id] ?? id;

const GATE_ID_RE = /\b(screening|pre_fs|target_screening|fs|dd|entity_ic|group_ic)\b(?= (?:진행 HOLD|게이트))/g;
/** Replace internal gate ids that precede "진행 HOLD" / "게이트" with display names. */
export const withGateNames = (text: string): string => text.replace(GATE_ID_RE, (g) => gateDisplayName(g));

/** Drop blank and punctuation-only entries so an empty list never renders as a dangling label. */
export const cleanList = (xs: readonly (string | null | undefined)[] | null | undefined): string[] =>
  (xs ?? []).map((x) => (x ?? "").trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));

/** `보완 필요:` blocker text from a HOLD verdict; never renders an empty list. */
export function holdBlockerText(
  gate: string,
  missing: readonly (string | null | undefined)[] | null | undefined,
): string {
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
  /** Locale key from the catalog (review-item-keys.ts); absent on legacy rows. */
  key?: string;
  params?: Record<string, unknown>;
}

/**
 * Resolve a keyed review item to its next-intl message id + params (Fix 3,
 * design 2026-11-06 PR3). Returns null when the item has no catalog key —
 * legacy rows fall back to `localizeItem` (ko) / raw stored text (en).
 * `localizeItem` remains the LEGACY fallback and is unchanged.
 */
export function resolveKeyedItem(
  it: Pick<ItemLike, "key" | "params">,
): { messageId: ReviewItemKey; params: Record<string, unknown> } | null {
  if (!it.key || !isReviewItemKey(it.key)) return null;
  return { messageId: it.key, params: it.params ?? {} };
}

/** Non-null marker for the UI: this item renders via next-intl, not localizeItem. */
export const REVIEW_KEY_HINT = REVIEW_ITEM_KEYS.ai2FreeText;
export interface LocalizedItem {
  claim: string;
  reason: string;
  /** True when a catalog entry matched (false = shown as authored). */
  localized: boolean;
}

const stripDot = (s: string): string => s.replace(/\.+\s*$/, "");

/** Display-only repair of stored reason text: an empty "보완 필요:" payload gets the
 *  "근거 확인" wording, an empty "누락된 산출물" clause is omitted, and ".." collapses to ".". */
export function tidyReasonText(text: string): string {
  return text
    .replace(/\s*(?:누락된 산출물|Missing artifacts|Missing):\s*[.,;\s]*$/g, "")
    .replace(/보완 필요:\s*[.,;\s]*(?=\/|$)/g, "보완 필요: 근거 확인")
    .replace(/(?<!\.)\.\.(?!\.)/g, ".")
    .trim();
}

/** Internal review-domain ids -> Korean labels (never show the raw id or "?"). */
export const REVIEW_DOMAIN_LABEL: Record<string, string> = {
  functional: "기능",
  technical: "기술",
  industry: "산업",
  region: "지역",
};
export const reviewDomainLabel = (d: string | null | undefined): string | null =>
  d && d !== "none" ? (REVIEW_DOMAIN_LABEL[d] ?? d) : null;

/** Korean text for AI 2nd "not performed" claims/reasons (lib/review/ai-second.ts, domains.ts). Unknown -> unchanged. */
export function localizeNotPerformedReason(text: string): string {
  let m: RegExpExecArray | null;
  if (text === "AI 1st found structural gaps (incomplete or locked stages); nothing worth cross-domain review yet")
    return "AI 1차에서 미완료·잠김 단계 같은 구조적 빈틈이 발견되어, 아직 교차 도메인 검토를 할 단계가 아닙니다.";
  if (text === "No stage of this gate has been reached yet; there is nothing to review cross-domain")
    return "이 게이트의 어느 단계에도 아직 도달하지 않아, 교차 도메인으로 검토할 내용이 없습니다.";
  if (text === "LLM provider is not configured") return "LLM 제공자가 설정되지 않아 검토하지 못했습니다.";
  m = /^monthly token cap reached \(used (\d+) of (\d+)\)$/.exec(text);
  if (m) return `월간 토큰 한도에 도달해 검토하지 못했습니다 (${m[2]} 중 ${m[1]} 사용).`;
  if (/^LLM call failed(?::|$)/.test(text)) return "LLM 호출에 실패해 검토하지 못했습니다.";
  if (text === "reviewer output was not valid after one retry")
    return "검토 결과가 한 번 다시 시도한 뒤에도 올바른 형식이 아니어서 쓰지 않았습니다.";
  if (text === "reviewer domain unresolved")
    return "작성 에이전트의 도메인을 확인하지 못해 검토자를 정하지 못했습니다.";
  m = /^no cross-domain reviewer: authors span (.*) and the default reviewer domain (\S+) is among them$/.exec(text);
  if (m) {
    const names = m[1]!
      .split(/,\s*/)
      .map((d) => reviewDomainLabel(d) ?? d)
      .join(", ");
    return `작성자가 ${names} 도메인에 걸쳐 있고 기본 검토 도메인(${reviewDomainLabel(m[2]) ?? m[2]})도 포함되어, 다른 도메인 검토자를 정하지 못했습니다.`;
  }
  m =
    /^no cross-domain reviewer: authors span (.*) and no matrix or fallback reviewer outside those domains exists$/.exec(
      text,
    );
  if (m) {
    const names = m[1]!
      .split(/,\s*/)
      .map((d) => reviewDomainLabel(d) ?? d)
      .join(", ");
    return `작성자가 ${names} 도메인에 걸쳐 있고, 교차검증 매트릭스와 대체 규칙 어디에도 그 밖의 도메인 검토자가 없습니다.`;
  }
  m = /^(.*); default cross-domain lead (\S+) reviewed\.(.*)$/.exec(text);
  if (m) {
    const spec = /^ Specialist (\S+) is same-domain \(first stage only\)\.$/.exec(m[3] ?? "")?.[1];
    const why = /^no matrix entry for artifact type '(.*)' x author domain '(.*)'$/.exec(m[1]!);
    const why2 = /^matrix reviewer '(.*)' is not cross-domain for authors in (.*) \(counts as first stage only\)$/.exec(
      m[1]!,
    );
    const cause = why
      ? `산출물 유형 '${why[1]}'과 작성 도메인 '${reviewDomainLabel(why[2]) ?? why[2]}' 조합이 매트릭스에 없어`
      : why2
        ? `매트릭스 검토자 '${why2[1]}'가 작성 도메인(${why2[2]!
            .split(/,\s*/)
            .map((d) => reviewDomainLabel(d) ?? d)
            .join(", ")})과 같아 교차 검토가 되지 않아(1차 검토로만 인정)`
        : "매트릭스가 쓸 수 있는 교차 도메인 검토자를 정하지 못해";
    return `${cause} 기본 교차 도메인 리드 ${m[2]}가 검토했습니다${spec ? `. 전문 검토자 ${spec}는 같은 도메인이라 1차 검토로만 인정됩니다` : ""}.`;
  }
  m =
    /^(.*): no review domain by explicit matrix exemption; the artifact domain comes from the other authoring agents\.$/.exec(
      text,
    );
  if (m)
    return `${m[1]}: 매트릭스의 명시적 면제로 검토 도메인이 없으며, 산출물의 도메인은 다른 작성 에이전트로 정합니다.`;
  if (text === "Reviewer chosen by fallback routing, not by a cross-validation matrix entry")
    return "검토자를 교차검증 매트릭스 항목이 아니라 대체 규칙으로 정했습니다";
  if (text === "Orchestrator agents excluded from the author-domain check")
    return "조정 에이전트는 작성 도메인 판단에서 제외했습니다";
  if (text === "unspecified") return "사유가 기록되지 않았습니다.";
  if (text === "AI 2nd cross-domain review was not performed") return "AI 2차 교차 도메인 검토가 수행되지 않았습니다";
  if (text === "Domain of some authoring agents could not be resolved")
    return "일부 작성 에이전트의 도메인을 확인하지 못했습니다";
  m = /^Excluded from the cross-domain check: (.*)\.$/.exec(text);
  if (m) return `교차 도메인 검사에서 제외됨: ${m[1]}.`;
  return text;
}

/** Origin line of a review stage; never prints "?" or the raw "none" agent. */
export function reviewOriginText(s: {
  origin: string;
  performed: boolean;
  reviewer_agent?: string | null;
  reviewer_domain?: string | null;
}): string {
  if (s.origin === "AI 1st") return "AI 1차 (결정론 검사)";
  const agent = s.reviewer_agent && s.reviewer_agent !== "none" ? s.reviewer_agent : null;
  const domain = reviewDomainLabel(s.reviewer_domain);
  if (!s.performed || (!agent && !domain)) return "AI 2차 · 수행되지 않음";
  return ["AI 2차", domain ? `${domain} 도메인` : null, agent].filter(Boolean).join(" · ");
}
/** Korean display text for AI 1st's deterministic templates (lib/review/ai-first.ts). */
export function localizeItem(it: ItemLike): LocalizedItem {
  const { claim, reason } = it;
  let m: RegExpExecArray | null;
  m = /^Stage (S\d+) \((.*)\) completion predicate is satisfied$/.exec(claim);
  if (m) {
    return {
      claim: `${m[1]} ${m[2]} 단계의 완료 조건이 충족되었습니다`,
      reason: "완료 조건을 결정론적으로 검사했습니다. 필요한 기록이 있다는 것만 확인하며, 내용이 옳다는 뜻은 아닙니다.",
      localized: true,
    };
  }
  m = /^Substance of (S\d+) artifacts: (.*)$/.exec(claim);
  if (m) {
    return {
      claim: `${m[1]} 산출물의 내용: ${m[2]}`,
      reason: "산출물이 있는지는 결정론적으로 확인했습니다. 내용이 충분한지는 검토자의 판단이 필요합니다.",
      localized: true,
    };
  }
  m = /^Stage (S\d+) \((.*)\) does not apply to this track$/.exec(claim);
  if (m) {
    return {
      claim: `${m[1]} ${m[2]} 단계는 이 트랙에 해당하지 않습니다`,
      reason: "프로세스 정의(트랙별 적용 단계)에 따른 판정입니다.",
      localized: true,
    };
  }
  m = /^Stage (S\d+) \((.*)\) was not evaluated$/.exec(claim);
  if (m) {
    return {
      claim: `${m[1]} ${m[2]} 단계는 평가하지 않았습니다`,
      reason: "기록된 KILL 결정으로 이 건이 종료되었습니다.",
      localized: true,
    };
  }
  m = /^Stage (S\d+) \((.*)\) is incomplete$/.exec(claim);
  if (m) {
    // reason = `${blockers.join(" / ") || fallback}${" Missing: a; b."}`
    const miss = /\s*Missing: (.*?)\.?\s*$/s.exec(reason);
    const head = miss ? reason.slice(0, miss.index) : reason;
    const blockers =
      head.trim() === "Completion predicate not satisfied."
        ? "완료 조건이 충족되지 않았습니다"
        : stripDot(tidyReasonText(withGateNames(head.trim())));
    const missing = miss ? cleanList(miss[1]!.split(";")) : [];
    return {
      claim: `${m[1]} ${m[2]} 단계가 아직 완료되지 않았습니다`,
      reason: `${blockers || "완료 조건이 충족되지 않았습니다"}.${missing.length > 0 ? ` 누락된 산출물: ${missing.join("; ")}.` : ""}`,
      localized: true,
    };
  }
  m = /^Stage (S\d+) \((.*)\) is locked behind an incomplete predecessor$/.exec(claim);
  if (m) {
    return {
      claim: `${m[1]} ${m[2]} 단계는 앞선 단계가 끝나지 않아 잠겨 있습니다`,
      reason: "순차 진입 조건이 충족되지 않아 이 단계의 산출물은 확인하지 않았습니다.",
      localized: true,
    };
  }
  const notReached = /^Stage (S\d+) \((.*)\) has not been reached yet$/.exec(claim);
  if (notReached) {
    return {
      claim: `${notReached[1]} ${notReached[2]} 단계에는 아직 도달하지 않았습니다`,
      reason: "이 건이 아직 앞선 단계에 있어 이 단계의 산출물은 확인하지 않았습니다.",
      localized: true,
    };
  }
  m = /^The (\S+) gate verdict \(go \/ hold \/ kill\)$/.exec(claim);
  if (m) {
    return {
      claim: `${gateDisplayName(m[1]!)} 게이트 판정 (진행 / 보류 / 중단)`,
      reason: "게이트 승인과 투자 결정은 사람의 몫입니다. 이 검토는 근거와 빈틈만 보여줍니다.",
      localized: true,
    };
  }
  m = /^The acceptance of stage (S\d+) artifact "(.*)"$/.exec(claim);
  if (m) {
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
  const lc = localizeNotPerformedReason(claim);
  const lr = localizeNotPerformedReason(reason);
  if (lc !== claim || lr !== reason) return { claim: lc, reason: lr, localized: true };
  return { claim, reason: tidyReasonText(withGateNames(reason)), localized: false };
}

/**
 * Status line shown after an AI 2nd review request. The reason is rendered in the AI 2nd line
 * ABOVE the buckets, so this message repeats it instead of pointing at a direction.
 */
// INTERIM-WORDING
export function ai2ndStatusMessage(
  stage: { performed: boolean; not_performed_reason: string | null } | null | undefined,
): string {
  if (!stage || stage.performed) return "AI 2차 검토 결과가 갱신되었습니다.";
  const reason = stage.not_performed_reason ? localizeNotPerformedReason(stage.not_performed_reason).trim() : "";
  return reason
    ? `AI 2차 검토는 수행되지 않았습니다 — ${reason}`
    : 'AI 2차 검토는 수행되지 않았습니다. 위쪽 "AI 2차" 줄에서 사유를 확인하세요.';
}

/** User-facing citation: no stage:S8 style identifiers. */
export function citationLabel(origin: string, reviewerDomain: string | null, ref?: string): string {
  const d = reviewDomainLabel(reviewerDomain);
  const who = origin === "AI 1st" ? "AI 1차" : d ? `AI 2차 · ${d}` : "AI 2차";
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
