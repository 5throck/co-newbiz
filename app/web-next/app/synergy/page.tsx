"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";

// S3 시너지 정합성 (/synergy) — Long List(S1 시장분석 + S2 기회발굴)를
// 회사 단위 Short List로 좁히는 단계. S1 시장분석과 동일 패턴:
// ① 분석 대상 회사 테이블(등록·재분석) → ② 회사 선택 시 탭 구조 리포트.
// 재분석 시 같은 분석 행을 재사용하고 새 버전(append-only)을 쌓는다.

interface SynergyStepSummary { step: number; title: string; summary: string; source: string }
interface SynergySourceRef { title: string; url: string; snippet?: string }
interface SynergyPayload {
  company: { name: string; dartCorpCode: string | null };
  dartFinancials: { available: boolean; year?: string; items?: Array<{ name: string; value: number; year?: string }>; reportUrl?: string; error?: string };
  /** 재무 데이터 출처 — DART / 신용평가자료 / 외부 검색 (구형 버전에는 없음) */
  dataSources?: { dart: boolean; dartYear: string | null; creditReport: string | null; webResearchCount: number };
  researchSources: SynergySourceRef[];
  financialStrengths: string[];
  financialWeaknesses: string[];
  businessAssessment: string;
  marketLinkage: {
    marketSummaries: Array<{ industry: string; cagrPct: number | null; gapPct: number | null; newDrivers: string[] }>;
    synergyAreas: Array<{ area: string; synergyType: string; rationale: string; opportunity: string; risk: string; sources: string[] }>;
  };
  shortList: Array<{ rank: number; area: string; verdict: string; reason: string }>;
  stepSummaries: SynergyStepSummary[];
}
interface SynergyAnalysis {
  id: string; status: "in_progress" | "completed"; current_step: number;
  company_name: string; dart_corp_code: string | null; source_ref?: string | null;
  created_at: string; completed_at: string | null; latest_version: number | null;
  versions?: Array<{ version_no: number; payload: SynergyPayload | null; changelog: string | null; created_by: string; created_at: string }>;
}

const STEP_TITLES = ["DART 재무 입수", "외부 리서치", "재무 강/약점 분석", "S1·S2 연계 시너지", "Short List 정리"];

const TABS = [
  ["finance", "재무 현황"],
  ["swot", "강/약점"],
  ["linkage", "연계 시너지"],
  ["shortlist", "Short List"],
  ["refs", "출처·노트"],
] as const;

type TabKey = (typeof TABS)[number][0];

