"use client";

// 결정 제안 확인 화면 — ADR-0154 §5, design §6.3/§11.
// 에이전트(MCP)는 결정을 "제안"만 할 수 있다(경계 #2). 이 화면에서 사람이 자기
// 웹 세션으로 제안 내용·근거·검토 결과를 직접 보고 확정하거나 거절한다. 확정하면
// 이 세션이 기존 결정 라우트를 실행하므로 결정자 기록은 확정한 사람이다.
// 화면 로드만으로는 아무것도 결정되지 않으며(no action on load), 기본 동작은
// 하나("결정 확정")다. 수정 시에는 제안값과 수정값을 나란히 보여준다(show-diff).
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../../../lib/api.ts";
import { Button, PageState, PrimaryAction } from "../../../../components/ui.tsx";
import { ReviewBuckets } from "../../../../components/ReviewBuckets.tsx";
import { StatusPage } from "../../../../components/StatusPage.tsx";

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
}

const KIND_LABEL: Record<string, string> = {
  gate_decision: "게이트 결정",
  route_decision: "진출방식 결정",
  case_adoption: "사업 사례 채택",
  target_selection: "대상 선정",
  transition_decision: "포트폴리오 전환 결정",
  approval: "사람 승인 기록(차터·DD 판정·4축 검토)",
};

const STATUS_TEXT: Record<Proposal["status"], { label: string; note: string }> = {
  pending: { label: "확인 대기", note: "아직 아무 결정도 기록되지 않았습니다." },
  confirmed: { label: "확정됨", note: "이 제안은 이미 확정되어 결정이 기록되었습니다." },
  rejected: { label: "거절됨", note: "이 제안은 거절되었습니다. 결정은 기록되지 않았습니다." },
  expired: { label: "만료됨", note: "확인 기한(72시간)이 지났습니다. 에이전트에게 새 제안을 요청하세요." },
  superseded: { label: "대체됨", note: "더 새로운 제안으로 대체되었습니다. 최신 제안을 확인하세요." },
};

const RAG_TEXT = { green: "Green (양호)", amber: "Amber (주의)", red: "Red (위험)" } as const;
const RAG_CLASS = { green: "status-green", amber: "status-amber", red: "status-red" } as const;

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ko-KR") : "—";
}

