// @version 1.5.0
// 플로우 콘솔 화면(2026-10-24-flow-console-screen-design, Row 4) — 순수 뷰 헬퍼
// 단위 테스트 + 화면 소스의 a11y 규약 정적 검사(§9 체크리스트 핵심 항목).
// 1.1.0: 단계명 사본 제거(design 2026-10-25-agent-assignment-prompt-standard §6.1 —
// /api/flows가 stage.name 직접 투영) + 단계 흐름 그래프(§6.2/§6.4/§11.4) 정적 규약.
// 1.2.0: 그래프·블루프린트 문구의 카탈로그 추출(§3.6 배치) — 그래프 문구 핀을
// 컴포넌트 소스 리터럴에서 "키 호출부 + ko 마스터 카탈로그 값" 규약으로 이행.
// 1.3.0: 단계 요약 그리드 제거 + 그래프 가로(좌→우) 전환(2026-10-23 사용자 보고 —
// 그리드는 그래프와 정보 중복). 키보드 경로 핀을 그리드 button → 활동 표로 이행하고
// 그리드 잔존(aria-pressed·stageGrid·useStageErrors)을 금지하는 회귀 핀을 추가.
// 기준 창 표기(windowTokenKey)의 현지화 규약 핀 추가.
// 1.4.0: 2026-10-23 사용자 보고(레이아웃 붕괴) 대응 — (a) SVG 텍스트 근사 계측
// helper(approxTextWidth/truncateToWidth) 단위 테스트, (b) 그래프 기하 머신체크:
// 소스 상수(NODE_W/COL_GAP/ROW_Y/VIEW_*)를 파싱해 실제 서빙 데이터
// (spec-activities.generated.ts)와 대입 검증 — 인접 카드 비충돌·최장 단계명 수용·
// 도트 행/활동 수 라벨 비충돌·뷰박스 수용, (c) 런 레저 차트: barMaxWidth 상한 +
// 범례 상단 고정 + 단일 버킷 캡션(chartSingleBucket) 핀.
// 1.5.0: 2026-10-25 사용자 보고(12노드 1줄 = 카드 축소·분기 밴드 우측 공백) 대응 —
// 그래프 3줄 감기 레이아웃 머신체크로 이행: (a) 행별 단계 배정(첫째 줄 S1–S4 /
// 분기 밴드 GF S5·BF S6→S7·합류 S8 / 셋째 줄 S9–S12)과 줄당 ≤5 노드, (b) 노드
// 상호 비중첩(사각형 교차), (c) 엣지 앵커 체크(12개 엣지가 출발/도착 노드 변에
// ENTRY_GAP 간격으로 붙고 카드를 관통하지 않으며 뷰박스 안에 있는다), (d) 확대된
// 카드(NODE_W 232)의 무축약 단계명·도트 행·배지 산술 갱신.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approxTextWidth, bucketLlmCallsByDay, classifiedByChip, fmtDateTime, fmtInt, fmtPct, fmtSeconds, fmtUsd,
  runStatusChip, stageDisplayName, totalTokens, truncateToWidth, windowTokenKey,
  type LlmCallRow,
} from "../../app/web-next/app/flows/flows-view-lib.ts";
import { SPEC_STAGES } from "../../app/web-next/lib/spec-activities.generated.ts";

const FLOWS_DIR = join(import.meta.dirname, "../../app/web-next/app/flows");
// i18n (design 2026-10-23-i18n-ui-adoption): wording pins assert the key call site
// in the component source and the ko master catalog value (the original Korean).
const koCatalog = await import("../../app/web-next/locales/ko.json");
const koOf = (key: string): string =>
  key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog) as string;
const SCROLL_LABEL = "데이터 표 (가로 스크롤)";

const llmRow = (over: Partial<LlmCallRow> = {}): LlmCallRow => ({
  id: "c1", agent_key: "pm", purpose: "S2 기회 발굴 — 산업 근거 기반 기회 후보 도출", context_type: null, context_id: null,
  source: "llm", provider: "openai", model: "gpt-test", ok: 1, error: null, latency_ms: 1200,
  input_tokens: 100, output_tokens: 50, cache_read_tokens: 10, cache_write_tokens: 5,
  cost_usd: 0.005, usage_estimated: 0, function_name: null, prompt_hash: "abc", created_at: "2026-10-24T09:00:00Z",
  catalogMatched: true, ...over,
});

