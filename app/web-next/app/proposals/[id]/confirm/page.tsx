"use client";

// 결정 제안 확인 화면 — ADR-0154 §5, design §6.3/§11.
// 에이전트(MCP)는 결정을 "제안"만 할 수 있다(경계 #2). 이 화면에서 사람이 자기
// 웹 세션으로 제안 내용·근거·검토 결과를 직접 보고 확정하거나 거절한다. 확정하면
// 이 세션이 기존 결정 라우트를 실행하므로 결정자 기록은 확정한 사람이다.
// 화면 로드만으로는 아무것도 결정되지 않으며(no action on load), 기본 동작은
// 하나("결정 확정")다. 수정 시에는 제안값과 수정값을 나란히 보여준다(show-diff).
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "../../../../lib/api.ts";
import { Button, PageState, PrimaryAction } from "../../../../components/ui.tsx";
import { ReviewBuckets } from "../../../../components/ReviewBuckets.tsx";
import { StatusPage } from "../../../../components/StatusPage.tsx";
import { GateAckBlock, GateSnapshotSummary } from "../../../../components/GateSnapshotAck.tsx";
import { EMPTY_ACK_STATE, ackProblemsFromError, buildAckPayload, reconcileAckState, type AckProblems, type AckState, type GateSnapshotEnvelope } from "../../../../lib/gate-ack-view.ts";

type Payload = Record<string, unknown>;

interface Proposal {
  id: string;
  kind: string;
  entity_type: "opportunity" | "project";
  entity_id: string;
  stage_id: string | null;
  payload: Payload;
  rationale: string;
  evidence_refs: string[];
  proposed_by_user_id: string;
  via_client_id: string | null;
  status: "pending" | "confirmed" | "rejected" | "expired" | "superseded";
  expires_at: string;
  confirmed_by_user_id: string | null;
  confirmed_at: string | null;
  resulting_record_id: string | null;
}

interface RagView {
  status: "graded" | "not_graded";
  overall: { grade: "green" | "amber" | "red"; rationale: string } | null;
}

interface ConfirmView {
  proposal: Proposal;
  confirm_nonce: string | null;
  rag: RagView | null;
  /** Gate-decision proposals: the fresh snapshot the person acknowledges at confirm time. */
  gate_snapshot?: GateSnapshotEnvelope | null;
}

// i18n: kind/status/RAG texts resolve through pages.proposalConfirm.* keys at render time.
const KIND_KEY: Record<string, string> = {
  gate_decision: "kindGateDecision",
  route_decision: "kindRouteDecision",
  case_adoption: "kindCaseAdoption",
  target_selection: "kindTargetSelection",
  transition_decision: "kindTransitionDecision",
  approval: "kindApproval",
};

const STATUS_LABEL_KEY: Record<Proposal["status"], string> = {
  pending: "stPending",
  confirmed: "stConfirmed",
  rejected: "stRejected",
  expired: "stExpired",
  superseded: "stSuperseded",
};
const STATUS_NOTE_KEY: Record<Proposal["status"], string> = {
  pending: "notePending",
  confirmed: "noteConfirmed",
  rejected: "noteRejected",
  expired: "noteExpired",
  superseded: "noteSuperseded",
};

const RAG_KEY = { green: "ragGreen", amber: "ragAmber", red: "ragRed" } as const;
const RAG_CLASS = { green: "status-green", amber: "status-amber", red: "status-red" } as const;

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ko-KR") : "—";
}