function show(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export default function ProposalConfirmPage() {
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

  const load = useCallback(() => {
    setError(null);
    setMissing(false);
    api
      .get<ConfirmView>(`/api/proposals/${encodeURIComponent(id)}/confirm`)
      .then((r) => {
        setView(r.data);
        setDraft(r.data.proposal.payload);
      })
      .catch((e) => {
        // 존재하지 않는(또는 볼 수 없는) 제안은 404와 같은 화면으로 — 일반 오류 문구와 구분한다.
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(e instanceof ApiError ? e.message : "제안을 불러오지 못했습니다.");
      });
  }, [id]);

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

  const gateForReview =
    proposal?.kind === "gate_decision" ? String(proposal.payload.gate) : proposal?.kind === "transition_decision" ? "transition" : null;

  async function confirm() {
    if (!view?.confirm_nonce || busy) return;
    setBusy(true);
    setNotice(null);
    setStatus("결정을 기록하는 중입니다.");
    try {
      const body: { nonce: string; payload?: Payload } = { nonce: view.confirm_nonce };
      if (changes.length > 0) body.payload = draft;
      await api.post(`/api/proposals/${encodeURIComponent(id)}/confirm`, body);
      setStatus("결정이 기록되었습니다.");
      setEditing(false);
      load();
    } catch (e) {
      setStatus("");
      setNotice(e instanceof ApiError ? `${e.message} (${e.code})` : "확정하지 못했습니다.");
      // The nonce was consumed; reload to review the current state again.
      load();
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setStatus("제안을 거절하는 중입니다.");
    try {
      await api.post(`/api/proposals/${encodeURIComponent(id)}/reject`, {});
      setStatus("제안을 거절했습니다. 결정은 기록되지 않았습니다.");
      load();
    } catch (e) {
      setStatus("");
      setNotice(e instanceof ApiError ? e.message : "거절하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <StatusPage title="제안을 찾을 수 없습니다">
        주소가 잘못되었거나, 이미 정리되었거나, 볼 수 있는 권한이 없는 결정 제안입니다. 받은 링크를 다시 확인하세요.
      </StatusPage>
    );
  }

  return (
    <main aria-labelledby="proposal-heading">
      <div className="page-header-row">
        <h1 id="proposal-heading" ref={headingRef} tabIndex={-1}>
          결정 제안 확인
        </h1>
        {pending && (
          <span className="ml-auto">
            <PrimaryAction
              inline
              label="결정 확정"
              onClick={() => void confirm()}
              disabled={busy || !view?.confirm_nonce}
              disabledReason={busy ? "처리 중입니다." : "확정용 확인값을 불러오는 중입니다 — 잠시 후 다시 시도하세요."}
            />
          </span>
        )}
      </div>
      <p className="objective">
        에이전트는 결정을 제안할 수만 있습니다. 아래 내용을 직접 확인한 뒤, 본인의 판단으로 확정하거나 거절하세요.
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
              {KIND_LABEL[proposal.kind] ?? proposal.kind}{" "}
              <span className={`status-chip ${pending ? "status-amber" : proposal.status === "confirmed" ? "status-green" : "status-red"}`}>
                {STATUS_TEXT[proposal.status].label}
              </span>
            </h2>
            <p>{STATUS_TEXT[proposal.status].note}</p>
            <dl>
              <div>
                <dt>대상</dt>
                <dd>
                  {proposal.entity_type === "project" ? "프로젝트" : "기회"} {proposal.entity_id}
                  {proposal.stage_id ? ` · ${proposal.stage_id} 단계` : ""}
                </dd>
              </div>
              <div>
                <dt>제안자</dt>
                <dd>
                  {proposal.proposed_by_user_id}
                  {proposal.via_client_id ? ` (연결 앱 ${proposal.via_client_id} 경유)` : ""}
                </dd>
              </div>
              <div>
                <dt>확인 기한</dt>
                <dd>{fmt(proposal.expires_at)}</dd>
              </div>
              {proposal.status === "confirmed" && (
                <div>
                  <dt>확정</dt>
                  <dd>
                    {proposal.confirmed_by_user_id} · {fmt(proposal.confirmed_at)}
                    {proposal.resulting_record_id ? ` · 기록 ${proposal.resulting_record_id}` : ""}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section aria-labelledby="payload-heading">
            <h2 id="payload-heading">제안 내용</h2>
            <dl>
              {Object.entries(proposal.payload).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>
                    {editing && pending && typeof value === "string" ? (
                      <textarea
                        aria-label={`${key} 수정`}
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
                <dt>제안 근거</dt>
                <dd className="pre-wrap">{proposal.rationale}</dd>
              </div>
              <div>
                <dt>증거 참조</dt>
                <dd>{proposal.evidence_refs.length === 0 ? "없음" : proposal.evidence_refs.join(", ")}</dd>
              </div>
            </dl>
            {changes.length > 0 && (
              <section aria-labelledby="diff-heading">
                <h3 id="diff-heading">수정 내용 (제안값과 비교), {changes.length}건</h3>
                <ul>
                  {changes.map((c) => (
                    <li key={c.key}>
                      <strong>{c.key}</strong>: 제안값 <span className="pre-wrap">{show(c.before)}</span> → 수정값{" "}
                      <span className="pre-wrap">{show(c.after)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>

          {view?.rag && (
            <section aria-labelledby="rag-heading">
              <h2 id="rag-heading">AI 제안 RAG 등급</h2>
              {view.rag.status === "graded" && view.rag.overall ? (
                <p>
                  <span className={`status-chip ${RAG_CLASS[view.rag.overall.grade]}`}>{RAG_TEXT[view.rag.overall.grade]}</span>{" "}
                  {view.rag.overall.rationale} (AI 제안이며 승인이 아닙니다. 데이터 신뢰도가 등급 상한을 정합니다.)
                </p>
              ) : (
                <p>아직 종합 등급이 산출되지 않았습니다 (등급 없음).</p>
              )}
            </section>
          )}

          {gateForReview && <ReviewBuckets entityType={proposal.entity_type} entityId={proposal.entity_id} gates={[gateForReview]} variant="expanded" />}

          {pending && (
            <section aria-labelledby="decide-heading">
              <h2 id="decide-heading">사람의 판단</h2>
              <p>확정하면 현재 로그인한 본인 계정으로 결정이 기록됩니다. 해당 결정 권한이 없으면 확정되지 않습니다.</p>
              <div className="flex gap-2">
                <Button onClick={() => setEditing((v) => !v)} disabled={busy} aria-pressed={editing}>
                  {editing ? "수정 닫기" : "수정"}
                </Button>
                <Button onClick={() => void reject()} disabled={busy}>
                  거절
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
