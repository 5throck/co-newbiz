"use client";

// ReviewBuckets — 3-stage review surface for a gate proposal (ADR-0153 §4.8).
// Three fixed-order sections: Verified / Could not verify / Needs judgement.
// Deliberately NOT here: any PASS badge, green check summary, aggregate score
// or auto-selected decision. Silence is not approval — a stage that was not
// performed says so in text. The human decision controls stay in the
// surrounding panel and are labelled as the human's decision (boundary #2).
//
// Localization (ADR-0184, PR3 of design 2026-11-06): items that carry a
// `key` resolve through the message catalog via the review-item-keys contract
// (lib/review/review-item-keys.ts + resolveKeyedItem in lib/review-display.ts).
// Missing catalog keys fall back to the regex translation in
// lib/review-display.ts; legacy rows (no `key`) always use that fallback. The
// AI-2nd request carries the current locale so the LLM answers in the user's
// language (stored English stays the audit record).
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { canWriteBusiness, canWriteProject } from "../lib/project-write-access.ts";
import type { GateMetaId } from "../lib/stage-meta.ts";
import { GATE_LABEL_KEY } from "../lib/label-keys.ts";
import {
  BUCKET_TITLE,
  ai2ndStatusMessage,
  bucketCounts,
  citationLabel,
  gateDisplayName,
  localizeItem,
  localizeNotPerformedReason,
  resolveKeyedItem,
  reviewOriginText,
  type LocalizedItem,
} from "../lib/review/review-display.ts";
import { REVIEW_ITEM_KEYS } from "../lib/review/review-item-keys.ts";
import { ReviewProvenance, type ProvenanceItemView } from "./ReviewProvenance.tsx";
import { TabNav } from "./TabNav.tsx";
import { PrimaryAction, useToast } from "./ui.tsx";

type ReviewGateId = Exclude<GateMetaId, "target_screening"> | "transition";

const REVIEW_GATE_IDS: ReadonlySet<string> = new Set([
  "screening",
  "pre_fs",
  "fs",
  "dd",
  "entity_ic",
  "group_ic",
  "transition",
]);
/** Gate tab label — catalog key resolved with the ROOT translator; the review-lib Korean name stays the fallback. */
const gateLabelKey = (g: string): string => (g === "transition" ? "" : (GATE_LABEL_KEY[g] ?? ""));

/** A stage artifact tab (stage:S#:N) the caller offers, with a short Korean label. */
export interface ReviewArtifactTab {
  key: string;
  label: string;
}

interface ReviewItem {
  claim: string;
  reason: string;
  evidence_ref?: string;
  structural?: boolean;
  /** "not_reached": the stage is later than the entity's current stage — informational, never an open defect (Fix 1). */
  scope?: "not_reached";
  /** Catalog key for locale rendering (PR3) — one of the dotted keys in
   *  lib/review/review-item-keys.ts, resolved verbatim via next-intl. */
  key?: string;
  /** ICU parameters interpolated into the keyed message. */
  params?: Record<string, string | number>;
}
/** Not-reached items sit in could_not_verify but are neutral context, not open defects. */
const isNotReached = (it: { scope?: string }): boolean => it.scope === "not_reached";
interface StageView {
  id: string;
  origin: string;
  reviewer_agent: string;
  reviewer_domain: string | null;
  author_domain: string | null;
  performed: boolean;
  not_performed_reason: string | null;
  current: boolean;
  created_at: string;
  verified: ReviewItem[];
  could_not_verify: ReviewItem[];
  needs_judgement: ReviewItem[];
  /** How the review was routed / what was kept off the decision surface (design 2026-11-07). Never counted in the buckets. */
  provenance?: ProvenanceItemView[];
}
interface ReviewView {
  gate: string;
  content_hash: string;
  ai_1st: StageView | null;
  ai_2nd: StageView | null;
  token_cap: { used: number; cap: number };
}

type BucketKey = "verified" | "could_not_verify" | "needs_judgement";
// Bucket titles and hints come from the review.* catalog namespace (ADR-0184);
// BUCKET_TITLE's English stays as the tooltip (English is the audit language).
const BUCKETS: Array<{ key: BucketKey; titleKey: string; hintKey: string }> = [
  { key: "verified", titleKey: "review.buckets.verified", hintKey: "review.buckets.hintVerified" },
  { key: "could_not_verify", titleKey: "review.buckets.couldNotVerify", hintKey: "review.buckets.hintCouldNotVerify" },
  { key: "needs_judgement", titleKey: "review.buckets.needsJudgement", hintKey: "review.buckets.hintNeedsJudgement" },
];

