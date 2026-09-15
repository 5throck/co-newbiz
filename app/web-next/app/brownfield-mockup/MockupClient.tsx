"use client";

import { useState } from "react";
import { StageFrame } from "../../components/StageFrame.tsx";
import { SectionToolbar } from "../../components/layout.tsx";
import { TabNav } from "../../components/TabNav.tsx";

// S6/S7 재설계 목업 (실서비스 미반영) — ux-designer-agent 설계안을 실제 앱의
// 컴포넌트·CSS 토큰으로 구현한 클릭 가능한 목업. 정적 데이터만 쓰며 API를
// 호출하지 않는다 — 검토용 산출물이고, 승인되면 /brownfield에 실제로
// 반영한다. 실제 화면(/brownfield)은 이 목업과 무관하게 그대로 동작한다.

const GLYPHS = ["충", "충", "충", "충", "미판정", "미판정", "미판정", "미판정", "미판정"];

function ScreeningStrip() {
  return (
    <span className="flex items-center gap-0.5" aria-label="스크리닝 진행 4/9">
      {GLYPHS.map((g, i) => (
        <span
          key={i}
          className={`status-chip ${g === "충" ? "status-green" : "status-not-started"}`}
          style={{ minWidth: "1.4rem", padding: "0 0.15rem", textAlign: "center", fontSize: "0.68rem" }}
        >
          {g === "충" ? "충" : "·"}
        </span>
      ))}
    </span>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const [dtab, setDtab] = useState<"screen" | "fin" | "tech" | "verdict">("screen");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="대성전기공업 평가 워크스페이스"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(34rem, 92vw)",
          background: "var(--surface)", borderLeft: "1px solid var(--border)",
          display: "flex", flexDirection: "column", boxShadow: "var(--shadow-xl)",
        }}
      >
        <div className="modal-head" style={{ padding: "1.25rem 1.5rem 0.75rem" }}>
          <div>
            <h2 style={{ marginBottom: "0.15rem" }}>대성전기공업</h2>
            <p className="text-[0.75rem] text-[color:var(--muted-fg)]">
              <code className="dd-item-id">00123456</code> · 심사 중
            </p>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="닫기">닫기</button>
        </div>
        <div style={{ padding: "0 1.5rem" }}>
          <TabNav
            tabs={[
              { key: "screen", label: "스크리닝" },
              { key: "fin", label: "재무" },
              { key: "tech", label: "기술" },
              { key: "verdict", label: "판정" },
            ]}
            active={dtab}
            onSelect={(k) => setDtab(k as typeof dtab)}
            label="평가 워크스페이스 섹션"
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem" }}>
          {dtab === "screen" && (
            <ul className="sizing-note-list">
              {[
                ["t-01", "소유권/가용성", "충족"],
                ["t-02", "규제 스크린", "충족"],
                ["t-08", "재무적 매력도", "7/10"],
              ].map(([id, label, verdict]) => (
                <li key={id} className="flex items-center justify-between gap-2">
                  <span><code className="dd-item-id mr-1">{id}</code>{label}</span>
                  <span className="status-chip status-green">{verdict}</span>
                </li>
              ))}
              <li className="text-[0.72rem] text-[color:var(--muted-fg)]">t-03~t-07, t-09 미판정 — 전체 스크리닝은 실제 화면과 동일하게 9개 항목입니다.</li>
            </ul>
          )}
          {dtab === "fin" && (
            <>
              <div className="sizing-grade-card mb-3">
                <p className="mb-1 text-[0.78rem]">매출액 850 → 920 → 1,010 → 1,080 → 1,120억원</p>
                <p className="mb-1 text-[0.78rem]">영업이익 53 → 49 → 46 → 48 → 54억원</p>
                <p className="mb-0 text-[0.75rem] text-[color:var(--muted-fg)]">2025 참고 비율 — 영업이익률 4.8% · 부채비율 62%</p>
              </div>
              <ul className="sizing-note-list">
                <li className="flex items-center justify-between gap-2"><span>매출액 규모·5개년 추이</span><span className="status-chip status-green">충족</span></li>
                <li className="flex items-center justify-between gap-2"><span>영업이익 규모·5개년 추이(흑자 지속 여부 포함)</span><span className="status-chip status-not-started">미판정</span></li>
                <li className="flex items-center justify-between gap-2"><span>부채 규모·5개년 추이(부채비율 포함)</span><span className="status-chip status-not-started">미판정</span></li>
              </ul>
            </>
          )}
          {dtab === "tech" && (
            <ul className="sizing-note-list">
              <li className="flex items-center justify-between gap-2">
                <span>관절 감속기 설계 역량 <span className="status-chip status-amber ml-1">S3 승계·필수</span></span>
                <span className="status-chip status-not-started">미판정</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span>돌봄 규제 컴플라이언스 <span className="status-chip status-amber ml-1">S3 승계·필수</span></span>
                <span className="status-chip status-green">충족</span>
              </li>
            </ul>
          )}
          {dtab === "verdict" && (
            <>
              <p className="mb-2 text-[0.8rem]">스크리닝 4/9 · 재무 1/3 · 기술 1/2</p>
              <p className="mb-0 text-[0.75rem] text-[color:var(--muted-fg)]">필수 미판정 항목이 남아 있어 Short List 승격은 아직 비활성입니다(실제 게이트와 동일 로직).</p>
            </>
          )}
        </div>
        <div style={{ padding: "0.9rem 1.5rem", borderTop: "1px solid var(--border)", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button type="button" className="btn-premium">판정 저장</button>
          <button type="button" className="btn-ghost btn-sm" disabled title="필수 항목 판정 후 승격 가능">Short List 승격</button>
        </div>
      </div>
    </div>
  );
}

