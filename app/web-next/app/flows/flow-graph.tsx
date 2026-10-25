"use client";

// 블루프린트 탭 — 단계 흐름 그래프 (design 2026-10-25-agent-assignment-prompt-standard §6.2/§6.4/§11.4).
// 위키 여정 지도(docs/wiki/ko/Home.md)와 같은 가로 방향의 순수 SVG다: 신규 의존성 0,
// 색은 전부 styles.css 토큰 CSS 변수(다크 모드 안전 — 차트 팔레트는 ADR-0087의 유일한
// 범주형 팔레트 정의를 소비한다). 노드 = 단계(S1–S12 12개 — 활동 47개를 전부 노드로
// 그리면 가독성이 무해진다, §6.2), 노드 안 활동 도트 행(도트 1개 = 활동 1개, 에이전트
// 도메인 색)으로 "node = activity" 요구를 단계 그레인으로 충족.
//
// 기하: 주행 1행(왼쪽→오른쪽) + 트랙 분기 2라인. S1→S4가 위 행에서 진행하고, S4
// 아래로 S5(greenfield 라인)·S6→S7(brownfield 라인)이 갈라져 S8에서 위 행으로
// 재합류, S8→S12가 오른쪽으로 이어진다 — 위키 Home 여정 지도와 같은 방향(2026-10-23
// 사용자 보고 반영: 세로 1주열은 화면 스크롤 비용이 컸다). viewBox가 넓어 좁은
// 화면에서는 컨테이너의 overflow-x 스크롤이 대신하고, minWidth가 읽기 하한(축소
// 렌더로 글자가 무너지는 것에 대한 완화)을 보장한다.
//
// 접근성(§6.4, WCAG 2.1 AA): 그래프는 role="img" + <title>/<desc>의 요약 이미지다
// (문구는 카탈로그 pages.flows.graph.* — 활성 로케일을 따른다). SVG 내부에 focusable
// 요소를 두지 않는다(포인터 클릭은 편의 — 키보드 경로는 활동 표가 완전 대체한다).
// 색 단독 정보 없음: 도트 색은 범례 텍스트(도메인명)와 병행, 전문가 마커는 링 +
// 텍스트 라벨, 트랙 배지는 텍스트 배지다. 모션 없음(정적 SVG).
import { useTranslations } from "next-intl";
import type { BlueprintAgent, BlueprintStage, SpecialistMarker } from "./flows-view-lib.ts";
import { stageDisplayName } from "./flows-view-lib.ts";

// ── 기하 상수(위키 여정 지도의 가로 적용 — 단계 추가는 한 칸 x 이동, §9 위험 완화) ─
const NODE_W = 140;
const NODE_H = 54;
const MAIN_Y = 16; // 공통 주행 행(공통 + 재합류 S8–S12)
const GF_Y = 92; // greenfield 분기 라인(S5)
const BF_Y = 168; // brownfield 분기 라인(S6→S7)
const VIEW_W = 1820;
const VIEW_H = 260;
const ENTRY_GAP = 4; // 화살촉이 노드 변에 닿을 여백

/** 단계 좌표표 — 위키 기하(가로 여정 지도)의 재적용. 주행 S1→S4가 위 행에서
 *  진행하고, S4 아래로 greenfield 라인(S5)과 brownfield 라인(S6→S7)이 갈라져
 *  S8에서 위 행으로 재합류, S8→S12가 오른쪽으로 이어진다. */
const ROW_Y: Record<string, { x: number; y: number }> = {
  S1: { x: 16, y: MAIN_Y },
  S2: { x: 176, y: MAIN_Y },
  S3: { x: 336, y: MAIN_Y },
  S4: { x: 496, y: MAIN_Y },
  S5: { x: 688, y: GF_Y },
  S6: { x: 688, y: BF_Y },
  S7: { x: 848, y: BF_Y },
  S8: { x: 1024, y: MAIN_Y },
  S9: { x: 1184, y: MAIN_Y },
  S10: { x: 1344, y: MAIN_Y },
  S11: { x: 1504, y: MAIN_Y },
  S12: { x: 1664, y: MAIN_Y },
};

/** spec stateTransitions.onComplete 체인의 기하 반영(§6.2) — d는 절대좌표.
 *  가로 변은 from 노드 우변 → to 노드 좌변 위 ENTRY_GAP. S4의 두 분기는 하변
 *  x=516에서 내려와 각 라인의 좌변으로 진입하고, 재합류 S8의 좌변에는 S5(위쪽
 *  y=30)·S7(아래쪽 y=56)이 다른 높이로 진입해 화살촉이 겹치지 않는다. */
const EDGES: string[] = [
  "M 156,43 H 172", // S1→S2
  "M 316,43 H 332", // S2→S3
  "M 476,43 H 492", // S3→S4
  "M 516,70 V 119 H 684", // S4→S5 (S4 하변 → greenfield 라인)
  "M 516,70 V 195 H 684", // S4→S6 (S4 하변 → brownfield 라인)
  "M 828,195 H 844", // S6→S7
  "M 828,119 H 996 V 30 H 1020", // S5→S8 (재합류 — 좌변 위쪽 진입)
  "M 988,195 H 1008 V 56 H 1020", // S7→S8 (재합류 — 좌변 아래쪽 진입)
  "M 1164,43 H 1180", // S8→S9
  "M 1324,43 H 1340", // S9→S10
  "M 1484,43 H 1500", // S10→S11
  "M 1644,43 H 1660", // S11→S12
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
      {/* overflow-x 컨테이너 — 가로 그래프는 좁은 화면에서 축소 대신 가로 스크롤
          (표의 tmin 규약과 같은 판단). svg minWidth가 읽기 하한을 보장한다.
          tabIndex를 두지 않는다(§6.4 — 그래프는 탭 순서에 진입하지 않는다). */}
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          width="100%"
          role="img"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block", margin: "0 auto", minWidth: "80rem" }}
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
            const badgeW = badge.label.length * 5 + 14;
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