describe("flows-view-lib — 포맷터", () => {
  test("fmtInt/fmtUsd/fmtPct는 null을 — 로 표시한다(미집계와 0을 구분)", () => {
    expect(fmtInt(null)).toBe("—");
    expect(fmtInt(12345)).toBe("12,345");
    expect(fmtUsd(null)).toBe("—");
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(0.0012)).toBe("$0.0012");
    expect(fmtUsd(18.4)).toBe("$18.40");
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(0.008)).toBe("0.8%");
  });
  test("fmtSeconds는 ms/s/분 경계를 나눈다", () => {
    expect(fmtSeconds(null)).toBe("—");
    expect(fmtSeconds(850)).toBe("850ms");
    expect(fmtSeconds(21300)).toBe("21.3s");
    expect(fmtSeconds(125000)).toBe("2m 5s");
  });
  test("windowTokenKey는 API window 토큰을 ledger 카탈로그 키로 방출한다(기준 창 현지화)", () => {
    // 2026-10-23 사용자 보고: "기준 창: 7d"처럼 원문 토큰이 노출되었다 — 화면은
    // 이 헬퍼의 키를 t()로 풀어 쓰고("최근 7일"), 미지 토큰만 원문 폴백한다.
    expect(windowTokenKey("24h")).toBe("window24h");
    expect(windowTokenKey("7d")).toBe("window7d");
    expect(windowTokenKey("30d")).toBe("window30d");
    expect(windowTokenKey("90d")).toBeNull();
    expect(windowTokenKey(null)).toBeNull();
    expect(koOf("pages.flows.ledger.window7d")).toBe("최근 7일");
  });
  test("fmtDateTime은 ISO를 MM-DD HH:mm로 요약하고 totalTokens는 4열 합계(llm-rollup 규약)", () => {
    expect(fmtDateTime("2026-10-24T09:12:00Z")).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(fmtDateTime(null)).toBe("—");
    expect(totalTokens(llmRow())).toBe(165);
  });
});

describe("flows-view-lib — 칩 매핑 (A5: 색 단독 금지, 아이콘+텍스트; i18n 키 방출)", () => {
  test("런 상태는 ✓/✕ 아이콘+텍스트 병기 — catalog 키 방출, 미지 값은 원문 폴백", () => {
    expect(runStatusChip("failed")).toEqual({ key: "pages.flows.chips.runFailed", label: "", cls: "status-chip status-rejected" });
    expect(koOf("pages.flows.chips.runFailed")).toBe("✕ 실패");
    expect(runStatusChip("succeeded")).toEqual({ key: "pages.flows.chips.runSuccess", label: "", cls: "status-chip status-approved" });
    expect(koOf("pages.flows.chips.runSuccess")).toBe("✓ 성공");
    expect(runStatusChip("unknown-state")).toEqual({ key: null, label: "unknown-state", cls: "status-chip status-not-started" });
  });
  test("근거 칩은 Row 3가 노출하는 catalogMatched+source로만 유도된다", () => {
    expect(classifiedByChip(llmRow({ source: "synthesis" })).key).toBe("pages.flows.chips.deterministic");
    expect(koOf("pages.flows.chips.deterministic")).toBe("결정론");
    expect(classifiedByChip(llmRow({ catalogMatched: true })).key).toBe("pages.flows.chips.catalog");
    expect(koOf("pages.flows.chips.catalog")).toBe("카탈로그");
    expect(classifiedByChip(llmRow({ catalogMatched: false })).key).toBe("pages.flows.chips.offCatalog");
    expect(koOf("pages.flows.chips.offCatalog")).toBe("카탈로그 외");
  });
});

describe("flows-view-lib — 단계명(API 직접 투영)과 타임라인 버킷", () => {
  test("stageDisplayName은 /api/flows가 서빙하는 stage.name을 쓰고, 결측 시에만 id로 폴백한다", () => {
    // design 2026-10-25 §6.1: 스펙 단계명은 SPEC_STAGES 직접 투영 — 클라이언트 사본 없음.
    expect(stageDisplayName({ id: "S3", name: "시너지·전략적 적합성" })).toBe("시너지·전략적 적합성");
    expect(stageDisplayName({ id: "S13", name: "" })).toBe("S13"); // 방어적 폴백(로직 분기 금지 유지)
    expect(stageDisplayName({ id: "S13", name: undefined as unknown as string })).toBe("S13");
  });
  test("단계명 클라이언트 사본(STAGE_NAME_KEY·stageNames)은 flows-view-lib에서 제거되었다", () => {
    const lib = readFileSync(join(FLOWS_DIR, "flows-view-lib.ts"), "utf8");
    expect(lib).not.toContain("STAGE_NAME_KEY");
    expect(lib).not.toContain("stageNames"); // i18n catalog 키 유도 사본도 없다 — name은 API 데이터
    expect(lib).toContain("stageDisplayName");
  });
  test("bucketLlmCallsByDay는 일 단위로 성공/실패/비용을 묶고 오름차순 정렬한다", () => {
    const rows = [
      llmRow({ created_at: "2026-10-24T09:00:00Z", ok: 1, cost_usd: 0.01 }),
      llmRow({ created_at: "2026-10-24T10:00:00Z", ok: 0, cost_usd: null }),
      llmRow({ created_at: "2026-10-23T22:00:00Z", ok: 1, cost_usd: 0.02 }),
    ];
    const buckets = bucketLlmCallsByDay(rows);
    expect(buckets.map((b) => b.day)).toEqual(["10-23", "10-24"]);
    expect(buckets[1]).toMatchObject({ ok: 1, failed: 1 });
    expect(buckets[1].costUsd).toBeCloseTo(0.01);
  });
});

