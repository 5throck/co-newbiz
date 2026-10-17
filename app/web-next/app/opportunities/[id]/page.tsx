"use client";

// /opportunities/[id] — S2 기회 상세 (ADR-0127). 목록 행 펼침 패널을 화면으로
// 승격시킨 것: 기회/위험 요인, 매력도 평가, 비즈니스 모델 검토(버전 이력 포함),
// 승격 패널. S3 시너지·전략적 적합성은 인라인 실행 대신 S3 화면(/synergy)으로
// 이동하는 링크를 제공한다 — 시너지 분석의 원래 장소는 S3 담당 화면이므로.
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api.ts";
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { useConfirm } from "../../../components/crud.tsx";
import { PageHeader, SectionToolbar } from "../../../components/layout.tsx";
import { DealBreadcrumb } from "../../../components/DealBreadcrumb.tsx";
import { StageRail } from "../../../components/StageFrame.tsx";
import { ScenarioPremises, SketchCanvas } from "../../../components/SketchCanvas.tsx";
import { ClosureModal } from "../../../components/ClosureModal.tsx";
import { PromotionPanel } from "../../../components/PromotionPanel.tsx";
import { KnownTargetGuide } from "../../../components/KnownTargetGuide.tsx";
import { EntryMarketFlow } from "../../../components/EntryMarketFlow.tsx";

interface OpportunityRow {
  id: string; project_id: string | null; name: string; market_scope: string | null; value_chain_node: string | null;
  market_size_krw_m: number | null; growth_rate: number | null;
  attractiveness_score: number | null; synergy_score: number | null; synergy_rationale: string | null;
  synergy_score_confirmed_at: string | null;
  status: "identified" | "assessed" | "selected" | "dropped";
  rationale: string | null; created_by: string; created_at: string;
}
interface OppFactors { opportunity: string[]; risk: string[] }
interface Sketch {
  customer?: string; valueProposition?: string; revenueModel?: string;
  requiredCapabilities?: string[]; keyRisks?: string[];
  scenarios?: Array<{ name?: string; assumption?: string }>;
}
interface SketchVersion { version_no: number; source: string | null; created_at: string }
interface SketchView { sketch: Sketch | null; source: string | null; created_at: string | null; versions: SketchVersion[] }
interface AttractivenessReco {
  source: "llm" | "synthesis"; note: string | null; manifest: string[];
  recommendation: { suggested_score: number | null; rationale_draft: string; key_evidence: string[]; cautions: string[] };
}

const STATUS_LABEL: Record<OpportunityRow["status"], string> = { identified: "발굴", assessed: "평가", selected: "선별", dropped: "제외" };

