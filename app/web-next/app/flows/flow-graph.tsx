"use client";

// 블루프린트 탭 — 단계 흐름 그래프 (design 2026-10-25-agent-assignment-prompt-standard §6.2/§6.4/§11.4).
// 위키 여정 지도(docs/wiki/ko/Home.md)와 같은 가로 방향의 순수 SVG다: 신규 의존성 0,
// 색은 전부 styles.css 토큰 CSS 변수(다크 모드 안전 — 차트 팔레트는 ADR-0087의 유일한
// 범주형 팔레트 정의를 소비한다). 노드 = 단계(S1–S12 12개 — 활동 47개를 전부 노드로
// 그리면 가독성이 무해진다, §6.2), 노드 안 활동 도트 행(도트 1개 = 활동 1개, 에이전트
// 도메인 색)으로 "node = activity" 요구를 단계 그레인으로 충족.
//
// 기하(2026-10-25 사용자 보고 대응 — 12노드를 2080×264[≈7.9:1] 한 주행에 깔았더니
// 같은 화면 폭에서 카드가 약 0.6배로 축소 렌더되어 단계명이 잘렸고, 분기 군집
// S5/S6/S7이 왼쪽에 몰려 밴드의 우측 절반이 비었다): 3줄 감기 레이아웃. 첫째 줄
// S1→S4(좌→우) → 둘째 줄 = 분기 밴드: S4에서 갈라진 greenfield S5(위 라인)·
// brownfield S6→S7(아래 라인)이 우→좌로 진행해 S8(두 라인의 세로 중앙에 놓인
// 합류 노드)에서 만난다 → 셋째 줄 S9→S12(좌→우). 둘째 줄을 우→좌(serpentine)로
// 감은 이유: 전 줄을 좌→우로 고정하면 S4→분기와 S8→S9에 전폭 횡선 2개가 필요하고
// S4→S6 진입선은 S5를 우회하며 S5→S8과의 교차 1회가 불가피하다. 감으면 모든
// 커넥터가 짧아지고, 줄 환승 2곳이 같은 열의 짧은 수직선이 되며, 엣지 교차가
// 0이 된다(밴드 내 진행 방향은 화살촉이 유도한다). svg는 width 100% + height
// auto로 컨테이너 폭을 따라 늘어난다(넓은 화면에서 왼쪽 뭉침 없음).
// minWidth(74rem)는 FU-A(2026-10-26 PM 승인 후속)의 축소 금지 하한이다: 뷰박스
// 자연폭 VIEW_W 1184px = 74rem과 정확히 일치해 그래프가 항상 1:1 이상(절대 축소
// 없음)으로 렌더되고, 14px/12px 읽기 하한이 어떤 뷰포트에서도 속성값 그대로
// 유지된다. 컨테이너가 그보다 좁으면 축소 대신 기존 overflow-x 스크롤 + 에지
// 페이드 힌트(F5)가 대신한다. (1920px 이상 루트 폰트 스텝 15px 구간은 뷰포트
// 자체가 그래프 자연폭보다 넓어 minWidth가 묶일 일이 없다.)
//
// 폰트 상향(2026-10-26 UX 리뷰 F1 — SVG 텍스트가 14px 읽기 하한 아래였다):
// 단계 id·이름 12→14, 활동 수·마커 거터 라벨 9.5→12, 트랙 배지 10→12. 카드
// 기하도 함께 커서(§F1) 최장 문자열이 무축약으로 들어간다 — 머신체크는
// tests/unit/flows-console-view.test.ts v1.7.0이 상수와 한 몸으로 재고정한다.
//
// 접근성(§6.4, WCAG 2.1 AA): 그래프는 role="img" + <title>/<desc>의 요약 이미지다
// (문구는 카탈로그 pages.flows.graph.* — 활성 로케일을 따른다). 2026-10-26 UX
// 리뷰 F4 amend(append-only — 이 단락이 이전 §6.4 규칙을 대체한다): 도움말이
// "포인터 또는 키보드" 필터링을 약속하므로 노드 <g>가 직접 오퍼러블해진다 —
// role="button" + tabIndex=0 + Enter/Space(클릭과 동일 핸들러). 포커스 표시는
// CSS outline 대신 상태 기반 <rect>(accent 2px, offset 2, radius 10)다 — SVG
// 내부 요소의 CSS outline은 브라우저별 편차가 커서 명시 링이 규약이다. AT 경로는
// 그대로 활동 표가 완전 대체한다(role=img의 요약 이미지 규약 유지).
// 색 단독 정보 없음: 도트 색은 범례 텍스트(도메인명)와 병행, 전문가 마커는 링 +
// 텍스트 라벨, 트랙 배지·밴드 라벨은 텍스트다. 모션 없음(정적 SVG).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BlueprintAgent, BlueprintStage, SpecialistMarker } from "./flows-view-lib.ts";
import { stageDisplayName, truncateToWidth } from "./flows-view-lib.ts";