describe("flows 화면 소스 — a11y·IA 정적 규약 (화면 설계 §9)", () => {
  const page = readFileSync(join(FLOWS_DIR, "page.tsx"), "utf8");
  const blueprint = readFileSync(join(FLOWS_DIR, "blueprint-view.tsx"), "utf8");
  const ledger = readFileSync(join(FLOWS_DIR, "ledger-view.tsx"), "utf8");
  const expansion = readFileSync(join(FLOWS_DIR, "run-expansion.tsx"), "utf8");

  test("A3 — 모든 표가 table-scroll region + sr-only caption + th scope=col 규약을 따른다", () => {
    for (const [name, src] of [["page", page], ["blueprint", blueprint], ["ledger", ledger], ["expansion", expansion]] as const) {
      const scrolls = src.split("table-scroll").length - 1;
      // 각 table-scroll 지역이 role/aria-label/tabIndex를 갖는지(간접: 파일 내 최소 등장 수).
      if (scrolls > 0) {
        expect(src, `${name} table-scroll role`).toContain('role="region"');
        // i18n: the scroll-region label resolves through a catalog key (ko value pinned).
        const scrollKey = name === "ledger" ? "pages.flows.ledger.tableScrollRegion"
          : name === "blueprint" ? "pages.flows.blueprint.tableScrollRegion"
          : name === "expansion" ? "pages.flows.runExpansion.tableScrollRegion"
          : "pages.flows.flowsAdmin.tableScrollRegion";
        expect(koOf(scrollKey)).toBe(SCROLL_LABEL);
        expect(src, `${name} table-scroll aria-label key`).toMatch(/aria-label=\{t\("/);
        expect(src, `${name} table-scroll tabIndex`).toContain("tabIndex={0}");
      }
    }
    expect(blueprint).toContain('className="sr-only"');
    expect(ledger).toContain('className="sr-only"');
    expect(expansion).toContain('className="sr-only"');
  });

  test("A1 — 드릴다운은 네이티브 details/summary(자작 탭바·포털 금지)", () => {
    expect(blueprint).toContain("<details");
    expect(expansion).toContain("<details");
    expect(blueprint).toContain("<summary");
  });

  test("A8 — 탭은 Tabs 프리미티브를 재사용한다(자작 탭바 금지, ADR-0121)", () => {
    expect(page).toContain("from \"../../components/ui.tsx\"");
    expect(page).toContain("<Tabs");
  });

  test("§10 — 403(admin)은 재시도 없이 설계된 경계 문구로 표시된다", () => {
    expect(koOf("pages.flows.flowsAdmin.adminForbidden")).toContain("ADR-0146");
    expect(page).toContain('t(ADMIN_FORBIDDEN_KEY)');
    expect(page).toContain("onRetry={() => setRetryTick");
    expect(ledger).toContain('t(ADMIN_FORBIDDEN_KEY)');
    expect(koOf("pages.flows.ledger.adminForbidden")).toContain("ADR-0146");
  });

  test("§5.4 — LLM 미구성 상태가 empty와 구분된 문구로 분기된다", () => {
    expect(ledger).toContain('t("emptyNoLlm")');
    expect(koOf("pages.flows.ledger.emptyNoLlm")).toContain("LLM이 구성되지 않아");
  });

  test("§11 — 필터 상태가 URL 쿼리에 동기된다(감사 화면 재현성)", () => {
    expect(ledger).toContain("router.replace");
    expect(page).toContain("router.replace");
  });

  test("런 레저 차트 — 막대 폭 상한·범례 상단 고정·단일 버킷 캡션(2026-10-23 보고 대응)", () => {
    // 막대 1개가 그리드 전폭을 덮던 것: barMaxWidth 32 상한이 두 막대 계열 모두에.
    expect(ledger.match(/barMaxWidth: 32/g)?.length).toBe(2);
    // 범례가 x축·자기 마커와 겹치던 것: 상단 고정 + grid.top 여백 + 축 라벨 포함 계산.
    expect(ledger).toContain("legend: { top: 0");
    expect(ledger).toContain("top: 56");
    expect(ledger).toContain("containLabel: true");
    // 단일 버킷 정직 캡션 — 양 로케일 파라미터 포함(ko가 마스터 원문).
    expect(ledger).toContain('t("chartSingleBucket"');
    const koSingle = koOf("pages.flows.ledger.chartSingleBucket");
    expect(koSingle).toContain("{p1}");
    expect(koSingle).toContain("{p2}");
    expect(koSingle).toContain("하루");
  });
});

describe("flows-view-lib — SVG 텍스트 근사 계측·축약 (2026-10-23 그래프 기하 보고 대응)", () => {
  test("approxTextWidth는 전각(한글)은 fontSize, 반각은 0.55×fontSize로 잰다", () => {
    expect(approxTextWidth("시너지", 10)).toBe(30); // 전각 3음절
    expect(approxTextWidth("S10", 10)).toBeCloseTo(16.5); // 반각 3자
    expect(approxTextWidth("활동 12", 9)).toBeCloseTo(32.85); // 혼합(2음절+공백+숫자 2)
  });
  test("truncateToWidth는 폭 내 텍스트를 그대로 두고 초과분만 …으로 축약한다(원문 보존)", () => {
    expect(truncateToWidth("시장분석", 10.5, 148)).toBe("시장분석"); // 42px — 무축약
    const long = "A".repeat(40);
    const cut = truncateToWidth(long, 10, 100);
    expect(cut).toMatch(/…$/);
    expect(cut.startsWith("AAAAAAAA")).toBe(true); // … 직전까지 원문 접두 보존
    expect(approxTextWidth(cut, 10)).toBeLessThanOrEqual(100);
  });
});

describe("단계 흐름 그래프 — flow-graph.tsx (design 2026-10-25-agent-assignment-prompt-standard §6.2/§6.4/§11.4)", () => {
  const graph = readFileSync(join(FLOWS_DIR, "flow-graph.tsx"), "utf8");
  const blueprint = readFileSync(join(FLOWS_DIR, "blueprint-view.tsx"), "utf8");
  const lib = readFileSync(join(FLOWS_DIR, "flows-view-lib.ts"), "utf8");

  test("그래프는 role=img + title/desc의 요약 이미지다(위키 여정 지도 패턴, 카탈로그 문구)", () => {
    expect(graph).toContain('role="img"');
    expect(graph).toContain("<title>");
    expect(graph).toContain("<desc>");
    expect(graph).toContain('xmlns="http://www.w3.org/2000/svg"');
    // i18n: title/desc는 pages.flows.graph.* 키로 방출 — ko 마스터 값이 위키 문구 계열을 보존한다.
    expect(graph).toContain('tg("svgTitle")');
    expect(graph).toContain('tg("svgDesc")');
    expect(koOf("pages.flows.graph.svgTitle")).toContain("설계된 플로우"); // §6.4 — 위키 문구 계열의 title
  });

  test("기하는 3줄 감기 가로 뷰박스다 — viewBox 폭>높이 + width=100%/height auto + marker 화살표 + 토큰 색", () => {
    expect(graph).toContain("viewBox={");
    expect(graph).toContain('width="100%"');
    expect(graph).toContain('height: "auto"'); // 2026-10-25 보고: 뷰박스 종횡비가 폭 대비 높이를 얇게
    // 만들어 카드가 축소 렌더·왼쪽 뭉침으로 보였다 — 3줄 감기(≈2.7:1) + 명시적
    // height auto. minWidth(50rem)는 좁은 화면의 읽기 하한(그 아래만 overflow-x).
    expect(graph).not.toContain("maxWidth");
    expect(graph).toContain("minWidth");
    expect(graph).toContain("markerEnd"); // 화살표 엣지
    expect(graph).toContain("var(--border)"); // CSS 변수 색(다크 모드 안전)
    // spec onComplete 체인 전체(분기 2본 포함)가 엣지 주석으로 존재한다.
    for (const edge of ["S1→S2", "S2→S3", "S3→S4", "S4→S5", "S4→S6", "S6→S7", "S5→S8", "S7→S8", "S8→S9", "S9→S10", "S10→S11", "S11→S12"]) {
      expect(graph).toContain(edge);
    }
  });

  test("전문가 마커 3종은 링 + 텍스트 범례로 렌더된다(§11.4 — 색 단독 금지, 카탈로그 문구)", () => {
    // kind별 짧은 라벨과 §11.4 범례 문언 — 키 호출부(markerKey 헬퍼) + ko 마스터 값 원문 핀.
    expect(graph).toContain('markerKey(marker.kind, "short")');
    expect(koOf("pages.flows.graph.markers.affinity.short")).toBe("전문 친화");
    expect(koOf("pages.flows.graph.markers.scoped.short")).toBe("절차 한정");
    expect(koOf("pages.flows.graph.markers.override.short")).toBe("실효 소유");
    expect(koOf("pages.flows.graph.markers.affinity.legend")).toBe("트랙 전문가 관점(공통 산출)"); // affinity 범례
    expect(koOf("pages.flows.graph.markers.scoped.legend")).toBe("트랙 전용(절차 스코프)"); // scoped 범례
    expect(koOf("pages.flows.graph.markers.override.legend")).toBe("트랙별 실효 소유 상이(절차 계층)"); // override 범례
    // 링(원 스트로크) 시각자표 + 도트 title·마커 목록의 note 병행 — 텍스트로 제공.
    expect(graph).toContain('fill="none" stroke={MARKER_KIND_COLOR[marker.kind]}');
    expect(graph).toContain('tg("markers.dotTitle"');
    expect(graph).toContain('tg("markers.noteLine"');
  });

  test("그래프 색은 전부 CSS 변수 토큰이다 — 원시 색 상수 0(ADR-0087·design-lint 규약)", () => {
    expect(graph).toMatch(/var\(--chart-/);
    expect(graph).not.toMatch(/#[0-9a-fA-F]{3,8}\b/); // raw hex 금지
    expect(graph).not.toMatch(/rgba?\(/);
  });

  test("SVG 내부에 focusable 요소가 없다 — 키보드 경로는 활동 표(§6.4, WCAG)", () => {
    // 속성 수준 검사 — tabIndex 속성 자체가 없어야 한다(문서 주석의 단어가 아님).
    expect(graph).not.toMatch(/tabIndex\s*=\s*\{/i);
    expect(graph).not.toContain("<button");
    expect(graph).not.toContain("aria-pressed");
    // 대체재: 활동 표가 단계 선택·필터의 키보드 경로다. 단계 요약 그리드(네이티브
    // button 목록)는 2026-10-23 그래프 중복 제거로 삭제되었다 — 잔존은 회귀다.
    expect(blueprint).not.toContain("aria-pressed");
    expect(blueprint).not.toContain("stageGrid");
    expect(blueprint).not.toContain("useStageErrors");
    // 그래프 클릭은 기존 단계 선택 상태를 재사용한다(§6.3 — 새 state 0).
    expect(blueprint).toContain("<FlowGraph");
    expect(blueprint).toContain("onSelectStage={(stageId) => setSelectedStage");
    expect(blueprint).toContain("markers={blueprint.specialistMarkers}");
  });

  test("그래프는 서빙 데이터만 소비한다 — stage.name·applicableTracks·specialistMarkers", () => {
    expect(graph).toContain("stageDisplayName"); // 하드코딩 단계명 맵 금지 — API name
    expect(graph).toContain("applicableTracks"); // 트랙 배지 = 직접 투영
    expect(graph).not.toContain("trackScope"); // 프롬프트 trackScope 합집합 유도는 제거되었다(§6.1)
    expect(graph).toContain("agentsByKey"); // 도트 색 = 페이로드 agents[].domain
    expect(blueprint).not.toContain("activityTrack"); // 과거 trackScope 합집합 헬퍼 소멸
    expect(blueprint).toContain("tracksByStage"); // 표의 트랙 열도 단계 applicableTracks를 읽는다
    // 활동 표에 마커 전용 표기(§11.4) — 칩 문구는 graph 네임스페이스 키로 방출.
    expect(blueprint).toContain("markersByActivity");
    expect(blueprint).toContain('tg(markerKey(marker.kind, "short"))');
    // 계약: FlowsBlueprint가 specialistMarkers를 타이핕한다.
    expect(lib).toContain("specialistMarkers: SpecialistMarker[]");
  });

  // ── 기하 머신체크(1.5.0, 3줄 감기) — 소스 상수를 파싱해 실제 서빙 데이터
  // (SPEC_STAGES)와 대입 검증한다. 2026-10-25 사용자 보고(12노드 1줄 → 카드 축소·
  // 분기 밴드 우측 공백)의 회귀 핀: 상수 하나를 잘못 고치면 여기서 산술이 깨진다.
  const numConst = (name: string): number => {
    const m = new RegExp(`const ${name} = (\\d+)`).exec(graph);
    if (!m) throw new Error(`flow-graph.tsx: ${name} constant not found`);
    return Number(m[1]);
  };
  const G = {
    NODE_W: numConst("NODE_W"), NODE_H: numConst("NODE_H"), COL_GAP: numConst("COL_GAP"),
    R1_Y: numConst("R1_Y"), GF_Y: numConst("GF_Y"), BF_Y: numConst("BF_Y"),
    MERGE_Y: numConst("MERGE_Y"), R3_Y: numConst("R3_Y"),
    VIEW_W: numConst("VIEW_W"), VIEW_H: numConst("VIEW_H"),
  };
  const ROWS: Record<string, number> = { R1_Y: G.R1_Y, GF_Y: G.GF_Y, BF_Y: G.BF_Y, MERGE_Y: G.MERGE_Y, R3_Y: G.R3_Y };
  const rowY: Record<string, { x: number; y: number }> = {};
  for (const m of graph.matchAll(/(S\d+): \{ x: (\d+), y: (R1_Y|GF_Y|BF_Y|MERGE_Y|R3_Y) \}/g)) {
    rowY[m[1]!] = { x: Number(m[2]), y: ROWS[m[3]!]! };
  }

  test("기하 머신체크 — 3줄 감기 배정: 행별 단계·줄당 ≤5노드·인접 카드 비충돌·노드 상호 비중첩·행 간 거터", () => {
    expect(Object.keys(rowY).sort()).toEqual(["S1","S10","S11","S12","S2","S3","S4","S5","S6","S7","S8","S9"]);
    // 행별 배정 — 첫째 줄 공통 S1–S4, 분기 밴드(GF 라인 S5 / BF 라인 S6→S7 / 합류 S8),
    // 셋째 줄 공통 S9–S12. 줄당 노드는 5개 이하(2026-10-25 보고: 12노드 1줄은 카드가
    // 너무 작았다 — 노드 크기 보존이 3줄 감기의 목적).
    const rowsOf = (y: number) => Object.entries(rowY).filter(([, p]) => p.y === y).map(([id]) => id).sort();
    expect(rowsOf(G.R1_Y)).toEqual(["S1", "S2", "S3", "S4"]);
    expect(rowsOf(G.GF_Y)).toEqual(["S5"]);
    expect(rowsOf(G.BF_Y)).toEqual(["S6", "S7"]);
    expect(rowsOf(G.MERGE_Y)).toEqual(["S8"]);
    expect(rowsOf(G.R3_Y)).toEqual(["S10", "S11", "S12", "S9"]); // lexicographic sort
    // 합류 S8은 두 라인의 세로 중앙(GF/BF 카드 중심의 중간) — 분기·합류가 시각적으로 대칭.
    expect(G.MERGE_Y + G.NODE_H / 2).toBeCloseTo((G.GF_Y + G.NODE_H / 2 + G.BF_Y + G.NODE_H / 2) / 2);
    // 같은 행(같은 y) 카드들의 x 피치가 카드 폭+간격을 확보한다 — 인접 카드 텍스트
    // 충돌의 원천 차단(2026-10-23 보고 회귀 핀).
    for (const y of Object.values(ROWS)) {
      const xs = Object.values(rowY).filter((p) => p.y === y).map((p) => p.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]! - xs[i - 1]!, `row y=${y} 인접 카드 피치`).toBeGreaterThanOrEqual(G.NODE_W + G.COL_GAP);
      }
    }
    // 노드 상호 비중첩(사각형 교차 0) — 합류 S8이 두 라인에 걸치므로 y가 다른 노드
    // 쌍까지 검증한다(예: S8×S5, S8×S6은 x가 서로 다른 열이어야 한다).
    const ids = Object.keys(rowY);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = rowY[ids[i]!]!;
        const b = rowY[ids[j]!]!;
        const overlap = a.x < b.x + G.NODE_W && b.x < a.x + G.NODE_W && a.y < b.y + G.NODE_H && b.y < a.y + G.NODE_H;
        expect(overlap, `${ids[i]}×${ids[j]} 노드 중첩`).toBe(false);
      }
    }
    // 행 사이 마커 거터(라벨 12px baseline + 여백) — 라벨이 다음 행 카드에 닿지 않는다.
    expect(G.GF_Y - (G.R1_Y + G.NODE_H)).toBeGreaterThanOrEqual(26);
    expect(G.BF_Y - (G.GF_Y + G.NODE_H)).toBeGreaterThanOrEqual(26);
    expect(G.R3_Y - (G.BF_Y + G.NODE_H)).toBeGreaterThanOrEqual(26);
  });

  test("기하 머신체크 — 뷰박스 수용: 전 카드·마커 거터 라벨이 VIEW_W/VIEW_H 안에 들어온다", () => {
    const maxX = Math.max(...Object.values(rowY).map((p) => p.x + G.NODE_W));
    expect(maxX + 8).toBeLessThanOrEqual(G.VIEW_W);
    const maxY = Math.max(...Object.values(rowY).map((p) => p.y));
    expect(maxY + G.NODE_H + 26).toBeLessThanOrEqual(G.VIEW_H); // 하단 마커 라벨(12px baseline + 하강)
  });

  test("기하 머신체크 — 엣지 앵커: 12개 엣지가 출발/도착 노드 변에 붙고, 카드를 관통하지 않고, 뷰박스 안에 있다", () => {
    // EDGES 주석의 "S#→S#" 라벨과 d 문자열을 함께 파싱한다(주석이 기하 문서의 SSOT).
    const edges: Array<{ d: string; from: string; to: string }> = [];
    for (const m of graph.matchAll(/"(M [^"]+)", *\/\/ (S\d+)→(S\d+)/g)) {
      edges.push({ d: m[1]!, from: m[2]!, to: m[3]! });
    }
    // spec onComplete 체인 전체(분기 S4→S5/S4→S6, 합류 S5→S8/S7→S8 포함).
    expect(edges.map((e) => `${e.from}→${e.to}`).sort()).toEqual([
      "S10→S11", "S11→S12", "S1→S2", "S2→S3", "S3→S4", "S4→S5", "S4→S6",
      "S5→S8", "S6→S7", "S7→S8", "S8→S9", "S9→S10",
    ].sort());
    // d 문자열(축약 M/H/V — "M 252,48 H 280"처럼 명령과 인자가 공백으로 나뉜다)을
    // 점열로 바꾼다 — 모든 세그먼트는 축(수평/수직) 정렬.
    const parsePath = (d: string): Array<{ x: number; y: number }> => {
      const pts: Array<{ x: number; y: number }> = [];
      let cur = { x: 0, y: 0 };
      for (const m of d.matchAll(/([MHV])\s*([-\d.,]*)/g)) {
        const cmd = m[1]!, arg = m[2] ?? "";
        if (cmd === "M") {
          const [x, y] = arg.split(",");
          cur = { x: Number(x), y: Number(y) };
          pts.push({ ...cur });
        } else if (cmd === "H") {
          cur = { x: Number(arg), y: cur.y };
          pts.push({ ...cur });
        } else if (cmd === "V") {
          cur = { x: cur.x, y: Number(arg) };
          pts.push({ ...cur });
        }
      }
      return pts;
    };
    // 앵커: 점이 노드 사각형을 tol(=ENTRY_GAP+2) 이내로 확장한 테두리에 붙는다
    // (내부 중앙은 거부 — dx·dy가 전부 0이면 카드 내부라 실패).
    const anchored = (p: { x: number; y: number }, id: string, tol = 6): boolean => {
      const n = rowY[id]!;
      const dx = Math.max(n.x - p.x, 0, p.x - (n.x + G.NODE_W));
      const dy = Math.max(n.y - p.y, 0, p.y - (n.y + G.NODE_H));
      return dx <= tol && dy <= tol && (dx > 0 || dy > 0);
    };
    const segCrossesRect = (
      a: { x: number; y: number }, b: { x: number; y: number },
      rx: number, ry: number, rw: number, rh: number,
    ): boolean => {
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
      const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      return x1 < rx + rw && rx < x2 && y1 < ry + rh && ry < y2;
    };
    for (const e of edges) {
      const pts = parsePath(e.d);
      expect(pts.length, `${e.from}→${e.to} 경로 점 수`).toBeGreaterThanOrEqual(2);
      expect(anchored(pts[0]!, e.from), `${e.from}→${e.to} 출발점이 ${e.from} 변에`).toBe(true);
      expect(anchored(pts[pts.length - 1]!, e.to), `${e.from}→${e.to} 도착점이 ${e.to} 변에`).toBe(true);
      for (const p of pts) {
        expect(p.x, `${e.from}→${e.to} 뷰박스 x`).toBeGreaterThanOrEqual(0);
        expect(p.x, `${e.from}→${e.to} 뷰박스 x`).toBeLessThanOrEqual(G.VIEW_W);
        expect(p.y, `${e.from}→${e.to} 뷰박스 y`).toBeGreaterThanOrEqual(0);
        expect(p.y, `${e.from}→${e.to} 뷰박스 y`).toBeLessThanOrEqual(G.VIEW_H);
      }
      // 엣지 세그먼트는 어떤 카드 내부도 관통하지 않는다(교차 0 배치 — 3줄 감기의
      // 가독성 근거). 카드 변과의 접촉은 앵커 tol을 감안해 1px 안쪽으로 준 사각형으로 잰다.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!, b = pts[i]!;
        for (const id of Object.keys(rowY)) {
          const n = rowY[id]!;
          const crosses = segCrossesRect(a, b, n.x + 1, n.y + 1, G.NODE_W - 2, G.NODE_H - 2);
          expect(crosses, `${e.from}→${e.to} 세그먼트가 ${id} 카드를 관통`).toBe(false);
        }
      }
    }
  });

  test("기하 머신체크 — 최장 단계명(ko)이 카드 가용폭에 무축약으로 들어간다", () => {
    // 3줄 감기로 카드가 커졌다(168→232): 최장 단계명 "시너지·전략적 적합성"
    // ≈ 121px(@ fontSize 12)이 가용폭 208px에 무축약으로 들어간다. 서빙 데이터
    // 전부가 무축약(… 없음)이어야 한다 — 축약은 방어선이지 상태가 아니다
    // (2026-10-25 보고: 1줄 레이아웃에선 축약이 상태였다).
    const cap = G.NODE_W - 24;
    for (const s of SPEC_STAGES) {
      expect(approxTextWidth(stageDisplayName(s), 12), `${s.id} "${s.name}"`).toBeLessThanOrEqual(cap);
    }
    // 방어선: 축약 헬퍼가 이름 텍스트에 실제로 연결되어 있다.
    expect(graph).toContain("truncateToWidth(stageDisplayName(s), 12, NODE_W - 24)");
  });

  test("기하 머신체크 — 도트 행과 activityCount·트랙 배지가 카드 안에서 서로 겹치지 않는다", () => {
    // SpecStage.activities는 옵셔널(스펙 투영 타입) — 결측 단계는 0도트로 간주.
    const maxActs = Math.max(...SPEC_STAGES.map((s) => s.activities?.length ?? 0));
    // 도트: x+16 시작, 11.5px 피치, 링 반지름 6.5, 우측 여백 4 → 도트 행 끝.
    const dotsEnd = 16 + (maxActs - 1) * 11.5 + 6.5 + 4;
    const countW = approxTextWidth(`활동 ${Math.max(maxActs, 12)}`, 9.5); // 2자리 수 가정
    const countStart = G.NODE_W - 10 - countW; // 우측 end-정렬 라벨 시작점
    expect(dotsEnd, `최다 활동 ${maxActs}개 단계의 도트 행`).toBeLessThanOrEqual(countStart);
    // 헤더 행: 단계 id 좌측 vs 최장 배지(greenfield/brownfield 10자) 우측.
    const badgeW = 10 * 5.5 + 16;
    for (const s of SPEC_STAGES) {
      const idEnd = 12 + approxTextWidth(s.id, 12);
      expect(idEnd + 6, `${s.id} id vs 배지`).toBeLessThanOrEqual(G.NODE_W - badgeW - 10);
    }
  });

  test("마커 거터 라벨은 카드 하단 좌측(행 사이 여백)에 렌더된다 — 노드 우측 배치 금지(보고 회귀 핀)", () => {
    // 2026-10-23 보고: 노드 우측(x=pos.x+NODE_W+14) 라벨이 다음 카드 본문과 겹쳤다.
    expect(graph).toContain("x={pos.x} y={pos.y + NODE_H + 12 + i * 12}");
    expect(graph).not.toContain("x={pos.x + NODE_W + 14}");
    // 라벨 폭 상한(NODE_W−8)은 다음 열 카드 좌변에 12px 이상 못 미친다.
    expect(G.NODE_W - 8 + 12).toBeLessThanOrEqual(G.NODE_W + G.COL_GAP);
    // 원문 <title> 폴백 — 축약 시에도 전문을 접근 가능하다.
    expect(graph).toMatch(/<title>\{label\}<\/title>/);
  });

  test("범례는 행 단위 구조(제목/도트/도메인/마커)이고 마커 노트 목록은 id와 노트 사이에 구분자가 있다", () => {
    // 2026-10-23 보고: 범례 항목들이 한 줄로 뭉개졌고 노트가 "S2.xxx— kind: …"처럼
    // id에 바로 붙었다. 행 분리 + {" "} 구분자로 고정한다.
    expect(graph.match(/mt-1 flex flex-wrap items-center gap-x-3 gap-y-1/g)?.length).toBe(3);
    expect(graph).toContain('</code>{" "}');
    expect(graph).toContain('tg("markers.noteLine"');
  });
});
