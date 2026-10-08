"use client";

// ReviewBuckets — 3-stage review surface for a gate proposal (ADR-0153 §4.8).
// Three fixed-order sections: Verified / Could not verify / Needs judgement.
// Deliberately NOT here: any PASS badge, green check summary, aggregate score
// or auto-selected decision. Silence is not approval — a stage that was not
// performed says so in text. The human decision controls stay in the
// surrounding panel and are labelled as the human's decision (boundary #2).
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { canWriteBusiness, canWriteProject } from "../lib/project-write-access.ts";
import { GATE_LABEL, type GateMetaId } from "../lib/stage-meta.ts";
import { BUCKET_TITLE, bucketCounts, citationLabel, gateDisplayName, localizeItem } from "../lib/review/review-display.ts";
import { TabNav } from "./TabNav.tsx";
import { PrimaryAction } from "./ui.tsx";

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
const gateLabel = (g: string): string => (g === "transition" ? gateDisplayName(g) : (GATE_LABEL[g as GateMetaId] ?? gateDisplayName(g)));

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
}
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
}
interface ReviewView {
  gate: string;
  content_hash: string;
  ai_1st: StageView | null;
  ai_2nd: StageView | null;
  token_cap: { used: number; cap: number };
}

type BucketKey = "verified" | "could_not_verify" | "needs_judgement";
// Korean titles are exact (dissent condition on the 2026-10-09 critique): never softened.
// English is available only as a tooltip.
const BUCKETS: Array<{ key: BucketKey; hint: string }> = [
  { key: "verified", hint: "산출물 자체로 확인된 항목입니다. 승인이 아닙니다." },
  { key: "could_not_verify", hint: "검토자가 확인하지 못했다고 밝힌 항목입니다." },
  { key: "needs_judgement", hint: "사람이 판단해야 하는 항목입니다." },
];

/** How the review block is laid out.
 *  - "expanded": decision surfaces (gate panels, inbox, proposal confirm) - buckets always visible.
 *  - "summary": stage screens - content first; a non-dismissible strip with the three counts that expands to the buckets. */
export type ReviewVariant = "expanded" | "summary";

function CountStrip({ counts, label }: { counts: ReturnType<typeof bucketCounts>; label?: string }) {
  const warn = counts.could_not_verify > 0;
  return (
    <span className="review-counts" role="group" aria-label="검토 결과 건수">
      {label && <span className="review-counts-target">{label}</span>}
      <span className="review-count" title={BUCKET_TITLE.verified.en}>
        {BUCKET_TITLE.verified.ko} <b className="tabular-nums">{counts.verified}</b>건
      </span>
      <span
        className={`review-count${warn ? " review-count-warn status-chip status-amber" : ""}`}
        title={BUCKET_TITLE.could_not_verify.en}
      >
        {warn && <AlertTriangle size={14} aria-hidden="true" />}
        {BUCKET_TITLE.could_not_verify.ko} <b className="tabular-nums">{counts.could_not_verify}</b>건
        {warn && <span className="review-count-flag"> · 확인 필요</span>}
      </span>
      <span className="review-count" title={BUCKET_TITLE.needs_judgement.en}>
        {BUCKET_TITLE.needs_judgement.ko} <b className="tabular-nums">{counts.needs_judgement}</b>건
      </span>
    </span>
  );
}

function originOf(s: StageView): string {
  return s.origin === "AI 1st"
    ? "AI 1차 (결정론 검사)"
    : `AI 2차 · ${s.reviewer_domain ?? "?"} 도메인 · ${s.reviewer_agent}`;
}

