"use client";

// 블루프린트 탭 — 단계 흐름 그래프 (design 2026-10-25-agent-assignment-prompt-standard §6.2/§6.4/§11.4).
// 위키 여정 지도(docs/wiki/ko/Home.md)의 기하를 세로 방향으로 적응한 순수 SVG다:
// 신규 의존성 0, 색은 전부 styles.css 토큰 CSS 변수(다크 모드 안전 — 차트 팔레트는
// ADR-0087의 유일한 범주형 팔레트 정의를 소비한다). 노드 = 단계(S1–S12 12개 —
// 활동 47개를 전부 노드로 그리면 가독성이 무해진다, §6.2), 노드 안 활동 도트 행
// (도트 1개 = 활동 1개, 에이전트 도메인 색)으로 "node = activity" 요구를 단계 그레인으로 충족.
//
// 기하: 세로 흐름 1주열 + 트랙 분기 1병렬열. 위키의 S4 분기→S5(greenfield)·S6→S7
// (brownfield)→S8 재합류 토폴로지를 그대로 옮긴 것이며, 세로를 택한 이유는
// 블루프린트 탭이 세로 문서 흐름(그리드 → 그래프 → 표, §6.5)이라 데스크톱에서
// 뷰박스가 확대 렌더되어 글자가 커지고(가로 12노드 체인은 viewBox 폭이 커져 축소
// 렌더로 글자가 무너진다) 역방향 화살표가 절대 생기지 않기 때문이다.
//
// 접근성(§6.4, WCAG 2.1 AA): 그래프는 role="img" + <title>/<desc>의 요약 이미지다
// (문구는 카탈로그 pages.flows.graph.* — 활성 로케일을 따른다). SVG 내부에 focusable
// 요소를 두지 않는다(포인터 클릭은 편의 — 키보드 경로는 인접 단계 그리드의 네이티브
// button 목록과 활동 표가 완전 대체한다). 색 단독 정보 없음: 도트 색은 범례
// 텍스트(도메인명)와 병행, 전문가 마커는 링 + 텍스트 라벨, 트랙 배지는 텍스트 배지다.
// 모션 없음(정적 SVG).
import { useTranslations } from "next-intl";
import type { BlueprintAgent, BlueprintStage, SpecialistMarker } from "./flows-view-lib.ts";
import { stageDisplayName } from "./flows-view-lib.ts";

// ── 기하 상수(위키 viewBox 비례 — 단계 추가는 ROW_Y 1행, §9 위험 완화) ──────
const NODE_W = 160;
const NODE_H = 54;
const MAIN_X = 16; // 공통 주열(공통 + greenfield S5 + 재합류 S8–S12)
const BRANCH_X = 292; // 병렬 분기열(brownfield S6→S7)
const VIEW_W = 470;
const VIEW_H = 842;
const ENTRY_GAP = 4; // 화살촉이 노드 변에 닿을 여백

/** 단계 좌표표 — 위키 기하의 세로 적응. 분기 행(y=320)에서 S5(주열)와 S6(병렬열),
 *  S7을 병렬열 아래로, S8에서 주열로 재합류한다. */
const ROW_Y: Record<string, { x: number; y: number }> = {
  S1: { x: MAIN_X, y: 16 },
  S2: { x: MAIN_X, y: 92 },
  S3: { x: MAIN_X, y: 168 },
  S4: { x: MAIN_X, y: 244 },
  S5: { x: MAIN_X, y: 320 },
  S6: { x: BRANCH_X, y: 320 },
  S7: { x: BRANCH_X, y: 394 },
  S8: { x: MAIN_X, y: 468 },
  S9: { x: MAIN_X, y: 544 },
  S10: { x: MAIN_X, y: 620 },
  S11: { x: MAIN_X, y: 696 },
  S12: { x: MAIN_X, y: 772 },
};

/** spec stateTransitions.onComplete 체인의 기하 반영(§6.2) — d는 절대좌표.
 *  세로 변은 from 노드 하변 → to 노드 상변 위 ENTRY_GAP, 재합류 S8에는
 *  S5(왼쪽 x=80)·S7(오른쪽 x=112)이 다른 지점으로 진입해 화살촉이 겹치지 않는다. */
