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
// 합류 노드)에서 만난다 → 셋째 줄 S9→S12(좌→우). viewBox 1068×396(≈2.7:1) — 같은
// 컨테이너 폭에서 카드가 약 2.7배 크게 렌더되고 분기 밴드가 전폭을 쓴다.
// 둘째 줄을 우→좌(serpentine)로 감은 이유: 전 줄을 좌→우로 고정하면 S4→분기와
// S8→S9에 전폭 횡선 2개가 필요하고 S4→S6 진입선은 S5를 우회하며 S5→S8과의 교차
// 1회가 불가피하다. 감으면 모든 커넥터가 짧아지고, 줄 환승 2곳이 같은 열의 짧은
// 수직선이 되며, 엣지 교차가 0이 된다(밴드 내 진행 방향은 화살촉이 유도한다).
// svg는 width 100% + height auto로 컨테이너 폭을 따라 늘어난다(넓은 화면에서
// 왼쪽 뭉침 없음). minWidth(50rem)는 좁은 화면의 읽기 하한 — 그 아래 해상도에서만
// 컨테이너의 overflow-x 스크롤이 대신한다.
//
// 접근성(§6.4, WCAG 2.1 AA): 그래프는 role="img" + <title>/<desc>의 요약 이미지다
// (문구는 카탈로그 pages.flows.graph.* — 활성 로케일을 따른다). SVG 내부에 focusable
// 요소를 두지 않는다(포인터 클릭은 편의 — 키보드 경로는 활동 표가 완전 대체한다).
// 색 단독 정보 없음: 도트 색은 범례 텍스트(도메인명)와 병행, 전문가 마커는 링 +
// 텍스트 라벨, 트랙 배지는 텍스트 배지다. 모션 없음(정적 SVG).
import { useTranslations } from "next-intl";
import type { BlueprintAgent, BlueprintStage, SpecialistMarker } from "./flows-view-lib.ts";
import { stageDisplayName, truncateToWidth } from "./flows-view-lib.ts";

// ── 기하 상수(3줄 감기 — 단계 추가는 해당 줄에 한 칸 x 이동, §9 위험 완화) ──
// 노드 크기(2026-10-25 보고: 12노드 1줄에서 카드가 너무 작았다): NODE_W 232는
// 최장 단계명 "시너지·전략적 적합성"(약 121px @ fontSize 12)이 가용폭 208에
// 무축약으로 들어가고, 활동 도트 행(최다 9개)·활동 수 라벨·트랙 배지와도 겹치지
// 않는 크기. 마커 거터 라벨은 카드 하단 좌측(행 사이 여백) — 라벨 상한 NODE_W−8
// (=224px)은 최장 실측 라벨(약 179px)을 무축약으로 수용한다.
const NODE_W = 232;
const NODE_H = 64;
const COL_GAP = 36; // 같은 행 인접 카드 간 최소 간격(열 피치 = NODE_W + COL_GAP = 268)
const R1_Y = 16; // 첫째 줄 — 공통 S1→S4 (좌→우)
const GF_Y = 112; // 분기 밴드 위 라인 — greenfield S5 (밴드는 우→좌 진행)
const BF_Y = 208; // 분기 밴드 아래 라인 — brownfield S6→S7
const MERGE_Y = 160; // S8 재합류 — 두 라인 카드 세로 중심(144/240)의 중간 지점
const R3_Y = 304; // 셋째 줄 — 공통 S9→S12 (좌→우)
const VIEW_W = 1068; // 좌측 여백 16 + 열 피치 268×3 + NODE_W + 우측 여백 16(트렁크 x=1060 포함)
const VIEW_H = 396; // 셋째 줄 카드 하단(368) + 마커 거터 라벨(380 baseline) + 하단 여백
const ENTRY_GAP = 4; // 화살촉이 노드 변에 닿을 여백

/** 단계 좌표표 — 3줄 감기. 첫째 줄 S1→S4(좌→우), 둘째 줄 분기 밴드(S5 위 라인·
 *  S6→S7 아래 라인이 우→좌로 진행하고 S8이 두 라인의 세로 중앙에서 합류),
 *  셋째 줄 S9→S12(좌→우). 열 피치는 NODE_W + COL_GAP(=268), 4열(x=16/284/552/820). */
const ROW_Y: Record<string, { x: number; y: number }> = {
  S1: { x: 16, y: R1_Y },
  S2: { x: 284, y: R1_Y },
  S3: { x: 552, y: R1_Y },
  S4: { x: 820, y: R1_Y },
  S5: { x: 820, y: GF_Y },
  S6: { x: 820, y: BF_Y },
  S7: { x: 552, y: BF_Y },
  S8: { x: 16, y: MERGE_Y },
  S9: { x: 16, y: R3_Y },
  S10: { x: 284, y: R3_Y },
  S11: { x: 552, y: R3_Y },
  S12: { x: 820, y: R3_Y },
};

