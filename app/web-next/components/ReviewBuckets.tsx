"use client";

// ReviewBuckets — 3-stage review surface for a gate proposal (ADR-0153 §4.8).
// Three fixed-order sections: Verified / Could not verify / Needs judgement.
// Deliberately NOT here: any PASS badge, green check summary, aggregate score
// or auto-selected decision. Silence is not approval — a stage that was not
// performed says so in text. The human decision controls stay in the
// surrounding panel and are labelled as the human's decision (boundary #2).
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { canWriteBusiness, canWriteProject } from "../lib/project-write-access.ts";
import { GATE_LABEL, type GateMetaId } from "../lib/stage-meta.ts";
import { TabNav } from "./TabNav.tsx";

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
const gateLabel = (g: string): string => (g === "transition" ? "S12 전환" : (GATE_LABEL[g as GateMetaId] ?? g));

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
const BUCKETS: Array<{ key: BucketKey; title: string; hint: string }> = [
  { key: "verified", title: "확인됨 (Verified)", hint: "산출물 자체로 확인된 항목입니다. 승인이 아닙니다." },
  {
    key: "could_not_verify",
    title: "확인하지 못함 (Could not verify)",
    hint: "검토자가 확인하지 못했다고 밝힌 항목입니다.",
  },
  { key: "needs_judgement", title: "판단 필요 (Needs judgement)", hint: "사람이 판단해야 하는 항목입니다." },
];

function originOf(s: StageView): string {
  return s.origin === "AI 1st"
    ? "AI 1차 (결정론 검사)"
    : `AI 2차 · ${s.reviewer_domain ?? "?"} 도메인 · ${s.reviewer_agent}`;
}

export function ReviewBuckets({
  entityType,
  entityId,
  gates,
}: {
  entityType: "opportunity" | "project";
  entityId: string;
  gates: readonly string[];
}) {
  const { me } = useAuth();
  const canRequest = entityType === "project" ? canWriteProject(me?.role) : canWriteBusiness(me?.role);
  const reviewGates = useMemo(() => gates.filter((g) => REVIEW_GATE_IDS.has(g)) as ReviewGateId[], [gates]);
  const [active, setActive] = useState<string>(reviewGates[0] ?? "");
  const [views, setViews] = useState<Record<string, ReviewView>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const uid = useId();

  const base = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(entityId)}/reviews`;

  const refresh = useCallback(
    async (gate: string) => {
      try {
        let r = await api.get<ReviewView>(`${base}?gate=${encodeURIComponent(gate)}`);
        // AI 1st is deterministic and cheap — materialise it when absent/stale.
        if (canRequest && !r.data.ai_1st?.current) {
          r = await api.post<ReviewView>(base, { gate });
        }
        setViews((v) => ({ ...v, [gate]: r.data }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "검토 불러오기 실패");
      }
    },
    [base, canRequest],
  );

  useEffect(() => {
    if (active) void refresh(active);
  }, [active, refresh]);

  if (reviewGates.length === 0) return null;
  const view = views[active];

  async function requestAi2nd() {
    if (busy) return;
    setBusy(true);
    setStatus("AI 2차 검토를 요청했습니다. 진행 중입니다…");
    try {
      const r = await api.post<ReviewView>(`${base}/ai-2nd`, { gate: active });
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

  return (
    <section aria-label="3단계 검토" className="market-section sizing-step mt-3">
      <h3 className="sizing-step-title text-[0.95rem]">3단계 검토 — 사람 판단 전 참고 자료</h3>
      <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
        검토 결과는 승인·통과 표시가 아닙니다. AI가 확인한 것, 확인하지 못한 것, 사람이 판단할 것을 나누어 보여줄 뿐이며
        결정은 아래에서 사람이 기록합니다.
      </p>
      {reviewGates.length > 1 && (
        <TabNav
          label="검토 대상 산출물"
          active={active}
          onSelect={setActive}
          tabs={reviewGates.map((g) => ({ key: g, label: gateLabel(g) }))}
        />
      )}
      <div {...(reviewGates.length > 1 ? { role: "tabpanel", "aria-label": `${gateLabel(active)} 산출물 검토` } : {})}>
        {error && (
          <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mb-1">
            {error}
          </p>
        )}
        {!view && !error && <p className="text-[0.8rem] text-[color:var(--muted-fg)]">검토를 불러오는 중…</p>}
        {view && (
          <>
            <ul className="sizing-note-list mb-2 text-[0.78rem]" aria-label="검토 단계 출처">
              {stages.map((s) => (
                <li key={s.id}>
                  <span className="font-semibold">{originOf(s)}</span>
                  {s.author_domain ? ` — 작성 도메인 ${s.author_domain}` : ""}
                  {!s.performed && <span> — 수행되지 않음 (Not performed): {s.not_performed_reason}</span>}
                  {!s.current && <span> — 이전 산출물 기준의 결과입니다. 산출물이 바뀌었습니다.</span>}
                </li>
              ))}
              {!view.ai_2nd && <li>AI 2차 (교차 도메인): 아직 요청되지 않음 (Not performed)</li>}
            </ul>
            <div className="grid gap-3 md:grid-cols-3">
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
                    className={`border rounded-lg px-3 py-2 ${prominent ? "border-2 border-[color:var(--accent)]" : "border-[color:var(--border)]"}`}
                  >
                    <h4 id={headingId} className="text-[0.85rem] font-semibold mb-1">
                      {b.title}, {items.length}건
                    </h4>
                    <p className="text-[0.72rem] text-[color:var(--muted-fg)] mb-1">{b.hint}</p>
                    {items.length === 0 ? (
                      <p className="text-[0.78rem] text-[color:var(--muted-fg)]">해당 항목 없음</p>
                    ) : (
                      <ul className="sizing-note-list text-[0.78rem]">
                        {items.map(({ it, s }) => (
                          <li key={`${s.id}-${it.claim}`}>
                            <span className="font-semibold">{it.claim}</span>
                            <span className="block text-[color:var(--muted-fg)]">{it.reason}</span>
                            <span className="block text-[0.7rem] text-[color:var(--muted-fg)]">
                              출처: {s.origin === "AI 1st" ? "AI 1차" : `AI 2차 · ${s.reviewer_domain ?? "?"}`}
                              {it.evidence_ref ? ` · ${it.evidence_ref}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {canRequest && (
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void requestAi2nd()}>
                  {busy ? "요청 중…" : view.ai_2nd?.current ? "AI 2차 검토 다시 요청" : "AI 2차 검토 요청"}
                </button>
              )}
              <span className="text-[0.72rem] text-[color:var(--muted-fg)]">
                이번 달 AI 2차 토큰 {view.token_cap.used.toLocaleString()} / {view.token_cap.cap.toLocaleString()} ·
                산출물이 같으면 저장된 검토를 재사용합니다
              </span>
            </div>
          </>
        )}
        <p role="status" aria-live="polite" className="text-[0.75rem] text-[color:var(--muted-fg)] mt-1 mb-0">
          {status}
        </p>
      </div>
    </section>
  );
}