// ── 기하 상수(3줄 감기 — 단계 추가는 해당 줄에 한 칸 x 이동, §9 위험 완화) ──
// 노드 크기(F1 폰트 상향 동반 — 2026-10-26): NODE_W 264는 최장 단계명
// "시너지·전략적 적합성"(약 141px @ fontSize 14)이 가용폭 240에 무축약으로
// 들어가고, 활동 도트 행(최다 9개)·활동 수 라벨(12px)·트랙 배지(12px)와도
// 겹치지 않는 크기. 마커 거터 라벨은 카드 하단 좌측(행 사이 여백) — 라벨 상한
// NODE_W−8(=256px)은 최장 실측 라벨(약 233px @12px)을 무축약으로 수용한다.
const NODE_W = 264;
const NODE_H = 80;
const COL_GAP = 32; // 같은 행 인접 카드 간 최소 간격(열 피치 = NODE_W + COL_GAP = 296)
const R1_Y = 16; // 첫째 줄 — 공통 S1→S4 (좌→우)
const GF_Y = 128; // 분기 밴드 위 라인 — greenfield S5 (밴드는 우→좌 진행)
const BF_Y = 240; // 분기 밴드 아래 라인 — brownfield S6→S7
const MERGE_Y = 184; // S8 재합류 — 두 라인 카드 세로 중앙(168/280)의 중간 지점
const R3_Y = 352; // 셋째 줄 — 공통 S9→S12 (좌→우)
const VIEW_W = 1184; // 좌측 여백 16 + 열 피치 296×3 + NODE_W + 우측 여백 16(트렁크 x=1176 포함)
const VIEW_H = 460; // 셋째 줄 카드 하단(432) + 마커 거터 라벨(444 baseline, 12px) + 하단 여백
const ENTRY_GAP = 4; // 화살촉이 노드 변에 닿을 여백

/** 단계 좌표표 — 3줄 감기. 첫째 줄 S1→S4(좌→우), 둘째 줄 분기 밴드(S5 위 라인·
 *  S6→S7 아래 라인이 우→좌로 진행하고 S8이 두 라인의 세로 중앙에서 합류),
 *  셋째 줄 S9→S12(좌→우). 열 피치는 NODE_W + COL_GAP(=296), 4열(x=16/312/608/904). */
const ROW_Y: Record<string, { x: number; y: number }> = {
  S1: { x: 16, y: R1_Y },
  S2: { x: 312, y: R1_Y },
  S3: { x: 608, y: R1_Y },
  S4: { x: 904, y: R1_Y },
  S5: { x: 904, y: GF_Y },
  S6: { x: 904, y: BF_Y },
  S7: { x: 608, y: BF_Y },
  S8: { x: 16, y: MERGE_Y },
  S9: { x: 16, y: R3_Y },
  S10: { x: 312, y: R3_Y },
  S11: { x: 608, y: R3_Y },
  S12: { x: 904, y: R3_Y },
};

/** spec stateTransitions.onComplete 체인의 기하 반영(§6.2) — d는 절대좌표.
 *  같은 줄 변은 from 노드 변+ENTRY_GAP → to 노드 변−ENTRY_GAP. 분기: S4 우변에서
 *  우측 여백(x=1176)의 트렁크로 나와 GF/BF 라인 중심높이(168/280)로 갈라져 각
 *  카드 우변으로 진입한다(S4 카드 하단의 마커 거터 라벨 최대폭 256px·x 904..1160과
 *  만나지 않는다). 밴드는 우→좌: S6→S7 좌향 화살표, S5·S7은 S8 우변에 위(208)·
 *  아래(240)로 나뉘 진입해 화살촉이 겹치지 않는다. 줄 환승 2곳은 모두 같은 열의
 *  짧은 수직선 — S4→트렁크(우측), S8 하변→S9 상변(좌측). 엣지 교차는 0이다.
 *  참고: S8→S9 수직선(x=132)은 현재 서빙 데이터에서 S8에 전문가 마커가 없어
 *  거터 라벨과 만나지 않는다 — S8에 마커가 생기면 진입 x를 라벨 폭 밖으로 옮긴다. */