export default function BrownfieldMockupPage() {
  const [tab, setTab] = useState<"universe" | "longlist" | "shortlist">("universe");
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <main>
      <StageFrame stageId={["S6", "S7"]} track="brownfield">
        <span className="status-chip status-amber mr-2">목업 · 검토용, 실제 데이터 아님</span>
        재설계 검토안 — 실제 화면은 <code>/brownfield</code>에 그대로 유지됩니다. 이 화면은 API를 호출하지 않는 정적 목업입니다.
      </StageFrame>

      <TabNav
        tabs={[
          { key: "universe", label: "목표 시장 정의" },
          { key: "longlist", label: "Long List", count: 2 },
          { key: "shortlist", label: "Short List", count: 1 },
        ]}
        active={tab}
        onSelect={(k) => setTab(k as typeof tab)}
        label="S6/S7 화면 섹션"
      />

      {tab === "universe" && (
        <section aria-label="목표 시장 정의" className="market-section">
          <div className="sizing-grade-card mb-3">
            <p className="mb-1 text-[0.78rem] text-[color:var(--muted-fg)]">정의</p>
            <p className="mb-0 text-[0.85rem]">서비스·요양·접객 영역 휴머노이드 부품 공급사</p>
          </div>

          <SectionToolbar
            title="후보 검색"
            icon=""
            filters={
              <span role="group" aria-label="출처 필터" className="flex items-center gap-1 flex-wrap">
                <span className="control-chip status-green" aria-pressed="true">전체 2</span>
                <span className="control-chip status-not-started">마스터 1</span>
                <span className="control-chip status-not-started">웹검색 1</span>
              </span>
            }
            actions={<button type="button" className="btn-premium">웹 검색으로 후보 찾기</button>}
          />
          <input
            placeholder="검색: 회사명 · DART 코드"
            className="sizing-new-input w-full mb-3"
            aria-label="후보 검색"
          />
          <table className="data-table" aria-label="후보 검색 결과">
            <caption className="sr-only">후보 검색 결과 — 확정 시 Long List에 등록</caption>
            <thead>
              <tr><th scope="col">후보명</th><th scope="col">DART</th><th scope="col">출처</th><th scope="col">근거</th><th scope="col" className="sr-only">작업</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="cell-primary">대성전기공업</td>
                <td><code className="dd-item-id">00123456</code></td>
                <td><span className="status-chip status-not-started">마스터</span></td>
                <td className="text-[0.75rem] text-[color:var(--muted-fg)]">—</td>
                <td><button type="button" className="btn-ghost btn-sm">Long List에 등록</button></td>
              </tr>
              <tr>
                <td className="cell-primary">한온시스템</td>
                <td><code className="dd-item-id">00998877</code></td>
                <td><span className="status-chip status-green" title="출처 도메인 신뢰도 A">웹검색 A</span></td>
                <td className="text-[0.75rem] text-[color:var(--accent)] underline">출처 링크</td>
                <td><button type="button" className="btn-ghost btn-sm">Long List에 등록</button></td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {tab === "longlist" && (
        <section aria-label="Long List" className="market-section">
          <SectionToolbar
            title="서비스·요양·접객 영역 휴머노이드 특화 솔루션 사업 — Long List"
            icon=""
            filters={
              <span role="group" aria-label="후보 상태 필터" className="flex items-center gap-1 flex-wrap">
                <span className="control-chip status-green" aria-pressed="true">전체 2</span>
                <span className="control-chip status-not-started">심사 중 1</span>
              </span>
            }
            actions={<button type="button" className="btn-premium">후보 등록</button>}
          />
          <table className="data-table list-table" aria-label="Long List">
            <caption className="sr-only">Long List 후보 — 행 클릭 시 평가 워크스페이스</caption>
            <thead>
              <tr>
                <th scope="col">후보</th><th scope="col">DART</th>
                <th scope="col">스크리닝</th>
                <th scope="col">재무·기술 평가</th>
                <th scope="col" className="col-num">점수</th>
                <th scope="col">상태</th>
              </tr>
            </thead>
            <tbody>
              <tr className="row-selected">
                <td className="cell-primary">
                  <button type="button" className="font-semibold text-left underline-offset-2 hover:underline" onClick={() => setDrawerOpen(true)}>
                    대성전기공업
                  </button>
                </td>
                <td><code className="dd-item-id">00123456</code></td>
                <td><ScreeningStrip /></td>
                <td>
                  <span className="flex items-center gap-1">
                    <span className="status-chip status-green">재무 2/3</span>
                    <span className="status-chip status-amber">기술 1/2</span>
                  </span>
                </td>
                <td className="col-num tabular-nums">78%</td>
                <td><span className="status-chip status-not-started">심사 중</span></td>
              </tr>
              <tr>
                <td className="cell-primary">
                  <button type="button" className="font-semibold text-left underline-offset-2 hover:underline" onClick={() => setDrawerOpen(true)}>
                    한온시스템
                  </button>
                </td>
                <td><code className="dd-item-id">00998877</code></td>
                <td>
                  <span className="flex items-center gap-0.5" aria-label="스크리닝 진행 0/9">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <span key={i} className="status-chip status-not-started" style={{ minWidth: "1.4rem", padding: "0 0.15rem", textAlign: "center", fontSize: "0.68rem" }}>·</span>
                    ))}
                  </span>
                </td>
                <td><span className="status-chip status-not-started">재무 0/3</span></td>
                <td className="col-num text-[color:var(--muted-fg)]">0/9</td>
                <td><span className="status-chip status-not-started">심사 중</span></td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
            행(회사명)을 클릭하면 평가 워크스페이스가 오른쪽에서 열립니다 — 스크리닝·재무·기술·판정을 한 곳에서 진행합니다.
          </p>
        </section>
      )}

      {tab === "shortlist" && (
        <section aria-label="Short List" className="market-section">
          <div role="group" aria-label="S7 선정 퍼널" className="flex flex-wrap items-center gap-1 mb-3">
            <span className="control-chip status-not-started">Long List 2</span>
            <span aria-hidden="true" className="text-[color:var(--muted-fg)]">→</span>
            <span className="control-chip status-amber">판정 완료 1</span>
            <span aria-hidden="true" className="text-[color:var(--muted-fg)]">→</span>
            <span className="control-chip status-green">Short List 1</span>
          </div>

          <div className="sizing-grade-card">
            <div className="flex items-center justify-between gap-2 mb-2">
              <strong className="text-[0.9rem]">#1 대성전기공업</strong>
              <span className="flex items-center gap-1">
                <span className="status-chip status-green">Short List</span>
                <button type="button" className="btn-ghost btn-sm" aria-label="순위 올리기">↑</button>
                <button type="button" className="btn-ghost btn-sm" aria-label="순위 내리기">↓</button>
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
              {[
                ["소유·가용성", "충족", "status-green"],
                ["규제", "충족", "status-green"],
                ["재무 매력도", "7/10", "status-amber"],
                ["재무 평가", "2/3", "status-green"],
                ["기술 평가", "1/2", "status-amber"],
              ].map(([label, value, cls]) => (
                <div key={label} className="sizing-grade-card mb-0" style={{ padding: "0.6rem 0.75rem" }}>
                  <p className="mb-1 text-[0.7rem] text-[color:var(--muted-fg)]">{label}</p>
                  <span className={`status-chip ${cls}`}>{value}</span>
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setDrawerOpen(true)}>평가 워크스페이스 열기</button>
          </div>
          <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">위 판정은 참고용이며 공식 판정이 아닙니다.</p>
        </section>
      )}

      {drawerOpen && <Drawer onClose={() => setDrawerOpen(false)} />}
    </main>
  );
}