export function ReviewBuckets({
  entityType,
  entityId,
  gates,
  artifacts,
  headerPrimary,
  variant = "summary",
  headerSlot,
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
}) {
  const { me } = useAuth();
  const canRequest = entityType === "project" ? canWriteProject(me?.role) : canWriteBusiness(me?.role);
  const reviewGates = useMemo(() => (gates ?? []).filter((g) => REVIEW_GATE_IDS.has(g)) as ReviewGateId[], [gates]);
  const tabs = useMemo(
    () => [
      ...reviewGates.map((g) => ({ key: `gate:${g}`, label: gateLabel(g) })),
      ...(artifacts ?? []).filter((a) => /^stage:(S[1-9]|S1[0-2]):[1-9][0-9]*$/.test(a.key)),
    ],
    [reviewGates, artifacts],
  );
  const [active, setActive] = useState<string>(tabs[0]?.key ?? "");
  const [views, setViews] = useState<Record<string, ReviewView>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const [open, setOpen] = useState(variant === "expanded");

  const base = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(entityId)}/reviews`;

  const refresh = useCallback(
    async (key: string) => {
      try {
        const param: Record<string, string> = key.startsWith("gate:") ? { gate: key.slice(5) } : { artifact: key };
        let r = await api.get<ReviewView>(`${base}?${new URLSearchParams(param)}`);
        // AI 1st is deterministic and cheap — materialise it when absent/stale.
        if (canRequest && !r.data.ai_1st?.current) {
          r = await api.post<ReviewView>(base, param);
        }
        setViews((v) => ({ ...v, [key]: r.data }));
        setError(null);
      } catch (e) {
        // Wave C-3 (D-10): a bare "Not found." (direct URL without a real deal id)
        // gets an actionable empty state instead.
        const msg = e instanceof Error ? e.message : "";
        setError(/^not found\.?$/i.test(msg.trim()) ? "이 검토/안건을 찾을 수 없습니다 — 검토/안건 보드에서 항목을 선택해 다시 들어오세요." : msg || "검토 불러오기 실패");
      }
    },
    [base, canRequest],
  );

  useEffect(() => {
    if (active) void refresh(active);
  }, [active, refresh]);

  if (tabs.length === 0) return null;
  const view = views[active];
  const headerAction = headerPrimary ? (
    <PrimaryAction
      label={busy ? "요청 중…" : view?.ai_2nd?.current ? "AI 2차 검토 다시 요청" : "AI 2차 검토 요청"}
      onClick={() => void requestAi2nd()}
      disabled={!canRequest || busy || !view}
      disabledReason={!canRequest ? "AI 2차 검토 요청은 analyst 권한이 필요합니다." : busy ? "요청 중입니다." : "AI 1차 검토를 불러오는 중입니다."}
    />
  ) : null;
  const activeParam = active.startsWith("gate:") ? { gate: active.slice(5) } : { artifact: active };

  async function requestAi2nd() {
    if (busy) return;
    setBusy(true);
    setStatus("AI 2차 검토를 요청했습니다. 진행 중입니다…");
    try {
      const r = await api.post<ReviewView>(`${base}/ai-2nd`, activeParam);
      setViews((v) => ({ ...v, [active]: r.data }));
      setStatus(
        r.data.ai_2nd && !r.data.ai_2nd.performed
          ? "AI 2차 검토는 수행되지 않았습니다. 사유가 아래에 표시됩니다."
          : "AI 2차 검토 결과가 갱신되었습니다.",
      );
      setError(null);
    } catch (e) {
      setStatus("");
      setError(e instanceof Error ? e.message : "AI 2차 검토 요청 실패");
    } finally {
      setBusy(false);
    }
  }

  const stages = [view?.ai_1st, view?.ai_2nd].filter((s): s is StageView => !!s);

  async function recordAudit(agreed: boolean) {
    if (!view?.ai_2nd || busy) return;
    setBusy(true);
    setStatus(agreed ? "동의 검표를 기록했습니다." : "비동의 검표를 기록했습니다. 검토 신뢰도 KPI에 반영됩니다.");
    try {
      await api.post(`/api/reviews/${encodeURIComponent(view.ai_2nd.id)}/audit-sample`, { agreed });
      setError(null);
    } catch (e) {
      setStatus("");
      setError(e instanceof Error ? e.message : "검표 기록 실패");
    } finally {
      setBusy(false);
    }
  }

  const counts = bucketCounts(stages);
  const activeLabel = tabs.find((t) => t.key === active)?.label;
  const panelId = `${uid}-panel`;
  const summaryMode = variant === "summary";
  const showBody = !summaryMode || open;

  return (
    <section aria-label="3단계 검토" className={`market-section sizing-step mt-3 review-block review-block-${variant}`}>
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
            <span className="review-strip-title">3단계 검토</span>
            {view ? (
              <CountStrip counts={counts} label={tabs.length > 1 ? activeLabel : undefined} />
            ) : (
              <span className="review-counts-target">{error ? "불러오지 못함" : "불러오는 중…"}</span>
            )}
            <span className="review-strip-action">{open ? "접기" : "펼쳐서 보기"}</span>
          </button>
        </div>
      ) : (
        <div className="review-head">
          <h3 className="sizing-step-title text-[0.95rem]">3단계 검토 — 사람 판단 전 참고 자료</h3>
          {view && <CountStrip counts={counts} />}
          {headerSlot && <span className="review-head-slot">{headerSlot}</span>}
        </div>
      )}
      <div id={panelId} hidden={!showBody}>
      <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
        검토 결과는 승인·통과 표시가 아닙니다. AI가 확인한 것, 확인하지 못한 것, 사람이 판단할 것을 나누어 보여줄 뿐이며
        결정은 아래에서 사람이 기록합니다.
      </p>
      {tabs.length > 1 && (
        <TabNav
          label="검토 대상 산출물"
          active={active}
          onSelect={setActive}
          tabs={tabs}
        />
      )}
      <div {...(tabs.length > 1 ? { role: "tabpanel", "aria-label": `${tabs.find((t) => t.key === active)?.label ?? ""} 산출물 검토` } : {})}>
        {error && (
          <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-1">
            {error}
          </p>
        )}
        {!view && !error && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">검토를 불러오는 중…</p>}
        {view && (
          <>
            <ul className="sizing-note-list mb-2 text-[length:var(--fs-caption)]" aria-label="검토 단계 출처">
              {stages.map((s) => (
                <li key={s.id}>
                  <span className="font-semibold">{originOf(s)}</span>
                  {s.author_domain ? ` — 작성 도메인 ${s.author_domain}` : ""}
                  {!s.performed && <span title="Not performed"> — 수행되지 않음: {s.not_performed_reason}</span>}
                  {!s.current && <span> — 이전 산출물 기준의 결과입니다. 산출물이 바뀌었습니다.</span>}
                </li>
              ))}
              {!view.ai_2nd && <li><span title="Not performed">AI 2차 (교차 도메인): 아직 요청되지 않음 (수행되지 않음)</span></li>}
            </ul>
            <div className="review-grid">
              {BUCKETS.map((b) => {
                const items = stages
                  .filter((s) => s.performed || s.origin === "AI 1st")
                  .flatMap((s) => s[b.key].map((it) => ({ it, s })));
                const headingId = `${uid}-${b.key}`;
                const prominent = b.key === "needs_judgement";
                return (
                  <section
                    key={b.key}
                    aria-labelledby={headingId}
                    className={`review-bucket border rounded-lg px-3 py-2 ${prominent ? "border-2 border-[color:var(--accent)]" : "border-[color:var(--border)]"}`}
                  >
                    <h4 id={headingId} className="text-[length:var(--fs-body)] font-semibold mb-1" title={BUCKET_TITLE[b.key].en}>
                      {BUCKET_TITLE[b.key].ko}, {items.length}건
                    </h4>
                    <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{b.hint}</p>
                    {items.length === 0 ? (
                      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">해당 항목 없음</p>
                    ) : (
                      <ul className="review-items text-[length:var(--fs-caption)]">
                        {items.map(({ it, s }) => {
                          const l = localizeItem(it);
                          return (
                            <li key={`${s.id}-${it.claim}`}>
                              <span className="font-semibold" title={l.localized ? it.claim : undefined}>{l.claim}</span>
                              <span className="block text-[color:var(--muted-fg)]" title={l.localized ? it.reason : undefined}>{l.reason}</span>
                              <span className="block text-[color:var(--muted-fg)]">
                                출처: {citationLabel(s.origin, s.reviewer_domain, it.evidence_ref)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
            <details className="review-dev">
              <summary>개발자 세부정보</summary>
              <p className="review-dev-note">내부 식별자와 원문(영문) 그대로의 검토 기록입니다. 검토 결과의 의미는 위 본문과 같습니다.</p>
              <ul>
                {stages.flatMap((s) =>
                  BUCKETS.flatMap((b) =>
                    s[b.key].map((it) => (
                      <li key={`${s.id}-${b.key}-${it.claim}`}>
                        <code>{BUCKET_TITLE[b.key].en}</code> · <code>{s.origin}</code> — {it.claim} — {it.reason}
                        {it.evidence_ref ? <> · <code>{it.evidence_ref}</code></> : null}
                      </li>
                    )),
                  ),
                )}
              </ul>
              <p className="review-dev-note">
                검토 기록 <code>{view.content_hash.slice(0, 12)}</code>
                {stages.map((s) => <span key={s.id}> · <code>{s.id}</code></span>)}
              </p>
            </details>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {canRequest && !headerPrimary && (
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void requestAi2nd()}>
                  {busy ? "요청 중…" : view.ai_2nd?.current ? "AI 2차 검토 다시 요청" : "AI 2차 검토 요청"}
                </button>
              )}
              {canRequest && view.ai_2nd?.performed && view.ai_2nd.current && (
                <>
                  <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void recordAudit(true)}>
                    이 검토에 동의 (검표)
                  </button>
                  <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void recordAudit(false)}>
                    이 검토에 비동의 (검표)
                  </button>
                </>
              )}
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                이번 달 AI 2차 토큰 {view.token_cap.used.toLocaleString()} / {view.token_cap.cap.toLocaleString()} ·
                산출물이 같으면 저장된 검토를 재사용합니다
              </span>
            </div>
          </>
        )}
        <p role="status" aria-live="polite" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
          {status}
        </p>
      </div>
      </div>
    </section>
  );
}