const EDGES: string[] = [
  "M 284,56 H 308", // S1→S2
  "M 580,56 H 604", // S2→S3
  "M 876,56 H 900", // S3→S4
  "M 1172,56 H 1176 V 168 H 1172", // S4→S5 (S4 우변 → 우측 여백 트렁크 → greenfield 라인 우변)
  "M 1172,56 H 1176 V 280 H 1172", // S4→S6 (S4 우변 → 우측 여백 트렁크 → brownfield 라인 우변)
  "M 900,280 H 876", // S6→S7 (밴드는 우→좌)
  "M 900,168 H 288 V 208 H 284", // S5→S8 (재합류 — S8 우변 위쪽 진입)
  "M 604,280 H 288 V 240 H 284", // S7→S8 (재합류 — S8 우변 아래쪽 진입)
  "M 132,268 V 348", // S8→S9 (둘째→셋째 줄 환승 — 같은 열의 짧은 수직선)
  "M 284,392 H 308", // S9→S10
  "M 580,392 H 604", // S10→S11
  "M 876,392 H 900", // S11→S12
];

/** 범례 렌더 순서의 도메인 키 집합 — 색 토큰 맵과 카탈로그(pages.flows.graph.legend.domains.*)가
 *  같은 키 집합을 쓴다(§6.4 색 단독 금지 — 라벨은 카탈로그 텍스트로 병행). */
const DOMAIN_KEYS = ["_core", "functional", "industry", "region", "technical", "_shared"] as const;

// ── 색·라벨 상수(디자인 토큰만 — design-lint token-usage 규약) ──────────────
/** 에이전트 도메인 → 차트 팔레트 토큰(ADR-0087 — 화면 코드에서 재유도 금지). */
const DOMAIN_DOT_COLOR: Record<(typeof DOMAIN_KEYS)[number], string> = {
  _core: "var(--chart-1)",
  functional: "var(--chart-2)",
  industry: "var(--chart-3)",
  region: "var(--chart-5)",
  technical: "var(--chart-7)",
  _shared: "var(--muted-fg)",
};
/** 페이로드 domain 문자열 → 도트 색 — 미지 도메인은 muted 폴백(키 집합 밖 값 방어). */
function domainDotColor(domain: string): string {
  return (DOMAIN_KEYS as readonly string[]).includes(domain)
    ? DOMAIN_DOT_COLOR[domain as (typeof DOMAIN_KEYS)[number]]
    : "var(--muted-fg)";
}

/** 전문가 마커 3종(§11.4 — 링 색 + 텍스트 범례, 색 단독 금지). 활동 표의 마커
 *  칩(§11.4 "활동 표에 전용 열값")도 이 메타를 재사용한다. 문구(short·legend)는
 *  카탈로그 pages.flows.graph.markers.<kind>.* 로 추출되었다(§3.6 추출 배치) —
 *  코드가 소유하는 것은 색 토큰과 키 유출 헬퍼뿐이다. */
export const MARKER_KIND_COLOR: Record<SpecialistMarker["kind"], string> = {
  affinity: "var(--chart-2)",
  scoped: "var(--chart-3)",
  override: "var(--chart-6)",
};
/** 범례 렌더 순서. */
export const MARKER_KINDS = Object.keys(MARKER_KIND_COLOR) as Array<SpecialistMarker["kind"]>;

/** 마커 문구의 카탈로그 키(`pages.flows.graph` 네임스페이스 상대 경로) — blueprint-view의
 *  마커 칩도 이 헬퍼로 같은 키를 쓴다(키 경로의 단일 소유). */
export function markerKey(kind: SpecialistMarker["kind"], part: "short" | "legend"): string {
  return `markers.${kind}.${part}`;
}