/**
 * Locale rendering of one review item. When the item carries a catalog key
 * that resolves in BOTH locales' shared catalog (the translator already
 * serves the active locale; `has` guards against a missing entry), the
 * message renders with its params. Anything else — legacy rows and keys the
 * catalog does not know yet — falls back to the regex translation, which
 * keeps the stored English text when it cannot translate.
 */
function localizedItemText(tr: ReturnType<typeof useTranslations>, it: ReviewItem): LocalizedItem {
  const fallback = localizeItem(it);
  const resolved = resolveKeyedItem(it);
  if (!resolved || !tr.has(resolved.messageId)) return fallback;
  const params: Record<string, string | number> = Object.fromEntries(
    Object.entries(resolved.params).map(([k, v]) => [k, typeof v === "number" ? v : String(v)]),
  );
  // Raw ids and canonical-English params get their display form before interpolation.
  if (resolved.messageId === REVIEW_ITEM_KEYS.ai1GateVerdict && params.gate !== undefined) {
    params.gate = gateDisplayName(String(params.gate));
  }
  if (resolved.messageId === REVIEW_ITEM_KEYS.ai2NotPerformed && typeof params.reason === "string") {
    params.reason = localizeNotPerformedReason(params.reason);
  }
  const claim = tr(resolved.messageId, params);
  const reasonKey = `${resolved.messageId}Reason`;
  const reason = tr.has(reasonKey) ? tr(reasonKey, params) : fallback.reason;
  return { claim, reason, localized: true };
}

/** How the review block is laid out.
 *  - "expanded": decision surfaces (gate panels, inbox, proposal confirm) - buckets always visible.
 *  - "summary": stage screens - content first; a non-dismissible strip with the three counts that expands to the buckets. */
export type ReviewVariant = "expanded" | "summary";

function CountStrip({
  counts,
  notReached = 0,
  label,
}: {
  counts: ReturnType<typeof bucketCounts>;
  notReached?: number;
  label?: string;
}) {
  const tr = useTranslations();
  const warn = counts.could_not_verify > 0;
  return (
    // biome-ignore lint/a11y/useSemanticElements: an inline <span> strip; <fieldset> would change layout/styling (fieldset has block box and default border/padding)
    <span className="review-counts" role="group" aria-label={tr("review.aria.counts")}>
      {label && <span className="review-counts-target">{label}</span>}
      <span className="review-count" title={BUCKET_TITLE.verified.en}>
        {tr("review.counts.verified", { count: counts.verified })}
      </span>
      <span
        className={`review-count${warn ? " review-count-warn status-chip status-amber" : ""}`}
        title={BUCKET_TITLE.could_not_verify.en}
      >
        {warn && <AlertTriangle size={14} aria-hidden="true" />}
        {tr("review.counts.couldNotVerify", { count: counts.could_not_verify })}
        {warn && <span className="review-count-flag"> · {tr("review.counts.confirmNeeded")}</span>}
      </span>
      {notReached > 0 && (
        <span className="review-count" title="Not reached yet">
          <Clock size={14} aria-hidden="true" />
          {tr("review.counts.notReached", { count: notReached })}
        </span>
      )}
      <span className="review-count" title={BUCKET_TITLE.needs_judgement.en}>
        {tr("review.counts.needsJudgement", { count: counts.needs_judgement })}
      </span>
    </span>
  );
}