export function SynergyView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [analyses, setAnalyses] = useState<SynergyAnalysis[] | null>(null);
  const [selected, setSelected] = useState<SynergyAnalysis | null>(null);
  const [detail, setDetail] = useState<SynergyAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [corpCode, setCorpCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  // 신규 회사 모달 — DART 검색 / 비상장(업로드·외부 검색)
  const [mode, setMode] = useState<"dart" | "manual">("dart");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ corp_code: string; corp_name: string }>>([]);
  const [dartConfigured, setDartConfigured] = useState(true);
  const [uploadedFile, setUploadedFile] = useState<{ stored_as: string; original_name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [webResults, setWebResults] = useState<Array<{ title: string; url: string; snippet?: string }> | null>(null);
  const [webSearching, setWebSearching] = useState(false);
  const [selectedCorp, setSelectedCorp] = useState<{ corp_code: string; corp_name: string } | null>(null);
  const [tab, setTab] = useState<TabKey>("finance");

  const selectedId = searchParams.get("company");

  const refresh = useCallback(() => {
    return api.get<{ analyses: SynergyAnalysis[] }>("/api/synergy/analyses")
      .then((r) => { setAnalyses(r.data.analyses); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // URL(?company=) 기반 선택 — 상단 바 뒤로 가기와 연동
  useEffect(() => {
    if (!selectedId) {
      // 뒤로 가기(목록 복귀) — 선택 상태를 해제한다
      setSelected(null);
      setDetail(null);
      return;
    }
    if (analyses === null) return;
    const found = analyses.find((a) => a.id === selectedId) ?? null;
    setSelected(found);
    if (!found) { setDetail(null); return; }
    if (found.status === "completed") {
      api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(found.id)}`)
        .then((r) => setDetail(r.data))
        .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
    } else {
      setDetail(null);
    }
  }, [selectedId, analyses]);

  const hasInProgress = analyses?.some((a) => a.status === "in_progress") ?? false;
  useEffect(() => {
    if (!hasInProgress) return;
    const t = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(t);
  }, [hasInProgress, refresh]);

  // 선택한 회사의 분석이 완료되면 상세 리포트를 자동으로 활성화한다
  useEffect(() => {
    if (!selectedId || selected?.status !== "in_progress") return;
    const t = setInterval(async () => {
      try {
        const r = await api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(selectedId)}`);
        if (r.data.status === "completed") { setDetail(r.data); setSelected(r.data); }
      } catch { /* 다음 폴링에서 재시도 */ }
    }, 4000);
    return () => clearInterval(t);
  }, [selectedId, selected?.status]);

  const openDetail = useCallback((a: SynergyAnalysis) => {
    router.replace(`/synergy?company=${encodeURIComponent(a.id)}`);
    setSelected(a);
    setDetail(null);
    if (a.status === "completed") {
      api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(a.id)}`)
        .then((r) => setDetail(r.data))
        .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
    }
  }, []);

  const backToList = useCallback(() => {
    router.replace("/synergy");
    setSelected(null);
    setDetail(null);
    void refresh();
  }, [refresh]);

  async function create() {
    const name = (mode === "dart" ? selectedCorp?.corp_name ?? "" : companyName).trim();
    if (!name || creating) return;
    // DART 검증 — DART 검색 모드에서 선택된 회사가 아니면 경고를 띄우고 등록을 중단한다
    // (상장·외감 회사를 의도한 경우 DART 미등록은 오입력일 가능성이 높다).
    if (mode === "dart" && !selectedCorp) {
      setError("DART 검색 결과에서 회사를 선택하세요 — DART에 없는 회사는 '비상장·직접 입력' 모드로 등록할 수 있습니다.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const sourceRef = [
        uploadedFile ? `신용평가자료: ${uploadedFile.original_name} (${uploadedFile.stored_as})` : "",
        webResults && webResults.length > 0 ? "외부 검색 확인" : "",
      ].filter(Boolean).join(" · ") || undefined;
      const res = await api.post<{ analysis_id: string }>("/api/synergy/analyses", {
        company_name: name,
        dart_corp_code: mode === "dart" ? selectedCorp?.corp_code || corpCode.trim() || undefined : undefined,
        source_ref: sourceRef,
      });
      setCompanyName(""); setCorpCode(""); setQuery(""); setSearchResults([]); setSelectedCorp(null);
      setUploadedFile(null); setWebResults(null); setShowNewForm(false);
      // 최신 목록에서 생성된 분석을 찾아 "분석 중" 상세로 진입한다 (모달 닫힘)
      const list = await api.get<{ analyses: SynergyAnalysis[] }>("/api/synergy/analyses");
      setAnalyses(list.data.analyses);
      const created = list.data.analyses.find((a) => a.id === res.data.analysis_id);
      if (created) openDetail({ ...created, status: "in_progress" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석 생성 실패");
    } finally {
      setCreating(false);
    }
  }

  async function searchDart() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setError(null);
    try {
      const res = await api.get<{ configured: boolean; results: Array<{ corp_code: string; corp_name: string }> }>(`/api/synergy/dart-search?q=${encodeURIComponent(query.trim())}`);
      setSearchResults(res.data.results);
      if (!res.data.configured) setError("DART API 키가 구성되지 않았습니다 (CO_NEWBIZ_DART_* 환경변수). 비상장 입력 모드를 사용하세요.");
      else if (res.data.results.length === 0) setError("검색 결과가 없습니다 — 회사명을 확인하거나 비상장 입력 모드를 사용하세요.");
      else setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "DART 검색 실패");
    } finally {
      setSearching(false);
    }
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.upload<{ stored_as: string; original_name: string }>("/api/synergy/upload", form);
      setUploadedFile({ stored_as: res.data.stored_as, original_name: res.data.original_name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드 실패");
    } finally {
      setUploading(false);
    }
  }

  async function searchWeb() {
    const name = (mode === "manual" ? companyName : query).trim();
    if (!name || webSearching) return;
    setWebSearching(true);
    setError(null);
    try {
      const res = await api.get<{ configured: boolean; results: Array<{ title: string; url: string; snippet?: string }> }>(`/api/synergy/web-search?q=${encodeURIComponent(name)}`);
      setWebResults(res.data.results);
      if (!res.data.configured) setError("외부 검색(TAVILY)이 구성되지 않았습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "외부 검색 실패");
    } finally {
      setWebSearching(false);
    }
  }

  async function rerun(a: SynergyAnalysis) {
    setError(null);
    try {
      const res = await api.post<{ analysis_id: string }>("/api/synergy/analyses", { company_name: a.company_name, dart_corp_code: a.dart_corp_code ?? undefined });
      // 최신 목록에서 해당 분석을 in_progress 상태로 가져와 상세 진입 → 완료 폴링이 자동 활성화된다
      const list = await api.get<{ analyses: SynergyAnalysis[] }>("/api/synergy/analyses");
      setAnalyses(list.data.analyses);
      const updated = list.data.analyses.find((x) => x.id === res.data.analysis_id);
      if (updated) openDetail({ ...updated, status: "in_progress" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "재분석 시작 실패");
    }
  }

  // ── 상세 (회사 선택 시) ──
  if (selected) {
    const selectedAnalysis = detail ?? selected;
    return (
      <main>
        <SynergyResult
          analysis={selectedAnalysis}
          tab={tab}
          onTab={(k) => setTab(k)}
          onBack={backToList}
          onRerun={() => rerun(selected)}
        />
      </main>
    );
  }

  // ── 목록 (분석 대상 회사) ──
  return (
    <main>
      <h1>시너지 정합성</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        <strong>Brownfield 경로 전용 도구</strong> — 특정 대상 회사의 DART 재무·외부 리서치를 입수해
        S1 시장분석·S2 기회발굴과의 연계 시너지를 검증하고 Short List 영역을 좁힙니다
        (스펙상 3단계 시너지 평가는 기회 단위로, 기회 레지스트리의 S3 패널에서 수행됩니다).
        본격 활용은 S6 대상 후보 발굴·S7 대상 스크리닝 단계입니다.
      </p>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      <section aria-label="분석 대상 회사" className="market-section">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h2 className="text-[0.92rem] !mb-0">🏢 분석 대상 회사</h2>
          <span className="text-[0.72rem] text-[color:var(--muted-fg)]">{analyses?.length ?? 0}건</span>
          <button
            type="button"
            className="btn-ghost text-[0.8rem]"
            onClick={() => setShowNewForm((v) => !v)}
            aria-expanded={showNewForm}
          >
            {showNewForm ? "취소" : "＋ 회사 등록"}
          </button>
        </div>

        {analyses === null ? (
          <p>불러오는 중...</p>
        ) : analyses.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 시너지 분석이 없습니다. "회사 등록"으로 시작하세요.</p>
        ) : (
          <table className="data-table" aria-label="분석 대상 회사 목록">
            <caption className="sr-only">분석 대상 회사 목록</caption>
            <thead>
              <tr>
                <th scope="col">회사명</th>
                <th scope="col">DART 코드</th>
                <th scope="col">분석 상태</th>
                <th scope="col">분석일</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a) => {
                const inProgress = a.status === "in_progress";
                return (
                  <tr key={a.id} className={selectedId === a.id ? "row-selected" : undefined}>
                    <td className="cell-primary">
                      <button
                        type="button"
                        className="font-semibold text-left underline-offset-2 hover:underline"
                        title="시너지 정합성 리포트 열기"
                        onClick={() => openDetail(a)}
                      >
                        {a.company_name}
                      </button>
                    </td>
                    <td>{a.dart_corp_code ? <code className="dd-item-id">{a.dart_corp_code}</code> : <span className="status-chip status-amber" title="DART 코드 미확인 — 재분석 또는 등록 시 입력">DART 미확인</span>}</td>
                    <td>
                      {inProgress ? (
                        <span className="status-chip status-amber">분석 중 ({a.current_step}/5단계)</span>
                      ) : (
                        <span className="status-chip status-green">분석 완료 (v{a.latest_version ?? 1})</span>
                      )}
                    </td>
                    <td className="tabular-nums">{(a.completed_at ?? a.created_at).slice(0, 10)}</td>
                    <td className="sizing-actions-cell">
                      <button type="button" className="btn-ghost text-[0.78rem]" disabled={inProgress} onClick={() => openDetail(a)}>
                        {inProgress ? "분석 중" : "열기"}
                      </button>
                      {!inProgress && (
                        <button
                          type="button"
                          className="btn-ghost text-[0.78rem]"
                          title="같은 분석 행을 재사용해 새 버전으로 재실행합니다"
                          onClick={() => rerun(a)}
                        >
                          재분석
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {hasInProgress && <p className="mt-2 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]" role="status">분석이 진행 중입니다 — 완료되면 목록이 자동으로 갱신됩니다.</p>}
      </section>

      {/* ── 신규 회사 등록 모달 ── */}
      {showNewForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="신규 회사 등록" onClick={(e) => { if (e.target === e.currentTarget) setShowNewForm(false); }}>
          <div className="modal-panel">
            <div className="modal-head">
              <h2>＋ 신규 회사 등록</h2>
              <button type="button" className="btn-ghost text-[0.78rem]" onClick={() => setShowNewForm(false)}>닫기</button>
            </div>
            <div className="flex gap-1 mb-3">
              {([["dart", "DART 검색 (상장·외감)"], ["manual", "비상장·직접 입력"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={mode === key}
                  className={`status-chip ${mode === key ? "status-green" : "status-not-started"}`}
                  onClick={() => setMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "dart" && (
              <>
                <div className="flex gap-2 mb-2">
                  <input
                    aria-label="DART 회사명 검색"
                    placeholder="회사명 입력 후 검색 (예: 삼성전자)"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchDart(); } }}
                    className="sizing-new-input"
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn-ghost text-[0.8rem]" disabled={searching || !query.trim()} onClick={() => void searchDart()}>
                    {searching ? "검색 중..." : "검색"}
                  </button>
                </div>
                {searchResults.length > 0 && (
                  <ul className="sizing-note-list" role="listbox" aria-label="DART 검색 결과">
                    {searchResults.map((r) => (
                      <li key={r.corp_code}>
                        <button
                          type="button"
                          aria-pressed={selectedCorp?.corp_code === r.corp_code}
                          className={`btn-ghost text-[0.8rem] w-full text-left ${selectedCorp?.corp_code === r.corp_code ? "font-semibold" : ""}`}
                          onClick={() => setSelectedCorp(r)}
                        >
                          {selectedCorp?.corp_code === r.corp_code ? "✔ " : ""}{r.corp_name} <code className="dd-item-id">{r.corp_code}</code>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {mode === "manual" && (
              <>
                <label className="text-[0.78rem] block mb-2">
                  <span className="block mb-1">회사명 *</span>
                  <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="비상장·신생 기업명" className="sizing-new-input" style={{ width: "100%" }} />
                </label>
                <label className="text-[0.78rem] block mb-2">
                  <span className="block mb-1">신용평가자료 등 근거 파일 업로드 (선택, 20MB 이하)</span>
                  <input
                    type="file"
                    aria-label="신용평가자료 업로드"
                    disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }}
                    className="sizing-new-input"
                    style={{ width: "100%" }}
                  />
                </label>
                {uploadedFile && (
                  <p className="text-[0.75rem] text-[color:var(--green-fg)]">✔ 업로드 완료: {uploadedFile.original_name}</p>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <button type="button" className="btn-ghost text-[0.78rem]" disabled={webSearching || !companyName.trim()} onClick={() => void searchWeb()}>
                    {webSearching ? "외부 검색 중..." : "🌐 외부 검색으로 회사 확인"}
                  </button>
                  <span className="text-[0.72rem] text-[color:var(--muted-fg)]">기관·뉴스 리서치로 존재성·사업 내용을 확인할 수 있습니다.</span>
                </div>
                {webResults && (
                  <ul className="sizing-note-list sizing-grade-card">
                    {webResults.length === 0 && <li className="text-[color:var(--muted-fg)]">검색 결과가 없습니다.</li>}
                    {webResults.map((r) => (
                      <li key={r.url}>
                        <a href={r.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{r.title}</a>
                        {r.snippet && <span className="text-[color:var(--muted-fg)]"> — {r.snippet}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            <div className="flex justify-end mt-3">
              <button
                type="button"
                className="btn-ghost text-[0.85rem]"
                disabled={creating || (mode === "dart" ? !selectedCorp : !companyName.trim())}
                title={mode === "dart" && !selectedCorp ? "검색 결과에서 회사를 선택하세요" : undefined}
                onClick={() => void create()}
              >
                {creating ? "분석 시작 중..." : "분석 시작"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function SynergyResult({ analysis, tab, onTab, onBack, onRerun }: {
  analysis: SynergyAnalysis;
  tab: TabKey;
  onTab: (k: TabKey) => void;
  onBack: () => void;
  onRerun: () => void;
}) {
  const latest = analysis.versions?.[0] ?? null;
  const p = latest?.payload ?? null;
  const inProgress = analysis.status === "in_progress";
  const analysisDate = latest?.created_at?.slice(0, 10) ?? analysis.created_at.slice(0, 10);
  return (
    <section aria-label="시너지 정합성 리포트" className="market-section sizing-step">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="text-[0.95rem] !mb-0">🏢 {analysis.company_name} 시너지 정합성 분석</h2>
        <span className="text-[0.72rem] text-[color:var(--muted-fg)]">
          S3 Long List → Short List · 분석일 {analysisDate} · v{latest?.version_no ?? analysis.latest_version ?? 1}
        </span>
        <button
          type="button"
          className="btn-ghost text-[0.78rem]"
          style={{ marginLeft: "auto" }}
          disabled={inProgress}
          onClick={onRerun}
        >
          재분석
        </button>
      </div>

      {inProgress && (
        <p className="text-[0.85rem]" role="status">
          분석 중 ({analysis.current_step}/5단계) — {STEP_TITLES[analysis.current_step] ?? ""} 진행 중입니다. 완료되면 자동 갱신됩니다.
        </p>
      )}
      {!p && !inProgress && <p className="text-[color:var(--muted-fg)] italic">분석 결과가 없습니다.</p>}

      {p && (
        <>
          <div className="library-tabs" role="tablist" aria-label="리포트 섹션">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`library-tab ${tab === key ? "library-tab-active" : ""}`} onClick={() => onTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "finance" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">1</span> 재무 현황 (DART {p.dartFinancials.available ? `${p.dartFinancials.year}년 사업보고서` : "미입수"})</h3>
              {p.dartFinancials.available && p.dartFinancials.items ? (
                <table className="data-table" aria-label="DART 재무 요약">
                  <caption className="sr-only">DART 재무 요약</caption>
                  <thead><tr><th scope="col">계정</th><th scope="col">연도</th><th scope="col">금액 (억원)</th><th scope="col" className="w-[5rem]">출처</th></tr></thead>
                  <tbody>
                    {p.dartFinancials.items.map((i, idx) => (
                      <tr key={`${i.year ?? ""}-${i.name}-${idx}`}>
                        <td className="font-semibold">{i.name}</td>
                        <td className="tabular-nums">{i.year ?? "—"}</td>
                        <td className="tabular-nums">{(i.value / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 })} 억원</td>
                        <td><span className="status-chip status-green">DART</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">DART 미입수 — {p.dartFinancials.error ?? "사유 없음"} (웹 리서치로 보완)</p>
              )}
              {p.dartFinancials.reportUrl && (
                <a href={p.dartFinancials.reportUrl} target="_blank" rel="noreferrer" className="text-[0.8rem] text-[color:var(--accent)] underline">사업보고서 원문 보기 (DART)</a>
              )}

              {/* 재무 데이터 출처 — DART / 신용평가자료 / 외부 검색 */}
              <div className="sizing-grade-card mt-3">
                <h4 className="text-[0.85rem] mb-2">🔎 재무 데이터 출처</h4>
                <ul className="sizing-note-list">
                  <li>
                    {p.dataSources?.dart ? "✅" : "⚠️"} DART 전자공시 — {p.dataSources?.dart ? `${p.dataSources.dartYear ?? ""} 사업보고서 재무제표` : "미입수 (비상장 또는 미구성)"}
                  </li>
                  <li>
                    {p.dataSources?.creditReport ? "✅" : "⚪"} 신용평가자료 — {p.dataSources?.creditReport ?? "미첨부 (비상장 회사 등록 시 업로드 가능)"}
                  </li>
                  <li>
                    {(p.dataSources?.webResearchCount ?? 0) > 0 ? "✅" : "⚪"} 외부 검색·리서치 — {(p.dataSources?.webResearchCount ?? 0)}건 (기관·증권사·뉴스, 출처는 "출처·노트" 탭)
                  </li>
                </ul>
                <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
                  재무 수치는 DART 공시 기준(최근 3년 연도별)이며, corp_code를 모르면 "DART 코드 입력" 후 재분석하면 연도별 재무제표를 직접 조회합니다. 비상장 회사는 신용평가자료·외부 리서치로 보강됩니다(출처 명기).
                </p>
              </div>
            </div>
          )}

          {tab === "swot" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">2</span> 재무·사업 강/약점 분석</h3>
              <div className="chart-pair">
                <div className="chart-half sizing-grade-card">
                  <h4 className="text-[0.9rem] mb-2">💪 강점</h4>
                  <ul className="sizing-note-list">{p.financialStrengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
                <div className="chart-half sizing-grade-card">
                  <h4 className="text-[0.9rem] mb-2">🩹 약점</h4>
                  <ul className="sizing-note-list">{p.financialWeaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              </div>
              <p className="mt-3 mb-0 text-[0.88rem]"><strong>종합 평가:</strong> {p.businessAssessment}</p>
            </div>
          )}

          {tab === "linkage" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">3</span> S1·S2 연계 시너지 영역 (Long List → 분석)</h3>
              <p className="mb-2 text-[0.8rem] text-[color:var(--muted-fg)]">
                연계 시장: {p.marketLinkage.marketSummaries.map((m) => `${m.industry} (CAGR ${m.cagrPct ?? "?"}%${m.gapPct !== null ? `, 격차 ${m.gapPct > 0 ? "+" : ""}${m.gapPct}%` : ""})`).join(" · ") || "없음"}
              </p>
              <table className="data-table" aria-label="시너지 영역">
                <caption className="sr-only">시너지 영역</caption>
                <thead>
                  <tr><th scope="col">영역</th><th scope="col">유형</th><th scope="col">근거</th><th scope="col">기회</th><th scope="col">위험</th></tr>
                </thead>
                <tbody>
                  {p.marketLinkage.synergyAreas.map((a) => (
                    <tr key={a.area}>
                      <td className="font-semibold">{a.area}</td>
                      <td className="text-[0.8rem]">{a.synergyType}</td>
                      <td className="text-[0.85rem]">{a.rationale}{a.sources.length > 0 && <span className="text-[color:var(--muted-fg)]"> (출처: {a.sources.join(", ")})</span>}</td>
                      <td className="text-[0.85rem]">{a.opportunity}</td>
                      <td className="text-[0.85rem]">{a.risk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "shortlist" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge sizing-step-badge-deep">4</span> Short List — 시너지 영역 선별</h3>
              <table className="data-table" aria-label="시너지 Short List">
                <caption className="sr-only">시너지 Short List</caption>
                <thead><tr><th scope="col">순위</th><th scope="col">영역</th><th scope="col">판정</th><th scope="col">사유</th></tr></thead>
                <tbody>
                  {p.shortList.map((s) => (
                    <tr key={s.rank}>
                      <td className="tabular-nums font-semibold">{s.rank}</td>
                      <td className="font-semibold">{s.area}</td>
                      <td><span className={`status-chip ${s.verdict.includes("Short") ? "status-green" : "status-not-started"}`}>{s.verdict}</span></td>
                      <td className="text-[0.85rem]">{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">
                Short List 확정 이후 흐름(트랙 결정·대상 스크리닝)은 flow.spec v2.0.0 재설계에 따라 재구축 예정입니다.
              </p>
            </div>
          )}

          {tab === "refs" && (
            <div className="text-[0.88rem]">
              {p.researchSources.length > 0 && (
                <details className="market-section" open>
                  <summary className="cursor-pointer text-[0.85rem]">📚 입수 출처 ({p.researchSources.length}건 — 출처 명기·교차검증)</summary>
                  <ul className="sizing-note-list mt-2">
                    {p.researchSources.map((s, i) => (
                      <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a><span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span></li>
                    ))}
                  </ul>
                </details>
              )}
              <details className="market-section" open>
                <summary className="cursor-pointer text-[0.85rem]">📝 파이프라인 단계별 노트 ({p.stepSummaries.length}단계)</summary>
                <ol className="mt-3 space-y-2 text-[0.85rem]">
                  {p.stepSummaries.map((s) => (
                    <li key={s.step}><strong>{s.step}. {s.title}</strong> <span className={`status-chip ${s.source === "llm" ? "status-in-progress" : "status-not-started"}`}>{s.source === "llm" ? "LLM" : "시스템"}</span><br />{s.summary}</li>
                  ))}
                </ol>
              </details>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function SynergyPage() {
  return (
    <Suspense fallback={null}>
      <SynergyView />
    </Suspense>
  );
}