/** 마커 해설 문구의 카탈로그 키(F9 — 2026-10-26 UX 리뷰): SPECIALIST_TRACK_AFFINITY
 *  ref("S2.business-model-sketch")를 `markers.notes.s2_business_model_sketch` 형
 *  키로 정규화한다. 해설은 t.has()로 해소하고 미지 마커(미래 추가분)는 페이로드
 *  note로 폴백한다 — 로케일 중립 폴백이 SSOT이고 카탈로그는 표시측 큐레이션이다. */
export function markerNoteKey(stageId: string, activityId: string): string {
  return `markers.notes.${`${stageId}_${activityId}`.toLowerCase().replace(/-/g, "_")}`;
}

/** 페이로드 note → 로케일 문구 해소(F9). 그래프 범례·도트 툴팁·활동 표 마커 칩이
 *  같은 헬퍼를 쓴다(단일 소유 — EN 화면에 한국어 note가 새는 것을 이 한 곳에서 막는다). */
export function markerNote(marker: SpecialistMarker, tg: ReturnType<typeof useTranslations>): string {
  const k = markerNoteKey(marker.stageId, marker.activityId);
  return tg.has(k) ? tg(k) : marker.note;
}

/** 페이로드 단계명의 카탈로그 키(FU-B — 2026-10-26 PM 승인 후속, design delta 참조):
 *  flow.spec 단계명은 /api/flows가 SPEC_STAGES 직접 투영으로 서빙하는 페이로드
 *  데이터고(SSOT = 스펙 한국어 원문, API 무변경) EN 화면에 그대로 새어 나왔다.
 *  표시측은 `pages.flows.stageNames.<stageId>` 키로 해소하고 — markerNoteKey와 같은
 *  t.has() 패턴 — 키 결측(미래 신규 단계) 시 페이로드 원문으로 폴백한다. */
export function stageNameKey(stageId: string): string {
  return `stageNames.${stageId}`;
}

/** 페이로드 단계명 → 로케일 문구 해소(FU-B). 그래프 노드(이름 텍스트·aria)와
 *  F11 선택 칩이 같은 헬퍼를 쓴다(단일 소유 — EN 화면에 한국어 단계명이 새는
 *  것을 이 한 곳에서 막는다). 결측 폴백은 stageDisplayName의 방어적 id 폴백을 그대로 쓴다. */
export function stageDisplay(stage: Pick<BlueprintStage, "id" | "name">, tp: ReturnType<typeof useTranslations>): string {
  const k = stageNameKey(stage.id);
  return tp.has(k) ? tp(k) : stageDisplayName(stage);
}

/** 트랙 배지 — applicableTracks 직접 투영(Row 1 API)을 읽는다. 양 트랙/빈 배열 = 공통.
 *  공통 라벨은 카탈로그(pages.flows.graph.trackCommon)에서 주입받는다. */
function trackBadge(tracks: string[], commonLabel: string): { label: string; bg: string; fg: string; border: string } {
  const gf = tracks.includes("greenfield");
  const bf = tracks.includes("brownfield");
  if (gf && !bf) return { label: "greenfield", bg: "var(--green-bg)", fg: "var(--green-fg)", border: "var(--green-border)" };
  if (bf && !gf) return { label: "brownfield", bg: "var(--amber-bg)", fg: "var(--amber-fg)", border: "var(--amber-border)" };
  return { label: commonLabel, bg: "var(--primary-bg)", fg: "var(--muted-fg)", border: "var(--border)" };
}

export interface FlowGraphProps {
  stages: BlueprintStage[];
  /** 활동 도트의 도메인 색 계산용 — blueprint 페이로드의 agents 파생 맵. */
  agentsByKey: Map<string, BlueprintAgent>;
  /** 전문가 마커(DEC-20261025-02) — 표시·인지 전용(§11.4). 필터·게이트와 무관. */
  markers: SpecialistMarker[];
  selectedStage: string | null;
  /** 기존 단계 선택 상태 재사용(§6.3) — 활동 표 필터와 동일한 setSelectedStage로 귀결. */
  onSelectStage: (stageId: string) => void;
}