function show(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export default function ProposalConfirmPage() {
  const t = useTranslations("pages.proposalConfirm");
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [view, setView] = useState<ConfirmView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Payload>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ts = useTranslations("components.gateSnapshot");
  const tg = useTranslations("common.gate");
  const [ackState, setAckState] = useState<AckState>(EMPTY_ACK_STATE);
  const [ackProblems, setAckProblems] = useState<AckProblems | null>(null);
  const [divergence, setDivergence] = useState("");
  const [divergenceProblem, setDivergenceProblem] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const ackRef = useRef<AckState>(EMPTY_ACK_STATE);
  const requiredRef = useRef<GateSnapshotEnvelope["snapshot"]["required_acks"]>([]);
  ackRef.current = ackState;

  const load = useCallback(() => {
    setError(null);
    setMissing(false);
    api
      .get<ConfirmView>(`/api/proposals/${encodeURIComponent(id)}/confirm`)
      .then((r) => {
        // Entered reasons survive a refresh for the keys that still exist.
        const next = r.data.gate_snapshot?.snapshot.required_acks ?? [];
        const rec = reconcileAckState(ackRef.current, requiredRef.current, next);
        if (requiredRef.current.length > 0 && (rec.added.length > 0 || rec.dropped.length > 0)) setStaleNotice(ts("staleChanged", { added: rec.added.length, dropped: rec.dropped.length }));
        requiredRef.current = next;
        setAckState(rec.state);
        setView(r.data);
        setDraft(r.data.proposal.payload);
      })
      .catch((e) => {
        // 존재하지 않는(또는 볼 수 없는) 제안은 404와 같은 화면으로 — 일반 오류 문구와 구분한다.
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(e instanceof ApiError ? e.message : t("loadFailed"));
      });
  }, [id, ts]);

  useEffect(load, [load]);

  useEffect(() => {
    if (view || error) headingRef.current?.focus();
  }, [view, error]);

  const proposal = view?.proposal ?? null;
  const pending = proposal?.status === "pending";

  const changes = useMemo(() => {
    if (!proposal) return [] as Array<{ key: string; before: unknown; after: unknown }>;
    return Object.keys(draft)
      .filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(proposal.payload[k]))
      .map((k) => ({ key: k, before: proposal.payload[k], after: draft[k] }));
  }, [draft, proposal]);

  const gs = proposal?.kind === "gate_decision" && pending ? view?.gate_snapshot ?? null : null;
  const aiRec = gs?.snapshot.ai?.recommended ?? null;
  const proposedDecision = proposal?.kind === "gate_decision" ? String(draft.decision ?? proposal.payload.decision ?? "") : "";
  const decisionIsGo = proposedDecision === "go";
  const divergent = !!aiRec && !!proposedDecision && aiRec !== proposedDecision;
  const gateForReview =
    proposal?.kind === "gate_decision" ? String(proposal.payload.gate) : proposal?.kind === "transition_decision" ? "transition" : null;

  async function confirm() {
    if (!view?.confirm_nonce || busy) return;
    setBusy(true);
    setNotice(null);
    setStatus(t("confirming"));
    try {
      const body: Record<string, unknown> = { nonce: view.confirm_nonce };
      if (changes.length > 0) body.payload = draft;
      if (gs) {
        body.snapshot_hash = gs.snapshot_hash;
        body.acknowledgements = buildAckPayload(gs.snapshot.required_acks, ackState);
        if (divergent && divergence.trim()) body.divergence_reason = divergence.trim();
      }
      setAckProblems(null); setDivergenceProblem(null); setStaleNotice(null);
      await api.post(`/api/proposals/${encodeURIComponent(id)}/confirm`, body);
      setStatus(t("confirmed"));
      setEditing(false);
      load();
    } catch (e) {
      setStatus("");
      if (e instanceof ApiError) {
        const d = e.details as Record<string, unknown>;
        if (e.code === "ack_required" || (e.code === "rationale_insufficient" && d.field === "acknowledgements")) setAckProblems(ackProblemsFromError(e.code, d));
        if (e.code === "divergence_reason_required" || (e.code === "rationale_insufficient" && d.field === "divergence_reason")) setDivergenceProblem(e.message);
      }
      setNotice(e instanceof ApiError ? `${e.message} (${e.code})` : t("confirmFailed"));
      // The nonce was consumed on every attempt: re-GET for a fresh nonce and snapshot.
      load();
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setStatus(t("rejecting"));
    try {
      await api.post(`/api/proposals/${encodeURIComponent(id)}/reject`, {});
      setStatus(t("rejected"));
      load();
    } catch (e) {
      setStatus("");
      setNotice(e instanceof ApiError ? e.message : t("rejectFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <StatusPage title={t("missingTitle")}>
        {t("missingBody")}
      </StatusPage>
    );
  }

  return (
    <main aria-labelledby="proposal-heading">
      <div className="page-header-row">
        <h1 id="proposal-heading" ref={headingRef} tabIndex={-1}>
          {t("heading")}
        </h1>
        {pending && (
          <span className="ml-auto">
            <PrimaryAction
              inline
              label={t("confirmBtn")}
              onClick={() => void confirm()}
              disabled={busy || !view?.confirm_nonce}
              disabledReason={busy ? t("busyReason") : t("nonceLoadingReason")}
            />
          </span>
        )}
      </div>
      <p className="objective">
        {t("objective")}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {!view && !error && <PageState state="loading" />}
      {error && <PageState state="error" errorText={error} onRetry={load} />}
      {notice && <p role="alert">✕ {notice}</p>}
      {proposal && (
        <>
          <section aria-labelledby="summary-heading">
            <h2 id="summary-heading">
              {KIND_KEY[proposal.kind] ? t(KIND_KEY[proposal.kind]) : proposal.kind}{" "}
              <span className={`status-chip ${pending ? "status-amber" : proposal.status === "confirmed" ? "status-green" : "status-red"}`}>
                {t(STATUS_LABEL_KEY[proposal.status])}
              </span>
            </h2>
            <p>{t(STATUS_NOTE_KEY[proposal.status])}</p>
            <dl>
              <div>
                <dt>{t("dtEntity")}</dt>
                <dd>
                  {proposal.entity_type === "project" ? t("entityProject") : t("entityOpportunity")} {proposal.entity_id}
                  {proposal.stage_id ? ` · ${t("stageSuffix", { stage: proposal.stage_id })}` : ""}
                </dd>
              </div>
              <div>
                <dt>{t("dtProposer")}</dt>
                <dd>
                  {proposal.proposed_by_user_id}
                  {proposal.via_client_id ? ` (${t("viaClient", { clientId: proposal.via_client_id })})` : ""}
                </dd>
              </div>
              <div>
                <dt>{t("dtExpires")}</dt>
                <dd>{fmt(proposal.expires_at)}</dd>
              </div>
              {proposal.status === "confirmed" && (
                <div>
                  <dt>{t("dtConfirmed")}</dt>
                  <dd>
                    {proposal.confirmed_by_user_id} · {fmt(proposal.confirmed_at)}
                    {proposal.resulting_record_id ? ` · ${t("recordSuffix", { id: proposal.resulting_record_id })}` : ""}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section aria-labelledby="payload-heading">
            <h2 id="payload-heading">{t("payloadHeading")}</h2>
            <dl>
              {Object.entries(proposal.payload).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>
                    {editing && pending && typeof value === "string" ? (
                      <textarea
                        aria-label={t("editFieldAria", { key })}
                        value={String(draft[key] ?? "")}
                        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                        rows={3}
                      />
                    ) : (
                      <span className="pre-wrap">{show(value)}</span>
                    )}
                  </dd>
                </div>
              ))}
              <div>
                <dt>{t("dtRationale")}</dt>
                <dd className="pre-wrap">{proposal.rationale}</dd>
              </div>
              <div>
                <dt>{t("dtEvidence")}</dt>
                <dd>{proposal.evidence_refs.length === 0 ? t("evidenceNone") : proposal.evidence_refs.join(", ")}</dd>
              </div>
            </dl>
            {changes.length > 0 && (
              <section aria-labelledby="diff-heading">
                <h3 id="diff-heading">{t("diffHeading", { count: changes.length })}</h3>
                <ul>
                  {changes.map((c) => (
                    <li key={c.key}>
                      <strong>{c.key}</strong>: {t("diffBefore")} <span className="pre-wrap">{show(c.before)}</span>{" "}
                      {t("diffAfter")} <span className="pre-wrap">{show(c.after)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>

          {view?.rag && (
            <section aria-labelledby="rag-heading">
              <h2 id="rag-heading">{t("ragHeading")}</h2>
              {view.rag.status === "graded" && view.rag.overall ? (
                <p>
                  <span className={`status-chip ${RAG_CLASS[view.rag.overall.grade]}`}>{t(RAG_KEY[view.rag.overall.grade])}</span>{" "}
                  {view.rag.overall.rationale}{t("ragNote")}
                </p>
              ) : (
                <p>{t("ragNotGraded")}</p>
              )}
            </section>
          )}

          {gateForReview && <ReviewBuckets entityType={proposal.entity_type} entityId={proposal.entity_id} gates={[gateForReview]} variant="expanded" />}

          {gs && (
            <section aria-labelledby="ack-heading">
              <h2 id="ack-heading">{ts("summaryHeading")}</h2>
              <GateSnapshotSummary snapshot={gs.snapshot} gateLabel={(g) => tg(g as never)} />
              <GateAckBlock
                snapshot={gs.snapshot}
                state={ackState}
                onChange={setAckState}
                problems={ackProblems}
                decision={decisionIsGo ? "go" : proposedDecision === "kill" ? "kill" : "hold"}
                notice={staleNotice}
                divergence={divergent && aiRec ? { aiRecommended: aiRec, value: divergence, onChange: setDivergence, required: decisionIsGo, problem: divergenceProblem } : null}
              />
            </section>
          )}

          {pending && (
            <section aria-labelledby="decide-heading">
              <h2 id="decide-heading">{t("decideHeading")}</h2>
              <p>{t("decideNote")}</p>
              <div className="flex gap-2">
                <Button onClick={() => setEditing((v) => !v)} disabled={busy} aria-pressed={editing}>
                  {editing ? t("editCloseBtn") : t("editBtn")}
                </Button>
                <Button onClick={() => void reject()} disabled={busy}>
                  {t("rejectBtn")}
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
