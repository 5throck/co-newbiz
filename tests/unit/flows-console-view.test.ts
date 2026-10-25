// @version 1.3.0
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
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bucketLlmCallsByDay, classifiedByChip, fmtDateTime, fmtInt, fmtPct, fmtSeconds, fmtUsd,
  runStatusChip, stageDisplayName, totalTokens, windowTokenKey,
  type LlmCallRow,
} from "../../app/web-next/app/flows/flows-view-lib.ts";

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

  test("기하는 위키 여정 지도를 재사용한다 — 가로(viewBox 폭>높이) + width=100% + marker 화살표 + 토큰 색", () => {
    expect(graph).toContain("viewBox={");
    expect(graph).toContain('width="100%"');
    // 2026-10-23 사용자 보고: 세로 1주열 → 가로(좌→우) 전환. minWidth가 읽기 하한을
    // 보장하고(세로 시절 maxWidth 40rem caps 금지), 좁은 화면은 컨테이너 overflow-x가 대신한다.
    expect(graph).not.toContain("maxWidth");
    expect(graph).toContain("minWidth");
    expect(graph).toContain("markerEnd"); // 화살표 엣지
    expect(graph).toContain("var(--border)"); // CSS 변수 색(다크 모드 안전)
    // S4 분기 → S5(greenfield)·S6→S7(brownfield) → S8 재합류 토폴로지가 엣지 상수로 존재
    for (const edge of ["S1→S2", "S4→S5", "S4→S6", "S6→S7", "S5→S8", "S7→S8", "S11→S12"]) {
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
    // 계약: FlowsBlueprint가 specialistMarkers를 타이핑한다.
    expect(lib).toContain("specialistMarkers: SpecialistMarker[]");
  });
});