export function FlowGraph({ stages, agentsByKey, markers, selectedStage, onSelectStage }: FlowGraphProps) {
  const tg = useTranslations("pages.flows.graph");
  // FU-B — 페이로드 단계명의 로케일 해소 네임스페이스(pages.flows.stageNames.*).
  const tp = useTranslations("pages.flows");
  const markersByActivity = new Map<string, SpecialistMarker>();
  for (const m of markers) markersByActivity.set(`${m.stageId}:${m.activityId}`, m);

  // F4 — 키보드 포커스 링(상태 기반 rect). CSS :focus-visible을 JS에서 그대로
  // 판정한다(matches) — 마우스 클릭 포커스에는 링을 두르지 않는다(규약 동일).
  const [focusRingStage, setFocusRingStage] = useState<string | null>(null);

  // F5 — 오버플로 에지 페이드: 컨테이너가 실제로 가로 스크롤 중일 때만 우측
  // 그라디언트 베일을 렌더한다(scroll/resize 리스너 — 토큰 색, aria-hidden).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  useEffect(() => {
    updateOverflow();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateOverflow, { passive: true });
    window.addEventListener("resize", updateOverflow);
    return () => {
      el.removeEventListener("scroll", updateOverflow);
      window.removeEventListener("resize", updateOverflow);
    };
  }, [updateOverflow]);

  const presentDomains = [
    ...new Set(stages.flatMap((s) => s.activities.map((a) => agentsByKey.get(a.agent)?.domain ?? ""))),
  ].filter((d): d is (typeof DOMAIN_KEYS)[number] => (DOMAIN_KEYS as readonly string[]).includes(d));

  return (
    <figure className="m-0">
      {/* overflow-x 컨테이너 — 그래프는 좁은 화면에서 축소 대신 가로 스크롤
          (표의 tmin 규약과 같은 판단). svg는 width 100% + height auto로 컨테이너
          폭을 따라 늘어난다(2026-10-25 보고: 한 주행 7.9:1 뷰박스가 폭 대비
          높이를 얇게 만들어 카드가 축소 렌더·왼쪽 뭉침으로 보였다 — 3줄 감기
          뷰박스 + 명시적 height auto로 해소). minWidth 74rem(=VIEW_W 1184px)은
          FU-A의 1:1 하한 — 그 아래 컨테이너 폭에서 축소 대신 스크롤이 동작한다.
          F5: 스크롤이 실제로 있을 때만 우측 에지 페이드 베일이 잘린 단서를 준다
          (토큰 색 그라디언트 + 네이티브 title 힌트). */}
      <div style={{ position: "relative", width: "100%" }}>
        <div ref={scrollRef} title={tg("scrollHint")} style={{ overflowX: "auto", width: "100%" }}>
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            width="100%"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: "block", height: "auto", minWidth: "74rem" }}
          >
            <title>{tg("svgTitle")}</title>
            <desc>{tg("svgDesc")}</desc>
            <defs>
              {/* F5 — 화살촉 가독성(2026-10-26 UX 리뷰): fill을 var(--border)에서
                  var(--muted-fg)로, 마커 크기 7→9로 올린다(토큰만 — design-lint). */}
              <marker id="flows-graph-arrow" markerWidth="9" markerHeight="9" refX="5.5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" fill="var(--muted-fg)" />
              </marker>
            </defs>

            {/* 단계 읽기 순서 엣지 — stroke는 토큰, 화살촉 marker(위키 패턴).
                F5: strokeWidth 1.4→1.6(화살촉 9와 함께 엣지를 읽게 만든다). */}
            {EDGES.map((d) => (
              <path key={d} d={d} fill="none" stroke="var(--border)" strokeWidth="1.6" markerEnd="url(#flows-graph-arrow)" />
            ))}

            {/* F5 — 분기 밴드 방향 라벨(12px, muted-fg — 방향 자체는 화살촉이 운반한다,
                라벨 문자열에 화살 기호를 넣지 않는다). greenfield: S5 라인(S5→S8 재합류선
                아래, S5 카드 좌측), brownfield: S6→S7 라인(S6 카드 직상단 거터). 배치는
                서빙 데이터의 마커 거터 라벨(S4·S5는 마커 없음/있음 기준)과 겹치지 않는
                자리다 — 마커 분포가 바뀌면 함께 옮긴다. */}
            <text x={765} y={186} fontSize="12" fill="var(--muted-fg)">
              {tg("trackGreenfield")}
            </text>
            <text x={904} y={232} fontSize="12" fill="var(--muted-fg)">
              {tg("trackBrownfield")}
            </text>

            {stages.map((s) => {
              const pos = ROW_Y[s.id];
              if (!pos) return null; // 미지 단계(스펙 신규 추가)는 좌표표 1행 추가 전까지 그래프에서 생략 — 표는 정상 렌더
              const selected = selectedStage === s.id;
              const badge = trackBadge(s.applicableTracks, tg("trackCommon"));
              const badgeW = badge.label.length * 6.6 + 16;
              const stageMarkers = markers.filter((m) => m.stageId === s.id);
              const nodeAria = tg("nodeTitle", { id: s.id, name: stageDisplay(s, tp), count: s.activities.length });
              return (
                // F4(2026-10-26 amend) — 노드가 포인터와 키보드 모두로 오퍼러블하다:
                // 클릭/Enter/Space가 같은 onSelectStage로 귀결한다. AT 요약 경로는
                // svg role="img"와 활동 표가 담당한다(파일 헤더 §6.4 단락).
                <g
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  aria-label={nodeAria}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectStage(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectStage(s.id);
                    }
                  }}
                  onFocus={(e) => {
                    if ((e.target as Element).matches(":focus-visible")) setFocusRingStage(s.id);
                  }}
                  onBlur={() => setFocusRingStage((prev) => (prev === s.id ? null : prev))}
                >
                  <title>{nodeAria}</title>
                  {/* F4 — 키보드 포커스 링(accent 2px, offset 2, radius 10) — CSS
                      outline 대신 명시 rect(SVG 내부 outline은 브라우저 편차). */}
                  {focusRingStage === s.id && (
                    <rect
                      x={pos.x - 2}
                      y={pos.y - 2}
                      width={NODE_W + 4}
                      height={NODE_H + 4}
                      rx="10"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2"
                    />
                  )}
                  <rect
                    x={pos.x}
                    y={pos.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx="8"
                    fill={selected ? "var(--primary-bg)" : "var(--surface)"}
                    stroke={selected ? "var(--accent)" : "var(--border)"}
                    strokeWidth={selected ? "1.6" : "1.2"}
                  />
                  <text x={pos.x + 12} y={pos.y + 22} fontSize="14" fontWeight="600" fill="var(--fg)">
                    {s.id}
                  </text>
                  <rect x={pos.x + NODE_W - badgeW - 10} y={pos.y + 7} width={badgeW} height="18" rx="9" fill={badge.bg} stroke={badge.border} strokeWidth="1" />
                  <text
                    x={pos.x + NODE_W - badgeW / 2 - 10}
                    y={pos.y + 20.5}
                    fontSize="12"
                    textAnchor="middle"
                    fill={badge.fg}
                  >
                    {badge.label}
                  </text>
                  <text x={pos.x + 12} y={pos.y + 46} fontSize="14" fill="var(--fg)">
                    {/* 카드 폭 초과 단계명은 …으로 축약 — 원문은 노드 <title>(nodeTitle)이
                        전문 보존한다. 2026-10-25 보고: 1줄 레이아웃에선 축약이 상태였다 —
                        3줄 감기로 카드가 커져 서빙 데이터 전체가 무축약이다(축약은 방어선). */}
                    {truncateToWidth(stageDisplay(s, tp), 14, NODE_W - 24)}
                  </text>
                  {/* 활동 도트 행 — 도트 1개 = 활동 1개, 에이전트 도메인 색 + activity id 툴팁(§6.2). */}
                  {s.activities.map((a, i) => {
                    const cx = pos.x + 16 + i * 11.5;
                    const cy = pos.y + 64;
                    const dotColor = domainDotColor(agentsByKey.get(a.agent)?.domain ?? "");
                    const marker = markersByActivity.get(`${s.id}:${a.id}`);
                    return (
                      <g key={a.id}>
                        <circle cx={cx} cy={cy} r="3.5" fill={dotColor}>
                          <title>
                            {marker
                              ? tg("markers.dotTitle", { id: a.id, kind: tg(markerKey(marker.kind, "short")), note: markerNote(marker, tg) })
                              : `${a.id} (${a.agent})`}
                          </title>
                        </circle>
                        {marker && (
                          // 전문가 마커 링(§11.4) — 색 외에 활동 옆 텍스트 라벨과 범례가 병행된다.
                          <circle cx={cx} cy={cy} r="6.5" fill="none" stroke={MARKER_KIND_COLOR[marker.kind]} strokeWidth="1.5" />
                        )}
                      </g>
                    );
                  })}
                  <text x={pos.x + NODE_W - 10} y={pos.y + 67} fontSize="12" textAnchor="end" fill="var(--muted-fg)">
                    {tg("activityCount", { count: s.activities.length })}
                  </text>
                  {/* 마커 텍스트 라벨(노드 하단 좌측 — kind + 활동 id, 색 단독 금지).
                      2026-10-23 보고 대응: 노드 "우측"에 두면 다음 카드 본문과 겹쳤다 —
                      행 사이 여백(주행↔GF↔BF 거터)에 카드 좌변 기준으로 두고, 폭은
                      카드 폭−8로 축약(원문은 <title> 폴백)해 다음 열과 만나지 않는다.
                      F9: note가 아닌 kind·id만 라벨로 쓴다(해설은 범례 고정 해소). */}
                  {stageMarkers.map((m, i) => {
                    const label = tg("markers.nodeLabel", { kind: tg(markerKey(m.kind, "short")), id: m.activityId });
                    return (
                      <text key={m.activityId} x={pos.x} y={pos.y + NODE_H + 12 + i * 12} fontSize="12" fill="var(--muted-fg)">
                        <title>{label}</title>
                        {truncateToWidth(label, 12, NODE_W - 8)}
                      </text>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
        {canScrollRight && (
          // F5 — 오버플로 페이드 힌트: 스크롤 가능할 때만 우측 베일(토큰 그라디언트).
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              right: 0,
              width: "3rem",
              background: "linear-gradient(to right, transparent, var(--bg))",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {/* 범례 — 그래프에 인접 렌더(§11.4): 도메인 도트 색·마커 3종을 텍스트와 병행한다.
          2026-10-23 보고 대응: 항목들이 한 줄로 뭉개져 보였다 — 제목 / 도트 설명 /
          도메인 / 마커를 각각 독립된 행으로 두고 항목 간 간격(gap-x-3)을 명시한다.
          각 행은 flex-wrap이라 좁은 화면에서도 잘려 죽는(…) 줄이 생기지 않는다.
          F10: DEC id는 범례 표시 텍스트에 두지 않는다(마커 행 title 툴팁으로 이동),
          마커 해설 목록은 네이티브 <details>로 접는다(viewAsTable과 같은 공개 패턴). */}
      <figcaption className="mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        <div className="font-semibold text-[color:var(--fg)]">{tg("legend.title")}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{tg("legend.dot")}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {presentDomains.map((d) => (
            <span key={d} className="inline-flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <circle cx="5" cy="5" r="3.5" fill={DOMAIN_DOT_COLOR[d]} />
              </svg>
              {tg(`legend.domains.${d}`)}
            </span>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span title={tg("markers.decisionRef")}>{tg("legend.marker")}</span>
          {MARKER_KINDS.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <circle cx="6" cy="6" r="4.5" fill="none" stroke={MARKER_KIND_COLOR[kind]} strokeWidth="1.5" />
              </svg>
              {`${tg(markerKey(kind, "short"))} — ${tg(markerKey(kind, "legend"))}`}
            </span>
          ))}
        </div>
        {markers.length > 0 && (
          // F10 — 마커 해설 접기: DEC-20261025-02 판정 근거 id는 요약의 title 툴팁으로만
          // 제공하고(표시 텍스트 금지), 해설은 details 뒤에 접는다. 해설 문구는 F9
          // 헬퍼(markerNote)로 로케일 해소 — 미지 마커만 페이로드 note 폴백.
          <details className="mt-1">
            <summary className="cursor-pointer" title={tg("markers.decisionRef")}>
              {tg("markers.detailsSummary", { p1: markers.length })}
            </summary>
            <ul className="ml-4 mt-1 list-disc">
              {markers.map((m) => (
                <li key={`${m.stageId}:${m.activityId}`}>
                  <code className="dd-item-id">{`${m.stageId}.${m.activityId}`}</code>{" "}
                  {tg("markers.noteLine", { kind: tg(markerKey(m.kind, "short")), note: markerNote(m, tg) })}
                </li>
              ))}
            </ul>
          </details>
        )}
      </figcaption>
    </figure>
  );
}