/** spec stateTransitions.onComplete 체인의 기하 반영(§6.2) — d는 절대좌표.
 *  같은 줄 변은 from 노드 변+ENTRY_GAP → to 노드 변−ENTRY_GAP. 분기: S4 우변에서
 *  우측 여백(x=1060)의 트렁크로 나와 GF/BF 라인 중심높이(144/240)로 갈라져 각
 *  카드 우변으로 진입한다(S4 카드 하단의 마커 거터 라벨 최대폭 224px·x 820..1044와
 *  만나지 않는다). 밴드는 우→좌: S6→S7 좌향 화살표, S5·S7은 S8 우변에 위(176)·
 *  아래(208)로 나뉘 진입해 화살촉이 겹치지 않는다. 줄 환승 2곳은 모두 같은 열의
 *  짧은 수직선 — S4→트렁크(우측), S8 하변→S9 상변(좌측). 엣지 교차는 0이다.
 *  참고: S8→S9 수직선(x=132)은 현재 서빙 데이터에서 S8에 전문가 마커가 없어
 *  거터 라벨과 만나지 않는다 — S8에 마커가 생기면 진입 x를 라벨 폭 밖으로 옮긴다. */
const EDGES: string[] = [
  "M 252,48 H 280", // S1→S2
  "M 520,48 H 548", // S2→S3
  "M 788,48 H 816", // S3→S4
  "M 1056,48 H 1060 V 144 H 1056", // S4→S5 (S4 우변 → 우측 여백 트렁크 → greenfield 라인 우변)
  "M 1056,48 H 1060 V 240 H 1056", // S4→S6 (S4 우변 → 우측 여백 트렁크 → brownfield 라인 우변)
  "M 816,240 H 788", // S6→S7 (밴드는 우→좌)
  "M 816,144 H 266 V 176 H 252", // S5→S8 (재합류 — S8 우변 위쪽 진입)
  "M 548,240 H 266 V 208 H 252", // S7→S8 (재합류 — S8 우변 아래쪽 진입)
  "M 132,228 V 300", // S8→S9 (둘째→셋째 줄 환승 — 같은 열의 짧은 수직선)
  "M 252,336 H 280", // S9→S10
  "M 520,336 H 548", // S10→S11
  "M 788,336 H 816", // S11→S12
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
  const markersByActivity = new Map<string, SpecialistMarker>();
  for (const m of markers) markersByActivity.set(`${m.stageId}:${m.activityId}`, m);

  const presentDomains = [
    ...new Set(stages.flatMap((s) => s.activities.map((a) => agentsByKey.get(a.agent)?.domain ?? ""))),
  ].filter((d): d is (typeof DOMAIN_KEYS)[number] => (DOMAIN_KEYS as readonly string[]).includes(d));

  return (
    <figure className="m-0">
      {/* overflow-x 컨테이너 — 그래프는 좁은 화면에서 축소 대신 가로 스크롤
          (표의 tmin 규약과 같은 판단). svg는 width 100% + height auto로 컨테이너
          폭을 따라 늘어난다(2026-10-25 보고: 한 주행 7.9:1 뷰박스가 폭 대비
          높이를 얇게 만들어 카드가 축소 렌더·왼쪽 뭉침으로 보였다 — 3줄 감기
          2.7:1 뷰박스 + 명시적 height auto로 해소). minWidth 50rem은 그 아래
          해상도의 읽기 하한 — 그때만 스크롤이 동작한다. tabIndex를 두지 않는다
          (§6.4 — 그래프는 탭 순서에 진입하지 않는다). */}
      <div style={{ overflowX: "auto", width: "100%" }}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          width="100%"
          role="img"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block", height: "auto", minWidth: "50rem" }}
        >
          <title>{tg("svgTitle")}</title>
          <desc>{tg("svgDesc")}</desc>
          <defs>
            <marker id="flows-graph-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" fill="var(--border)" />
            </marker>
          </defs>

          {/* 단계 읽기 순서 엣지 — stroke는 토큰, 화살촉 marker(위키 패턴). */}
          {EDGES.map((d) => (
            <path key={d} d={d} fill="none" stroke="var(--border)" strokeWidth="1.4" markerEnd="url(#flows-graph-arrow)" />
          ))}

          {stages.map((s) => {
            const pos = ROW_Y[s.id];
            if (!pos) return null; // 미지 단계(스펙 신규 추가)는 좌표표 1행 추가 전까지 그래프에서 생략 — 표는 정상 렌더
            const selected = selectedStage === s.id;
            const badge = trackBadge(s.applicableTracks, tg("trackCommon"));
            const badgeW = badge.label.length * 5.5 + 16;
            const stageMarkers = markers.filter((m) => m.stageId === s.id);
            return (
              // 포인터 클릭 = 편의(§6.3/§6.4) — focusable 요소 없음, 키보드는 활동 표가 담당한다.
              <g key={s.id} style={{ cursor: "pointer" }} onClick={() => onSelectStage(s.id)}>
                <title>
                  {tg("nodeTitle", { id: s.id, name: stageDisplayName(s), count: s.activities.length })}
                </title>
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
                <text x={pos.x + 12} y={pos.y + 20} fontSize="12" fontWeight="600" fill="var(--fg)">
                  {s.id}
                </text>
                <rect x={pos.x + NODE_W - badgeW - 10} y={pos.y + 7} width={badgeW} height="16" rx="8" fill={badge.bg} stroke={badge.border} strokeWidth="1" />
                <text
                  x={pos.x + NODE_W - badgeW / 2 - 10}
                  y={pos.y + 18.5}
                  fontSize="10"
                  textAnchor="middle"
                  fill={badge.fg}
                >
                  {badge.label}
                </text>
                <text x={pos.x + 12} y={pos.y + 40} fontSize="12" fill="var(--fg)">
                  {/* 카드 폭 초과 단계명은 …으로 축약 — 원문은 노드 <title>(nodeTitle)이
                      전문 보존한다. 2026-10-25 보고: 1줄 레이아웃에선 축약이 상태였다 —
                      3줄 감기로 카드가 커져 서빙 데이터 전체가 무축약이다(축약은 방어선). */}
                  {truncateToWidth(stageDisplayName(s), 12, NODE_W - 24)}
                </text>
                {/* 활동 도트 행 — 도트 1개 = 활동 1개, 에이전트 도메인 색 + activity id 툴팁(§6.2). */}
                {s.activities.map((a, i) => {
                  const cx = pos.x + 16 + i * 11.5;
                  const cy = pos.y + 54;
                  const dotColor = domainDotColor(agentsByKey.get(a.agent)?.domain ?? "");
                  const marker = markersByActivity.get(`${s.id}:${a.id}`);
                  return (
                    <g key={a.id}>
                      <circle cx={cx} cy={cy} r="3.5" fill={dotColor}>
                        <title>
                          {marker
                            ? tg("markers.dotTitle", { id: a.id, kind: tg(markerKey(marker.kind, "short")), note: marker.note })
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
                <text x={pos.x + NODE_W - 10} y={pos.y + 57} fontSize="9.5" textAnchor="end" fill="var(--muted-fg)">
                  {tg("activityCount", { count: s.activities.length })}
                </text>
                {/* 마커 텍스트 라벨(노드 하단 좌측 — kind + 활동 id, 색 단독 금지).
                    2026-10-23 보고 대응: 노드 "우측"에 두면 다음 카드 본문과 겹쳤다 —
                    행 사이 여백(주행↔GF↔BF 거터)에 카드 좌변 기준으로 두고, 폭은
                    카드 폭−8로 축약(원문은 <title> 폴백)해 다음 열과 만나지 않는다. */}
                {stageMarkers.map((m, i) => {
                  const label = tg("markers.nodeLabel", { kind: tg(markerKey(m.kind, "short")), id: m.activityId });
                  return (
                    <text key={m.activityId} x={pos.x} y={pos.y + NODE_H + 12 + i * 12} fontSize="9.5" fill="var(--muted-fg)">
                      <title>{label}</title>
                      {truncateToWidth(label, 9.5, NODE_W - 8)}
                    </text>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 범례 — 그래프에 인접 렌더(§11.4): 도메인 도트 색·마커 3종을 텍스트와 병행한다.
          2026-10-23 보고 대응: 항목들이 한 줄로 뭉개져 보였다 — 제목 / 도트 설명 /
          도메인 / 마커를 각각 독립된 행으로 두고 항목 간 간격(gap-x-3)을 명시한다.
          각 행은 flex-wrap이라 좁은 화면에서도 잘려 죽는(…) 줄이 생기지 않는다. */}
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
          <span>{tg("legend.marker")}</span>
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
          <ul className="ml-4 mt-1 list-disc">
            {markers.map((m) => (
              <li key={`${m.stageId}:${m.activityId}`}>
                <code className="dd-item-id">{`${m.stageId}.${m.activityId}`}</code>{" "}
                {tg("markers.noteLine", { kind: tg(markerKey(m.kind, "short")), note: m.note })}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
    </figure>
  );
}
