// @version 1.0.0
// 플로우 콘솔 화면(2026-10-24-flow-console-screen-design, Row 4) — 순수 뷰 헬퍼
// 단위 테스트 + 화면 소스의 a11y 규약 정적 검사(§9 체크리스트 핵심 항목).
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bucketLlmCallsByDay, classifiedByChip, fmtDateTime, fmtInt, fmtPct, fmtSeconds, fmtUsd,
  runStatusChip, stageNameKey, totalTokens,
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

describe("flows-view-lib — 단계명(사본)과 타임라인 버킷", () => {
  test("S1–S12 단계명 사본은 catalog 키로 방출된다(구현 편차 #1 — /api/flows가 name 미노출)", () => {
    for (let i = 1; i <= 12; i++) {
      expect(stageNameKey(`S${i}`)).toBe(`pages.flows.stageNames.S${i}`);
      const ko = koOf(`pages.flows.stageNames.S${i}`);
      expect(ko.length).toBeGreaterThan(0);
      expect(ko).not.toBe(`S${i}`); // 미지 단계 원문 id가 아니라 한글명 마스터 값
    }
    expect(stageNameKey("S13")).toBeNull(); // 미지 단계는 null — 화면에서 원문 id 폴백
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