const EDGES: string[] = [
  "M 96,66 V 88", // S1→S2
  "M 96,142 V 164", // S2→S3
  "M 96,218 V 240", // S3→S4
  "M 96,294 V 316", // S4→S5 (S4 하변 → greenfield 진행)
  "M 176,271 H 372 V 316", // S4→S6 (S4 우변 → brownfield 분기)
  "M 372,374 V 390", // S6→S7
  "M 80,374 V 464", // S5→S8 (재합류 — 왼쪽 진입)
  "M 292,421 H 112 V 464", // S7→S8 (재합류 — 오른쪽 진입)
  "M 96,522 V 540", // S8→S9
  "M 96,598 V 616", // S9→S10
  "M 96,674 V 692", // S10→S11
  "M 96,750 V 768", // S11→S12
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
      {/* overflow-x 컨테이너 — 좁은 화면에서 축소 대신 가로 스크롤(표의 tmin 규약과 같은 판단).
          tabIndex를 두지 않는다(§6.4 — 그래프는 탭 순서에 진입하지 않는다). */}
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          width="100%"
          role="img"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block", margin: "0 auto", maxWidth: "40rem" }}
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
            if (!pos) return null; // 미지 단계(스펙 신규 추가)는 좌표표 1행 추가 전까지 그래프에서 생략 — 그리드·표는 정상 렌더
            const selected = selectedStage === s.id;
            const badge = trackBadge(s.applicableTracks, tg("trackCommon"));
            const badgeW = badge.label.length * 5 + 14;
            const stageMarkers = markers.filter((m) => m.stageId === s.id);
            return (
              // 포인터 클릭 = 편의(§6.3/§6.4) — focusable 요소 없음, 키보드는 인접 그리드 버튼이 담당한다.
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
                <text x={pos.x + 10} y={pos.y + 17} fontSize="11" fontWeight="600" fill="var(--fg)">
                  {s.id}
                </text>
                <rect x={pos.x + NODE_W - badgeW - 8} y={pos.y + 6} width={badgeW} height="14" rx="7" fill={badge.bg} stroke={badge.border} strokeWidth="1" />
                <text
                  x={pos.x + NODE_W - badgeW / 2 - 8}
                  y={pos.y + 16}
                  fontSize="8.5"
                  textAnchor="middle"
                  fill={badge.fg}
                >
                  {badge.label}
                </text>
                <text x={pos.x + 10} y={pos.y + 33} fontSize="10.5" fill="var(--fg)">
                  {stageDisplayName(s)}
                </text>
                {/* 활동 도트 행 — 도트 1개 = 활동 1개, 에이전트 도메인 색 + activity id 툴팁(§6.2). */}
                {s.activities.map((a, i) => {
                  const cx = pos.x + 13 + i * 10;
                  const cy = pos.y + 45;
                  const dotColor = domainDotColor(agentsByKey.get(a.agent)?.domain ?? "");
                  const marker = markersByActivity.get(`${s.id}:${a.id}`);
                  return (
                    <g key={a.id}>
                      <circle cx={cx} cy={cy} r="3" fill={dotColor}>
                        <title>
                          {marker
                            ? tg("markers.dotTitle", { id: a.id, kind: tg(markerKey(marker.kind, "short")), note: marker.note })
                            : `${a.id} (${a.agent})`}
                        </title>
                      </circle>
                      {marker && (
                        // 전문가 마커 링(§11.4) — 색 외에 활동 옆 텍스트 라벨과 범례가 병행된다.
                        <circle cx={cx} cy={cy} r="6" fill="none" stroke={MARKER_KIND_COLOR[marker.kind]} strokeWidth="1.5" />
                      )}
                    </g>
                  );
                })}
                <text x={pos.x + NODE_W - 8} y={pos.y + 48} fontSize="9" textAnchor="end" fill="var(--muted-fg)">
                  {tg("activityCount", { count: s.activities.length })}
                </text>
                {/* 마커 텍스트 라벨(노드 우측 여백 — kind + 활동 id, 색 단독 금지). */}
                {stageMarkers.map((m, i) => (
                  <text key={m.activityId} x={pos.x + NODE_W + 14} y={pos.y + NODE_H + 12 + i * 12} fontSize="9.5" fill="var(--muted-fg)">
                    {tg("markers.nodeLabel", { kind: tg(markerKey(m.kind, "short")), id: m.activityId })}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 범례 — 그래프에 인접 렌더(§11.4): 도메인 도트 색·마커 3종을 텍스트와 병행한다. */}
      <figcaption className="mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-[color:var(--fg)]">{tg("legend.title")}</span>
          <span>{tg("legend.dot")}</span>
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
                <code className="dd-item-id">{`${m.stageId}.${m.activityId}`}</code>
                {tg("markers.noteLine", { kind: tg(markerKey(m.kind, "short")), note: m.note })}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
    </figure>
  );
}