export function OpportunityDetail() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
  const [closing, setClosing] = useState(false);
  const [opp, setOpp] = useState<OpportunityRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [factors, setFactors] = useState<OppFactors | null>(null);
  const [factorBusy, setFactorBusy] = useState(false);
  const [factorDraft, setFactorDraft] = useState<{ type: "opportunity" | "risk"; text: string }>({ type: "opportunity", text: "" });
  const [attractDraft, setAttractDraft] = useState("");
  const [attractReco, setAttractReco] = useState<AttractivenessReco | null>(null);
  const [attractBusy, setAttractBusy] = useState(false);
  const [sketchView, setSketchView] = useState<SketchView | null>(null);
  const [sketchBusy, setSketchBusy] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [versionSketch, setVersionSketch] = useState<Sketch | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<"factors" | "sketch" | "entry">(
    initialTab === "sketch" || initialTab === "entry" ? initialTab : "factors",
  );

  const load = useCallback(() => {
    api.get<OpportunityRow>(`/api/opportunities/${encodeURIComponent(id)}`)
      .then((r) => setOpp(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // R2-A item 7: the S2 row action "매력도 평가" lands with the score field focused.
  const wantsScoreFocus = searchParams.get("focus") === "score";
  const scoreReady = !!opp && opp.status === "identified" && canAct;
  useEffect(() => {
    if (!wantsScoreFocus || !scoreReady) return;
    const el = document.getElementById("opp-score-input");
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  }, [wantsScoreFocus, scoreReady]);
  useEffect(() => {
    api.get<{ factors: OppFactors }>(`/api/opportunities/${encodeURIComponent(id)}/factors`)
      .then((r) => setFactors(r.data.factors))
      .catch(() => setFactors({ opportunity: [], risk: [] }));
    api.get<SketchView>(`/api/opportunities/${encodeURIComponent(id)}/sketch`)
      .then((r) => setSketchView(r.data))
      .catch(() => setSketchView(null));
  }, [id]);

  async function run(action: () => Promise<void>) { await action(); }

  async function autoDeriveFactors() {
    setFactorBusy(true); setError(null);
    try {
      const res = await api.post<{ factors: OppFactors; failed?: boolean; error?: string }>(`/api/opportunities/${encodeURIComponent(id)}/factors`, {});
      setFactors(res.data.factors);
      if (res.data.failed) setError(res.data.error ?? "AI 호출 실패 — 이전 요인을 유지합니다.");
    } catch (err) { setError(err instanceof Error ? err.message : "요인 자동 도출 실패"); }
    finally { setFactorBusy(false); }
  }
  async function addFactor(type: "opportunity" | "risk") {
    const text = factorDraft.text.trim();
    if (!text || factorDraft.type !== type) { setError("요인 내용을 입력하세요."); return; }
    setError(null);
    try {
      const res = await api.put<{ factors: OppFactors }>(`/api/opportunities/${encodeURIComponent(id)}/factors`, { type, text });
      setFactors(res.data.factors);
      setFactorDraft({ type, text: "" });
    } catch (err) { setError(err instanceof Error ? err.message : "요인 등록 실패"); }
  }
  function removeFactor(type: "opportunity" | "risk", index: number, text: string) {
    confirm("요인 삭제", async () => {
      setError(null);
      try {
        const res = await api.delete<{ factors: OppFactors }>(`/api/opportunities/${encodeURIComponent(id)}/factors`, { type, index });
        setFactors(res.data.factors);
      } catch (err) { setError(err instanceof Error ? err.message : "요인 삭제 실패"); }
    }, { body: text.length > 60 ? `${text.slice(0, 60)}…` : text });
  }

  async function evaluateAttractiveness() {
    const v = attractDraft === "" ? null : Math.min(100, Math.max(0, Number(attractDraft)));
    if (v === null || Number.isNaN(v)) { setError("매력도를 0-100 사이로 입력하세요."); return; }
    setError(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(id)}`, { attractiveness_score: v });
      // 매력도 평가 = 평가 단계 진행 — 발굴(identified) 상태면 자동으로
      // 평가(assessed)로 넘긴다 (퍼널이 평가 버튼 없이 막히지 않게, ADR-0127).
      if (opp?.status === "identified") {
        await api.put(`/api/opportunities/${encodeURIComponent(id)}`, { status: "assessed" });
      }
      setAttractDraft("");
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "매력도 평가 실패"); }
  }
  async function generateAttractDraft() {
    setAttractBusy(true); setError(null);
    try {
      const r = await api.post<AttractivenessReco>(`/api/opportunities/${encodeURIComponent(id)}/attractiveness-recommendation`, {});
      setAttractReco(r.data);
      if (r.data.recommendation.suggested_score !== null) setAttractDraft(String(r.data.recommendation.suggested_score));
    } catch (err) { setError(err instanceof Error ? err.message : "매력도 초안 생성 실패"); }
    finally { setAttractBusy(false); }
  }

  async function createSketch(force: boolean) {
    setSketchBusy(true); setError(null);
    try {
      const res = await api.post<SketchView & { version_no?: number; failed?: boolean; error?: string }>(`/api/opportunities/${encodeURIComponent(id)}/sketch`, force ? { force: true } : {});
      setSketchView({ sketch: res.data.sketch, source: res.data.source, created_at: res.data.created_at, versions: [] });
      if (res.data.failed) setError(res.data.error ?? "AI 호출 실패 — 이전 스케치를 유지합니다.");
      // 버전 목록 재조회 — 새 버전이 이력에 반영되도록
      const r = await api.get<SketchView>(`/api/opportunities/${encodeURIComponent(id)}/sketch`);
      setSketchView(r.data);
      setViewingVersion(null);
      setVersionSketch(null);
    } catch (err) { setError(err instanceof Error ? err.message : "비즈니스 모델 검토 생성 실패"); }
    finally { setSketchBusy(false); }
  }

  // 시나리오 전제만 재생성 — 캔버스/시장진입/핵심리스크는 건드리지 않는다
  // (사용자 결정: 재생성 행위를 서로 분리해 조용한 덮어쓰기를 막는다).
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [scenarioNotice, setScenarioNotice] = useState<string | null>(null);
  async function regenerateScenarios() {
    setScenarioBusy(true); setError(null); setScenarioNotice(null);
    try {
      await api.post(`/api/opportunities/${encodeURIComponent(id)}/sketch`, { force: true, regenerateScenarios: true });
      const r = await api.get<SketchView>(`/api/opportunities/${encodeURIComponent(id)}/sketch`);
      setSketchView(r.data);
      setScenarioNotice("시나리오 전제를 다시 생성했습니다 — 기회·위험 요인도 최신 상태인지 함께 확인하세요.");
    } catch (err) { setError(err instanceof Error ? err.message : "시나리오 재생성 실패"); }
    finally { setScenarioBusy(false); }
  }
  async function openVersion(n: number) {
    setError(null);
    try {
      const r = await api.get<{ sketch: Sketch }>(`/api/opportunities/${encodeURIComponent(id)}/sketch?version=${n}`);
      setViewingVersion(n);
      setVersionSketch(r.data.sketch);
    } catch (err) { setError(err instanceof Error ? err.message : "버전 열람 실패"); }
  }

  if (error && !opp) return <main><p role="alert" className="text-[color:var(--red-fg)]">{error}</p></main>;
  if (!opp) return <main><p>불러오는 중...</p></main>;

  const s3Ready = opp.synergy_score !== null && opp.attractiveness_score !== null;

  return (
    <main>
      {confirmDialog}
      <DealBreadcrumb dealId={id} stageId="S2" tail={[{ label: "기회 상세" }]} />
      <PageHeader title={opp.name} />
      <StageRail current={["S2"]} />
      <SectionToolbar
        title="기회 상세"
        summary={
          <span className="flex items-center gap-1 flex-wrap">
            <span className="section-meta">S2 기회 발굴 · {STATUS_LABEL[opp.status]}</span>
            {opp.market_scope && <span className="status-chip status-amber">{opp.market_scope}</span>}
            {opp.value_chain_node && <span className="status-chip status-not-started">{opp.value_chain_node}</span>}
          </span>
        }
        actions={
          <span className="flex items-center gap-1 flex-wrap">
            {canAct && opp.status !== "dropped" && !opp.project_id && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setClosing(true)}>종료…</button>
            )}
            <Link href={`/deals/${encodeURIComponent(id)}/s2`} className="btn-ghost btn-sm">← S2 목록으로</Link>
          </span>
        }
      />
      {closing && (
        <ClosureModal
          entity="opportunity"
          entityId={id}
          entityName={opp.name}
          onClose={() => setClosing(false)}
          onDone={() => { setClosing(false); window.location.reload(); }}
        />
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      <KnownTargetGuide opportunityId={id} />

      {/* 기회 개요 + 매력도 평가 */}
      <section aria-label="기회 개요" className="market-section">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-[length:var(--fs-body)]">매력도 <strong className="mono-num">{opp.attractiveness_score ?? "—"}</strong> / 100</span>
          {opp.synergy_score !== null && (
            <span className="text-[length:var(--fs-body)]" title={opp.synergy_score_confirmed_at ? "사람이 확정한 시너지 점수" : "사람 확정 전 권고값 — S3 화면에서 확정할 수 있습니다"}>
              시너지 <strong className="mono-num">{opp.synergy_score}</strong>
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] ml-1">{opp.synergy_score_confirmed_at ? "확정" : "권고(미확정)"}</span>
            </span>
          )}
        </div>
        {opp.rationale && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{opp.rationale}</p>}
        {canAct && opp.status === "identified" && (
          <div className="flex flex-wrap items-center gap-1">
            <input id="opp-score-input" type="number" min={0} max={100} aria-label="매력도" placeholder="매력도 0-100"
              value={attractDraft} onChange={(e) => setAttractDraft(e.target.value)}
              className="sizing-new-input sizing-new-input-sm" style={{ width: "7.5rem" }} />
            <button type="button" className="btn-ghost btn-sm" onClick={() => void evaluateAttractiveness()}>매력도 평가</button>
            <button type="button" className="btn-ghost btn-sm" disabled={attractBusy} onClick={() => void generateAttractDraft()}>
              {attractBusy ? "초안 생성 중..." : "AI 초안"}
            </button>
            {attractReco && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{attractReco.recommendation.rationale_draft.slice(0, 160) || "초안 없음"}</span>}
          </div>
        )}
        {/* S3 — 판정 결과와 S3 화면 이동 링크 (인라인 실행 없음, ADR-0127) */}
        {opp.status !== "identified" && (
          <div className="mt-2 p-2 border border-[color:var(--border)] rounded text-[length:var(--fs-caption)]">
            <span className="font-semibold">S3 시너지·전략적 적합성</span>{" "}
            {s3Ready ? (() => {
              const attractiveness = opp.attractiveness_score ?? 0;
              const synergy = opp.synergy_score ?? 0;
              const rec = synergy >= 60 && attractiveness >= 60 ? "Go" : synergy < 40 || attractiveness < 60 ? "Kill" : "Hold";
              return (
                <span className={`status-chip ${rec === "Go" ? "status-green" : rec === "Kill" ? "status-red" : "status-amber"}`}>
                  screening 권고: {rec}
                </span>
              );
            })() : (
              <span className="status-chip status-not-started">미실시</span>
            )}
            {opp.synergy_score !== null && (
              <span className="block mt-1 text-[length:var(--fs-caption)]">
                <strong>시너지 {opp.synergy_score}점</strong>
                <span className={opp.synergy_score_confirmed_at ? "" : "text-[color:var(--muted-fg)]"}>{opp.synergy_score_confirmed_at ? " (사람 확정)" : " (권고·사람 미확정)"}</span>
                {" — "}{opp.synergy_rationale ?? "근거 미기록"}
              </span>
            )}
            <div className="mt-2">
              <Link href={`/deals/${encodeURIComponent(id)}/s3`} className="btn-ghost btn-sm" title="S3 시너지·전략적 적합성 화면에서 분석합니다">S3 탭으로 이동 →</Link>
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] ml-2">필요 역량 수준도 S3 화면의 연계 시너지 탭에서 함께 관리합니다.</span>
            </div>
          </div>
        )}
      </section>

      {/* 기회·위험 요인 / 비즈니스 모델 검토 / 진입시장 산정 — 탭으로 분리 (한 화면에
          모든 섹션이 펼쳐져 있으면 스크롤이 길어져 각 섹션을 찾기 어렵다는 피드백).
          진입시장 산정은 ADR-0180에서 기회·위험 요인·비즈니스 모델 검토와 동일한
          수준의 S2 정규 산출물로 승격되어 세 번째 탭이 되었다 (카드 내부의
          스택형 3단계 표시는 2026-10-17 결정대로 유지). */}
      <div className="library-tabs" role="tablist" aria-label="기회 상세 섹션">
        <button type="button" role="tab" aria-selected={tab === "factors"} className={`library-tab ${tab === "factors" ? "library-tab-active" : ""}`} onClick={() => setTab("factors")}>
          기회·위험 요인
          <span className="library-tab-count">{(factors?.opportunity.length ?? 0) + (factors?.risk.length ?? 0)}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "sketch"} className={`library-tab ${tab === "sketch" ? "library-tab-active" : ""}`} onClick={() => setTab("sketch")}>
          비즈니스 모델 검토
          {(sketchView?.versions.length ?? 0) > 0 && <span className="library-tab-count">{sketchView!.versions.length}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === "entry"} className={`library-tab ${tab === "entry" ? "library-tab-active" : ""}`} onClick={() => setTab("entry")}>
          진입시장 산정
        </button>
      </div>

      {tab === "factors" && (
      <section aria-label="기회·위험 요인" className="market-section">
        <SectionToolbar title="기회·위험 요인" icon="" count={(factors?.opportunity.length ?? 0) + (factors?.risk.length ?? 0)} />
        <div className="chart-pair">
          <div className="chart-half sizing-grade-card">
            <h4 className="text-[length:var(--fs-body)] mb-1">✅ 기회 요인</h4>
            <ul className="sizing-note-list">
              {(factors?.opportunity ?? []).map((f, i) => (
                <li key={i}>
                  {f}
                  {canAct && <button type="button" className="btn-danger btn-sm ml-1" onClick={() => removeFactor("opportunity", i, f)}>삭제</button>}
                </li>
              ))}
              {(factors?.opportunity.length ?? 0) === 0 && <li className="text-[color:var(--muted-fg)]">{canAct ? "자동 도출 또는 수동 등록하세요." : "아직 등록된 요인이 없습니다."}</li>}
            </ul>
          </div>
          <div className="chart-half sizing-grade-card">
            <h4 className="text-[length:var(--fs-body)] mb-1">위험 요인</h4>
            <ul className="sizing-note-list">
              {(factors?.risk ?? []).map((f, i) => (
                <li key={i}>
                  {f}
                  {canAct && <button type="button" className="btn-danger btn-sm ml-1" onClick={() => removeFactor("risk", i, f)}>삭제</button>}
                </li>
              ))}
              {(factors?.risk.length ?? 0) === 0 && <li className="text-[color:var(--muted-fg)]">{canAct ? "자동 도출 또는 수동 등록하세요." : "아직 등록된 요인이 없습니다."}</li>}
            </ul>
          </div>
        </div>
        {canAct && <div className="flex flex-wrap items-center gap-1 mt-2">
          <button type="button" className="btn-ghost btn-sm" disabled={factorBusy} onClick={() => void autoDeriveFactors()}>
            {factorBusy ? "도출 중..." : "요인 자동 도출"}
          </button>
          <select aria-label="요인 유형" value={factorDraft.type} onChange={(e) => setFactorDraft({ ...factorDraft, type: e.target.value as "opportunity" | "risk" })} className="sizing-new-input sizing-new-input-sm">
            <option value="opportunity">기회</option>
            <option value="risk">위험</option>
          </select>
          <input aria-label="요인 내용" placeholder="요인 추가" value={factorDraft.text}
            onChange={(e) => setFactorDraft({ ...factorDraft, text: e.target.value })}
            className="sizing-new-input sizing-new-input-sm" style={{ flex: "1 1 12rem" }} />
          <button type="button" className="btn-ghost btn-sm" onClick={() => void addFactor(factorDraft.type)}>추가</button>
        </div>}
        {/* 시나리오 전제(낙관/기본/비관) — 비즈니스 모델 검토(sketch)에서 산출되는
            데이터지만, 요인과 함께 보는 편이 자연스러워 이 탭에 배치한다.
            위 요인 등록 폼과 바로 붙어 보여 여백을 둔다. 재생성은 비즈니스 모델
            캔버스 재생성과 분리된 별도 버튼이다(서로 조용히 덮어쓰지 않음). */}
        {(sketchView?.sketch as { scenarios?: unknown[] } | null)?.scenarios != null && (
          <div className="mt-4">
            {scenarioNotice && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--green-fg)] mb-1">{scenarioNotice}</p>}
            <ScenarioPremises
              sketch={sketchView?.sketch as unknown as Record<string, unknown> | null}
              actions={canAct ?
                <button type="button" className="btn-ghost btn-sm" disabled={scenarioBusy} onClick={() => void regenerateScenarios()}>
                  {scenarioBusy ? "재생성 중..." : "시나리오 재생성"}
                </button> : undefined
              }
            />
          </div>
        )}
      </section>
      )}

      {/* 비즈니스 모델 검토 (구: 비즈니스 모델 스케치) + 버전 이력 */}
      {tab === "sketch" && (
      <section aria-label="비즈니스 모델 검토" className="market-section">
        <SectionToolbar
          title="비즈니스 모델 검토"
          icon=""
          actions={canAct ?
            <button type="button" className="btn-ghost btn-sm" disabled={sketchBusy} onClick={() => void createSketch(sketchView?.sketch != null)}>
              {sketchBusy ? "생성 중..." : sketchView?.sketch ? "재생성 (새 버전)" : "검토 생성"}
            </button> : undefined
          }
        />
        {sketchView === null ? (
          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">아직 비즈니스 모델 검토가 없습니다 — 검토 생성으로 시작하세요.</p>
        ) : sketchView.sketch ? (
          <>
            {viewingVersion !== null && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                과거 버전 v{viewingVersion} 열람 중 —{" "}
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setViewingVersion(null); setVersionSketch(null); }}>현재 버전으로</button>
              </p>
            )}
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
              {viewingVersion === null && `현재 버전 · ${sketchView.source === "llm" ? "AI" : "결정론 합성"} · ${sketchView.created_at?.slice(0, 10) ?? ""}`}
            </p>
            <SketchCanvas sketch={(viewingVersion !== null ? versionSketch : sketchView.sketch) as unknown as Record<string, unknown>} />
          </>
        ) : (
          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">아직 비즈니스 모델 검토가 없습니다 — 검토 생성으로 시작하세요.</p>
        )}
        {(sketchView?.versions.length ?? 0) > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">검토 이력 ({sketchView!.versions.length}건 — 이전에 분석한 내용)</summary>
            <table className="data-table mt-2" aria-label="비즈니스 모델 검토 이력">
              <caption className="sr-only">비즈니스 모델 검토 이력</caption>
              <thead><tr><th scope="col">버전</th><th scope="col">생성 방식</th><th scope="col">일시</th><th scope="col"></th></tr></thead>
              <tbody>
                {sketchView!.versions.map((v) => (
                  <tr key={v.version_no}>
                    <td className="tabular-nums">v{v.version_no}</td>
                    <td>{v.source === "llm" ? "AI" : "결정론 합성"}</td>
                    <td className="tabular-nums">{v.created_at.slice(0, 10)}</td>
                    <td><button type="button" className="btn-ghost btn-sm" onClick={() => void openVersion(v.version_no)}>열람</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>
      )}

      {/* ADR-0179 consolidation / ADR-0180 promotion — the 진입시장 산정
          3-step flow is the THIRD TAB, a peer of the other two reviews. The
          card's internal stacked steps are unchanged (2026-10-17 decision). */}
      {tab === "entry" && (
        <EntryMarketFlow opportunityId={id} canAct={canAct} />
      )}

      {/* 승격 — 선별 상태이며 미승격일 때 (ADR-0095) */}
      {opp.status === "selected" && !opp.project_id && (
        <PromotionPanel opportunityId={opp.id} heading={`${opp.name} — 프로젝트로 추진 (S7 → S8)`} />
      )}
    </main>
  );
}

export default function OpportunityDetailPage() {
  return (
    <Suspense fallback={null}>
      <OpportunityDetail />
    </Suspense>
  );
}