export function ReviewBuckets({
  entityType,
  entityId,
  gates,
  artifacts,
  headerPrimary,
  variant = "summary",
  headerSlot,
  judgementChecks,
  onToggleJudgement,
  ackMeta,
  onDecisionJump,
  confirmedJudgements,
  carrierStage,
}: {
  entityType: "opportunity" | "project";
  entityId: string;
  gates?: readonly string[];
  /** F-3/F-4: per-stage artifacts (stage:S#:N) alongside the gate proposals. */
  artifacts?: readonly ReviewArtifactTab[];
  /** Wave U: make "request AI 2nd review" the screen's Primary Action (page header). */
  headerPrimary?: boolean;
  /** Default "summary" (stage screens). Decision surfaces pass "expanded". */
  variant?: ReviewVariant;
  /** Expanded variant only: rendered on the header row beside the three counts (the inbox primary link). */
  headerSlot?: ReactNode;
  /** ADR-0182 §5 — controlled "사람 확인" state for needs_judgement items,
   *  keyed by claim text. Checkboxes render only when onToggleJudgement is
   *  given (i.e. the surrounding panel records the decision). */
  judgementChecks?: Record<string, boolean>;
  /** gate-aware toggle (2026-10-21): the third argument names the gate whose
   *  review produced the claim, so the interim acknowledgement lands in the
   *  review_claim_ack ledger under the right gate. */
  onToggleJudgement?: (claim: string, checked: boolean, gate: string) => void;
  /** Saved interim acknowledgements (review_claim_ack latest per claim) — a checked
   *  item shows who acknowledged it and when. */
  ackMeta?: Record<string, { by: string; at: string }>;
  /** Discoverability: jump from the 판단 필요 bucket to the decision form. */
  onDecisionJump?: () => void;
  /** 판단 필요 claims already confirmed with a recorded gate decision — they
   *  render as a saved-state chip instead of a pending checkbox. */
  confirmedJudgements?: ReadonlySet<string>;
  /** The stage screen hosting this block (e.g. "S3" on the synergy screen). Gate reviews scope the unfinished stages AFTER it out (AI 1st reports them as info, AI 2nd skips them). Omitted = whole gate span (inbox, proposal confirm). */
  carrierStage?: string;
}) {
  const tr = useTranslations();
  const locale = useLocale();
  const { me } = useAuth();
  const canRequest = entityType === "project" ? canWriteProject(me?.role) : canWriteBusiness(me?.role);
  const reviewGates = useMemo(() => (gates ?? []).filter((g) => REVIEW_GATE_IDS.has(g)) as ReviewGateId[], [gates]);
  const tabs = useMemo(
    () => [
      ...reviewGates.map((g) => ({
        key: `gate:${g}`,
        label: gateLabelKey(g) ? tr(gateLabelKey(g)) : gateDisplayName(g),
      })),
      ...(artifacts ?? []).filter((a) => /^stage:(S[1-9]|S1[0-2]):[1-9][0-9]*$/.test(a.key)),
    ],
    [reviewGates, artifacts, tr],
  );
  const [active, setActive] = useState<string>(tabs[0]?.key ?? "");
  const [views, setViews] = useState<Record<string, ReviewView>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const [open, setOpen] = useState(variant === "expanded");

  // 2026-10-21 decider: "게이트 결정이 끝났는데도 검토가 종결되지 않는다" —
  // 결정 패널(GateDecisionPanel) 밖에서 렌더링되는 이 블록(단계 화면·인박스·제안
  // 확인)은 ack 원장(review_claim_ack)을 읽지 않아 확인 저장이 화면에 반영되지
  // 않았다. 부모가 ack 상태를 주지 않으면 이 컴포넌트가 직접 원장을 읽고 토글을
  // 즉시 저장한다 — 기록 행위는 여전히 사람의 클릭이다(경계 #2).
  const { toast } = useToast();
  const parentOwnedAcks = !!onToggleJudgement;
  const [selfChecks, setSelfChecks] = useState<Record<string, boolean>>({});
  const [selfAckMeta, setSelfAckMeta] = useState<Record<string, { by: string; at: string }>>({});
  const acksPath = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(entityId)}/review-acks`;
  // 게이트 탭이면 게이트 id, 산출물 탭이면 stage:S#:N — 둘 다 원장의 유효한 키다.
  const ackGate = active.startsWith("gate:") ? active.slice(5) : active;
  useEffect(() => {
    if (parentOwnedAcks || !ackGate) return;
    let alive = true;
    api
      .get<{ acks: Array<{ claim: string; acked: boolean; by: string; at: string }> }>(
        `${acksPath}?gate=${encodeURIComponent(ackGate)}`,
      )
      .then((r) => {
        if (!alive) return;
        const checks: Record<string, boolean> = {};
        const meta: Record<string, { by: string; at: string }> = {};
        for (const a of r.data.acks) {
          if (a.acked) {
            checks[a.claim] = true;
            meta[a.claim] = { by: a.by, at: a.at };
          }
        }
        setSelfChecks(checks);
        setSelfAckMeta(meta);
      })
      .catch(() => {
        /* acks are optional review state — the review never depends on them */
      });
    return () => {
      alive = false;
    };
  }, [parentOwnedAcks, acksPath, ackGate]);
  const toggleSelf = useCallback(
    (claim: string, checked: boolean, gate: string) => {
      setSelfChecks((m) => ({ ...m, [claim]: checked }));
      if (checked) setSelfAckMeta((m) => ({ ...m, [claim]: { by: me?.userId ?? "", at: new Date().toISOString() } }));
      api.post(acksPath, { gate, claim, acked: checked }).catch((e) => {
        setSelfChecks((m) => ({ ...m, [claim]: !checked }));
        toast(
          e instanceof Error
            ? tr("review.errors.ackFailedWith", { message: e.message })
            : tr("review.errors.ackFailed"),
        );
      });
    },
    [acksPath, me?.userId, toast, tr],
  );

  const base = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(entityId)}/reviews`;

  const refresh = useCallback(
    async (key: string) => {
      try {
        const param: Record<string, string> = key.startsWith("gate:") ? { gate: key.slice(5) } : { artifact: key };
        const isGate = key.startsWith("gate:");
        const query = isGate && carrierStage ? { ...param, carrier_stage: carrierStage } : param;
        let r = await api.get<ReviewView>(`${base}?${new URLSearchParams(query)}`);
        // AI 1st is deterministic and cheap — materialise it when absent/stale.
        if (canRequest && !r.data.ai_1st?.current) {
          r = await api.post<ReviewView>(base, isGate && carrierStage ? { ...param, carrierStage } : param);
        }
        setViews((v) => ({ ...v, [key]: r.data }));
        setError(null);
      } catch (e) {
        // Wave C-3 (D-10): a bare "Not found." (direct URL without a real deal id)
        // gets an actionable empty state instead.
        const msg = e instanceof Error ? e.message : "";
        setError(
          /^not found\.?$/i.test(msg.trim()) ? tr("review.errors.notFound") : msg || tr("review.errors.loadFailed"),
        );
      }
    },
    [base, canRequest, carrierStage, tr],
  );

  useEffect(() => {
    if (active) void refresh(active);
  }, [active, refresh]);

  // 2026-10-21 (decider: "다 확인했음에도 종결되지 않음") — 사람 확인(ack)과 결정
  // 기록에 들어간 항목은 버킷 건수에서 제외해 "모두 확인" 상태를 보인다. 원본
  // 버킷 데이터는 그대로이며, 건수는 표시값일 뿐 게이트를 막지 않는다.
  const resolvedClaims = useMemo(() => {
    const set = new Set<string>();
    for (const c of confirmedJudgements ?? []) set.add(c);
    for (const [claim, checked] of Object.entries(judgementChecks ?? selfChecks)) if (checked) set.add(claim);
    return set;
  }, [confirmedJudgements, judgementChecks, selfChecks]);

  if (tabs.length === 0) return null;
  const view = views[active];
  const headerAction = headerPrimary ? (
    <PrimaryAction
      label={
        busy
          ? tr("review.actions.busy")
          : view?.ai_2nd?.current
            ? tr("review.actions.requestAgain")
            : tr("review.actions.request")
      }
      onClick={() => void requestAi2nd()}
      disabled={!canRequest || busy || !view}
      disabledReason={
        !canRequest
          ? tr("review.errors.disabledRole")
          : busy
            ? tr("review.errors.busy")
            : tr("review.errors.loadingFirst")
      }
    />
  ) : null;
  const activeParam: Record<string, string> = active.startsWith("gate:")
    ? { gate: active.slice(5), ...(carrierStage ? { carrierStage } : {}) }
    : { artifact: active };

  async function requestAi2nd() {
    if (busy) return;
    setBusy(true);
    setStatus(tr("review.status.ai2ndRequested"));
    try {
      // The request locale rides along (additive body field) so the AI 2nd LLM
      // answers in the user's language; the stored English stays canonical.
      const r = await api.post<ReviewView>(`${base}/ai-2nd`, { ...activeParam, locale });
      setViews((v) => ({ ...v, [active]: r.data }));
      setStatus(ai2ndStatusMessage(r.data.ai_2nd));
      setError(null);
    } catch (e) {
      setStatus("");
      setError(e instanceof Error ? e.message : tr("review.errors.ai2ndFailed"));
    } finally {
      setBusy(false);
    }
  }

  const stages = [view?.ai_1st, view?.ai_2nd].filter((s): s is StageView => !!s);

  async function recordAudit(agreed: boolean) {
    if (!view?.ai_2nd || busy) return;
    setBusy(true);
    setStatus(agreed ? tr("review.status.auditAgree") : tr("review.status.auditDisagree"));
    try {
      await api.post(`/api/reviews/${encodeURIComponent(view.ai_2nd.id)}/audit-sample`, { agreed });
      setError(null);
    } catch (e) {
      setStatus("");
      setError(e instanceof Error ? e.message : tr("review.errors.auditFailed"));
    } finally {
      setBusy(false);
    }
  }

  const counts = bucketCounts(stages);
  const claimsOf = (bucket: keyof (typeof stages)[number]) =>
    stages
      .filter((st) => st.performed || st.origin === "AI 1st")
      .flatMap((st) => st[bucket] as ReadonlyArray<{ claim?: string; scope?: string }>)
      .filter((it) => !isNotReached(it))
      .map((it) => String(it?.claim ?? ""));
  // Not-reached stages are informational: shown in their own neutral count, never in the defect counts.
  const notReachedCount = stages
    .filter((st) => st.performed || st.origin === "AI 1st")
    .flatMap((st) => st.could_not_verify)
    .filter(isNotReached).length;
  const displayCounts = (() => {
    const c = { ...counts };
    c.needs_judgement = claimsOf("needs_judgement").filter((cl) => !resolvedClaims.has(cl)).length;
    c.could_not_verify = claimsOf("could_not_verify").filter((cl) => !resolvedClaims.has(cl)).length;
    return c;
  })();
  const allReviewed =
    claimsOf("needs_judgement").length + claimsOf("could_not_verify").length > 0 &&
    displayCounts.needs_judgement === 0 &&
    displayCounts.could_not_verify === 0;
  // 부모 소유(GateDecisionPanel)가 아니면 셀프 로딩·토글을 쓴다 — 표시·저장 경로가
  // 어느 화면에서든 동일하게 작동한다.
  const checksFor = judgementChecks ?? selfChecks;
  const metaFor = ackMeta ?? selfAckMeta;
  const toggleFor = onToggleJudgement ?? toggleSelf;
  const activeLabel = tabs.find((t) => t.key === active)?.label;
  const panelId = `${uid}-panel`;
  const summaryMode = variant === "summary";
  const showBody = !summaryMode || open;

  return (
    <section
      aria-label={tr("review.aria.block")}
      className={`market-section sizing-step mt-3 review-block review-block-${variant}`}
    >
      {headerAction}
      {summaryMode ? (
        // Non-dismissible by design: there is no close control, only an expand toggle.
        <div className="review-strip">
          <button
            type="button"
            className="review-strip-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            <span className="review-strip-title">{tr("review.strip.title")}</span>
            {view ? (
              <CountStrip
                counts={displayCounts}
                notReached={notReachedCount}
                label={tabs.length > 1 ? activeLabel : undefined}
              />
            ) : (
              <span className="review-counts-target">
                {error ? tr("review.strip.loadFailed") : tr("review.strip.loading")}
              </span>
            )}
            {view && allReviewed && <span className="status-chip status-green">✓ {tr("review.strip.closed")}</span>}
            <span className="review-strip-action">
              {open ? tr("review.strip.collapse") : tr("review.strip.expand")}
            </span>
          </button>
        </div>
      ) : (
        <div className="review-head">
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{tr("review.head.title")}</h3>
          {view && <CountStrip counts={displayCounts} notReached={notReachedCount} />}
          {headerSlot && <span className="review-head-slot">{headerSlot}</span>}
        </div>
      )}
      <div id={panelId} hidden={!showBody}>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{tr("review.disclaimer")}</p>
        {allReviewed && (
          <p className="mb-2 text-[length:var(--fs-caption)]" role="status" data-testid="review-all-reviewed">
            <span className="status-chip status-green">✓ {tr("review.allReviewed.chip")}</span>
            <span className="ml-2 text-[color:var(--muted-fg)]">{tr("review.allReviewed.note")}</span>
          </p>
        )}
        {tabs.length > 1 && (
          <TabNav label={tr("review.aria.artifactsNav")} active={active} onSelect={setActive} tabs={tabs} />
        )}
        <div
          {...(tabs.length > 1
            ? {
                role: "tabpanel",
                "aria-label": tr("review.aria.artifactPanel", {
                  label: tabs.find((t) => t.key === active)?.label ?? "",
                }),
              }
            : {})}
        >
          {error && (
            <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-1">
              {error}
            </p>
          )}
          {!view && !error && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tr("review.loading")}</p>
          )}
          {view && (
            <>
              <ul
                className="sizing-note-list mb-2 text-[length:var(--fs-caption)]"
                aria-label={tr("review.aria.stageSources")}
              >
                {stages.map((s) => (
                  <li key={s.id}>
                    <span className="font-semibold">{reviewOriginText(s)}</span>
                    {s.author_domain ? tr("review.items.authorDomain", { domain: s.author_domain }) : ""}
                    {!s.performed && s.not_performed_reason && (
                      <span title={tr("review.items.notPerformedTitle")}>
                        {" "}
                        — {localizeNotPerformedReason(s.not_performed_reason)}
                      </span>
                    )}
                    {!s.current && <span>{tr("review.items.stale")}</span>}
                  </li>
                ))}
                {!view.ai_2nd && (
                  <li>
                    <span title="Not performed">{tr("review.items.ai2ndNotRequested")}</span>
                  </li>
                )}
              </ul>
              <div className="review-grid">
                {BUCKETS.map((b) => {
                  const items = stages
                    .filter((s) => s.performed || s.origin === "AI 1st")
                    .flatMap((s) => s[b.key].map((it) => ({ it, s })));
                  const headingId = `${uid}-${b.key}`;
                  const prominent = b.key === "needs_judgement";
                  const notReachedItems =
                    b.key === "could_not_verify" ? items.filter(({ it }) => isNotReached(it)) : [];
                  const countedItems = items.filter(({ it }) => !isNotReached(it));
                  const openItems =
                    b.key === "needs_judgement" || b.key === "could_not_verify"
                      ? countedItems.filter(({ it }) => !resolvedClaims.has(it.claim))
                      : countedItems;
                  return (
                    <section
                      key={b.key}
                      aria-labelledby={headingId}
                      className={`review-bucket border rounded-lg px-3 py-2 ${prominent ? "border-2 border-[color:var(--accent)]" : "border-[color:var(--border)]"}`}
                    >
                      <h4
                        id={headingId}
                        className="text-[length:var(--fs-body)] font-semibold mb-1"
                        title={BUCKET_TITLE[b.key].en}
                      >
                        {tr("review.buckets.heading", {
                          title: tr(b.titleKey),
                          count: openItems.length,
                        })}
                      </h4>
                      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                        {tr(b.hintKey)}
                      </p>
                      {b.key === "needs_judgement" && items.length > 0 && onDecisionJump && (
                        <button type="button" className="btn-ghost btn-sm mb-1" onClick={onDecisionJump}>
                          {tr("review.buckets.decisionJump")}
                        </button>
                      )}
                      <ul className="review-items text-[length:var(--fs-caption)]">
                        {openItems.map(({ it, s }) => {
                          const l = localizedItemText(tr, it);
                          const claimKey = `${s.id}-${it.claim}`;
                          const confirmed = confirmedJudgements?.has(it.claim) ?? false;
                          // 확인하다 못함(could_not_verify)도 같은 ack 흐름으로 종결할 수 있다 (2026-10-21 decider).
                          const judgementable =
                            (b.key === "needs_judgement" || b.key === "could_not_verify") && !!toggleFor && canRequest;
                          return (
                            <li key={claimKey}>
                              <span className="font-semibold" title={l.localized ? it.claim : undefined}>
                                {l.claim}
                              </span>
                              <span
                                className="block text-[color:var(--muted-fg)]"
                                title={l.localized ? it.reason : undefined}
                              >
                                {l.reason}
                              </span>
                              <span className="block text-[color:var(--muted-fg)]">
                                {tr("review.items.source", {
                                  source: citationLabel(s.origin, s.reviewer_domain, it.evidence_ref),
                                })}
                              </span>
                              {confirmed && (
                                <span className="block mt-1">
                                  <span className="status-chip status-green" title={tr("review.items.confirmedTitle")}>
                                    <span aria-hidden="true">✓</span> {tr("review.items.confirmed")}
                                  </span>
                                </span>
                              )}
                              {!confirmed && judgementable && (
                                <label className="flex items-center gap-1 mt-1 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checksFor[it.claim] ?? false}
                                    onChange={(e) =>
                                      toggleFor(
                                        it.claim,
                                        e.target.checked,
                                        active.startsWith("gate:") ? active.slice(5) : active,
                                      )
                                    }
                                  />
                                  <span>{tr("review.items.ackLabel")}</span>
                                </label>
                              )}
                              {!confirmed && metaFor?.[it.claim] && (
                                <span className="block mt-1 note" data-testid="review-ack-saved">
                                  {tr("review.items.ackSaved", {
                                    by: metaFor[it.claim].by,
                                    date: metaFor[it.claim].at.slice(0, 10),
                                  })}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {notReachedItems.length > 0 && (
                        <details className="review-dev" data-testid="review-not-reached">
                          <summary>
                            <Clock size={14} aria-hidden="true" className="inline mr-1" />
                            <span title="Not reached yet">
                              {tr("review.items.notReachedSummary", { count: notReachedItems.length })}
                            </span>
                          </summary>
                          <p className="review-dev-note">{tr("review.items.notReachedNote")}</p>
                          <ul className="review-items text-[length:var(--fs-caption)]">
                            {notReachedItems.map(({ it, s }) => {
                              const l = localizedItemText(tr, it);
                              return (
                                <li key={`${s.id}-nr-${it.claim}`}>
                                  <span className="font-semibold" title={l.localized ? it.claim : undefined}>
                                    {l.claim}
                                  </span>
                                  <span
                                    className="block text-[color:var(--muted-fg)]"
                                    title={l.localized ? it.reason : undefined}
                                  >
                                    {l.reason}
                                  </span>
                                  <span className="block text-[color:var(--muted-fg)]">
                                    {tr("review.items.source", {
                                      source: citationLabel(s.origin, s.reviewer_domain, it.evidence_ref),
                                    })}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      )}
                    </section>
                  );
                })}
              </div>
              <ReviewProvenance items={stages.flatMap((s) => s.provenance ?? [])} />
              <details className="review-dev">
                <summary>{tr("review.dev.summary")}</summary>
                {/* INTERIM-WORDING */}
                <p className="review-dev-note">{tr("review.dev.note")}</p>
                <ul>
                  {stages.flatMap((s) =>
                    BUCKETS.flatMap((b) =>
                      s[b.key].map((it) => (
                        <li key={`${s.id}-${b.key}-${it.claim}`}>
                          <code>{BUCKET_TITLE[b.key].en}</code> · <code>{s.origin}</code> — {it.claim} — {it.reason}
                          {it.evidence_ref ? (
                            <>
                              {" "}
                              · <code>{it.evidence_ref}</code>
                            </>
                          ) : null}
                        </li>
                      )),
                    ),
                  )}
                </ul>
                <p className="review-dev-note">
                  {tr("review.dev.hash", { hash: view.content_hash.slice(0, 12) })}
                  {stages.map((s) => (
                    <span key={s.id}>
                      {" "}
                      · <code>{s.id}</code>
                    </span>
                  ))}
                </p>
              </details>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {canRequest && !headerPrimary && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void requestAi2nd()}
                  >
                    {busy
                      ? tr("review.actions.busy")
                      : view.ai_2nd?.current
                        ? tr("review.actions.requestAgain")
                        : tr("review.actions.request")}
                  </button>
                )}
                {canRequest && view.ai_2nd?.performed && view.ai_2nd.current && (
                  <>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void recordAudit(true)}
                    >
                      {tr("review.actions.auditAgree")}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void recordAudit(false)}
                    >
                      {tr("review.actions.auditDisagree")}
                    </button>
                  </>
                )}
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {tr("review.tokenCap", {
                    used: view.token_cap.used.toLocaleString(),
                    cap: view.token_cap.cap.toLocaleString(),
                  })}
                </span>
              </div>
            </>
          )}
          <p
            role="status"
            aria-live="polite"
            className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0"
          >
            {status}
          </p>
        </div>
      </div>
    </section>
  );
}
