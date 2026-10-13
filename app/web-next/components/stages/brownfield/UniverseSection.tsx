"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { SECTION_IDS } from "./constants.ts";
import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";

export function UniverseSection({ ctx }: { ctx: BrownfieldStageState }) {
  const { selected, canAct, discoveryPanel, setDiscoveryPanel, proposals, webProposals, newTarget, setNewTarget, setDartResults, dartBusy, searchDartCompanies, busy, dartError, dartResults, acceptProposal, openUniverseEditor, generateWebProposals, addTarget } = ctx;
  return (
    <>{selected && (
        <div id={SECTION_IDS.universe} className="grid gap-3 items-stretch md:grid-cols-[2fr_3fr]" style={{ scrollMarginTop: "1rem" }}>
        <section aria-label="목표 시장 정의" className="market-section mb-0 flex flex-col">
          <SectionToolbar
            title="목표 시장 정의"
            actions={canAct && selected.universe && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={openUniverseEditor}>수정</button>}
          />
          <div className="sizing-grade-card flex-1">
            {selected.universe ? (
              <>
                {selected.universe.scope && <p className="mb-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">커버리지 범위: {selected.universe.scope}</p>}
                <p className="mb-2 text-[length:var(--fs-body)]">{selected.universe.definition}</p>
              </>
            ) : (
              <>
                <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  아직 정의되지 않았습니다 — S6 완료기준입니다. 후보 등록 전에 후보 자격 기준(후보 전체 목록 범위)과 최소 커버리지를 확정하세요. 후보 전체 목록을 최종 후보 목록으로 좁히는 실제 평가는 S7의 재무·기술 평가에서 이뤄집니다.
                </p>
                {canAct && <button type="button" className="btn-ghost btn-sm" onClick={openUniverseEditor}>목표 시장 정의 시작</button>}
              </>
            )}
          </div>
        </section>

        {/* ── S6 ② 후보 발굴 — 시장·기업 마스터 기반 제안 / 웹 검색·LLM 제안
            두 방식을 한 카드에 모은다(mockup baseline-v5.html S6/S7 card② 차용).
            목표 시장 정의 옆에 좌/우로 배치한다(사용자 요청, 2026-09-15). ── */}
        <section aria-label="후보 발굴" className="market-section mb-0 flex flex-col">
          <SectionToolbar title="후보 발굴 — 후보 전체 목록 채우기" />
          <div className="sizing-grade-card flex-1">
            {!canAct && <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">후보 발굴·등록은 분석가 권한이 필요합니다.</p>}
            {canAct && (<>
            <div className="flex flex-wrap gap-2 mb-2">
              <button
                type="button"
                className={`btn-ghost btn-sm ${discoveryPanel === "master" ? "control-chip status-green" : ""}`}
                onClick={() => setDiscoveryPanel(discoveryPanel === "master" ? null : "master")}
              >
                시장·기업 마스터{proposals && proposals.length > 0 ? ` (${proposals.length})` : ""}
              </button>
              <button
                type="button"
                className={`btn-ghost btn-sm ${discoveryPanel === "web" ? "control-chip status-green" : ""}`}
                onClick={() => {
                  setDiscoveryPanel("web");
                  if (webProposals === null) void generateWebProposals();
                }}
              >
                웹검색{webProposals && webProposals.length > 0 ? ` (${webProposals.length})` : ""}
              </button>
            </div>

            {/* 등록 폼 + 전자공시 검색 통합(사용자 요청, 2026-09-15) — 회사명을 입력하고
                "전자공시 검색"으로 찾은 결과를 클릭하면 회사명·고유번호가 폼에 채워진다.
                전자공시에 없는(비상장 등) 회사는 그대로 직접 입력해 등록할 수 있다.
                dart_corp_code가 채워진 채 등록되면 상세 화면의 전자공시 정보(재무
                facts·공시)가 바로 활성화된다. */}
            <form onSubmit={addTarget} className="sizing-new-form mb-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[length:var(--fs-caption)]" style={{ flex: "1 1 14rem" }}>
                  <span className="block mb-1">후보 회사명 * (후보 전체 목록)</span>
                  <input
                    value={newTarget.company_name}
                    onChange={(e) => { setNewTarget({ ...newTarget, company_name: e.target.value }); setDartResults(null); }}
                    placeholder="예: 레인보우로보틱스"
                    required
                    className="sizing-new-input w-full"
                  />
                </label>
                <label className="text-[length:var(--fs-caption)]" style={{ flex: "1 1 11rem" }}>
                  <span className="block mb-1">전자공시 고유번호 (선택, 8자리)</span>
                  <input value={newTarget.dart_corp_code} onChange={(e) => setNewTarget({ ...newTarget, dart_corp_code: e.target.value })} placeholder="검색 결과 선택 또는 직접 입력" className="sizing-new-input sizing-new-input-sm w-full" />
                </label>
                <button
                  type="button"
                  className="btn-ghost btn-sm whitespace-nowrap shrink-0"
                  disabled={dartBusy || !newTarget.company_name.trim()}
                  onClick={() => void searchDartCompanies(newTarget.company_name)}
                >
                  {dartBusy ? "검색 중..." : "전자공시 검색"}
                </button>
                <button type="submit" className="btn-premium btn-sm shrink-0" disabled={busy || !newTarget.company_name.trim()}>후보 등록</button>
              </div>
              {dartError && <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{dartError}</p>}
              {dartResults !== null && dartResults.length === 0 && !dartError && (
                <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">전자공시 검색 결과가 없습니다 — 비상장 등 미등록 회사라면 위 필드에 직접 입력해 등록하세요.</p>
              )}
              {dartResults !== null && dartResults.length > 0 && (
                <ul className="sizing-note-list mt-1">
                  {dartResults.map((r) => (
                    <li key={r.corp_code} className="flex flex-wrap items-center gap-2">
                      <code className="dd-item-id">{r.corp_code}</code>
                      <span className="flex-1 min-w-[12rem] text-[length:var(--fs-caption)]">{r.corp_name}</span>
                      {r.source === "web" ? (
                        <span className="status-chip status-amber" title="전자공시 직접 조회 실패 시 웹 검색으로 수집된 미검증 후보">웹 수집</span>
                      ) : (
                        <span className="status-chip status-green" title={r.source === "local" ? "기업 마스터" : "전자공시 기업목록 조회"}>검증</span>
                      )}
                      <button
                        type="button"
                        className="btn-ghost btn-sm whitespace-nowrap"
                        aria-pressed={newTarget.dart_corp_code === r.corp_code}
                        onClick={() => { setNewTarget((prev) => ({ ...prev, company_name: r.corp_name, dart_corp_code: r.corp_code })); setDartResults(null); }}
                      >
                        {newTarget.dart_corp_code === r.corp_code ? "✔ 선택됨" : "이 회사로 채우기"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </form>

            {discoveryPanel === "master" && (
              <div className="mb-2">
                {proposals === null ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">불러오는 중...</p>
                ) : proposals.length === 0 ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">제안 가능한 신규 후보가 없습니다 — 직접 등록하거나 웹검색 제안을 시도하세요.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {proposals.map((c) => (
                      <button key={c.id} type="button" className="control-chip"
                        title={c.dart_corp_code ? `DART ${c.dart_corp_code}` : undefined}
                        onClick={() => acceptProposal(c.name_ko, c.dart_corp_code)}>
                        ＋ {c.name_ko}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">수용 시 discovery_source=master_proposal로 기록됩니다.</p>
              </div>
            )}
            </>)}
          </div>
        </section>
        </div>
      )}</>
  );
}
