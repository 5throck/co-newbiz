// @version 1.0.0
// 드라이런 실험 레인 화면(2026-10-24-flow-console-screen-design §6·§7, Row 6) —
// 순수 뷰 헬퍼 단위 테스트 + 화면 소스의 a11y·상호작용·경계 규약 정적 검사.
// 비용 확인 선행(§6.2), 선호 3상(§13-5), 제안 전용 칩(경계 #2), 내보내기 와이어링,
// 세션 스코프 경계(§12-3/4 — 저장소 쓰기 경로 0)를 화면 소스 수준에서 단언한다.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DRY_RUN_DISCLOSURE,
  DRY_RUN_MAX_TOKENS_UI,
  dryRunGroupOf,
  estimateFromLedger,
  expiryChip,
  fmtUsd,
  gradeFromPreference,
  lineDiffSummary,
  preferenceLabel,
  sessionStatusChip,
  sourceChip,
  type DryRunLedger,
  type LlmCallRow,
} from "../../app/web-next/app/flows/flows-view-lib.ts";

const DRY_RUN_DIR = join(import.meta.dirname, "../../app/web-next/app/flows/dry-run");
const FLOWS_DIR = join(import.meta.dirname, "../../app/web-next/app/flows");

const ledger = (over: Partial<DryRunLedger> = {}): DryRunLedger => ({ runs: 2, llmCalls: 2, costUsd: 0.02, lastRunAt: "2026-10-24T09:00:00Z", ...over });

describe("dry-run-view-lib — 세션 상태·등급·출처 칩 (A5: 색 단독 금지)", () => {
  test("세션 상태는 편집 중/완료로 렌더한다(§6.1 상태 칩 어휘)", () => {
    expect(sessionStatusChip("active")).toEqual({ label: "편집 중", cls: "status-chip status-in-progress" });
    expect(sessionStatusChip("closed")).toEqual({ label: "완료", cls: "status-chip status-approved" });
    expect(sessionStatusChip("expired").cls).toContain("status-chip");
  });
  test("등급 필은 선호 방향에서 유도된다(벤치 A3-2 — 개선/악화/동률/미판정, 색+텍스트)", () => {
    expect(gradeFromPreference("override")).toEqual({ label: "개선", cls: "status-chip status-approved" });
    expect(gradeFromPreference("base")).toEqual({ label: "악화", cls: "status-chip status-rejected" });
    expect(gradeFromPreference("tie").label).toBe("동률");
    expect(gradeFromPreference(null).label).toBe("미판정");
  });
  test("다리 출처는 AI/결정론 텍스트 병기 칩이다", () => {
    expect(sourceChip("llm").label).toBe("AI");
    expect(sourceChip("synthesis").label).toBe("결정론");
    expect(sourceChip(null).label).toBe("결정론");
  });
  test("세션 목록의 선호 라벨은 3상 + 미기록 — 구분선", () => {
    expect(preferenceLabel("base")).toBe("base 선호");
    expect(preferenceLabel("override")).toBe("override 선호");
    expect(preferenceLabel("tie")).toBe("동률");
    expect(preferenceLabel(null)).toBe("—");
  });
});

describe("dry-run-view-lib — 만료 칩(§13-3)과 비용 추정(§6.2)", () => {
  const NOW = Date.parse("2026-10-24T09:00:00Z");
  test("만료 72시간 이내에서만 '만료 예정' 칩이 나온다(§6.8 TTL 14일)", () => {
    expect(expiryChip("2026-10-25T21:00:00Z", NOW)?.label).toBe("만료 예정"); // 36h 남음
    expect(expiryChip("2026-10-26T09:00:00Z", NOW)?.label).toBe("만료 예정"); // 48h
    expect(expiryChip("2026-10-28T09:00:00Z", NOW)).toBeNull(); // 96h — 여유
    expect(expiryChip("2026-10-23T09:00:00Z", NOW)?.label).toBe("만료됨"); // 지난 세션
    expect(expiryChip(null, NOW)).toBeNull();
    expect(expiryChip("not-a-date", NOW)).toBeNull();
  });
  test("비용 추정은 세션 누계 장부에서 유도 — 실측 있으면 measured, 없으면 unknown", () => {
    const measured = estimateFromLedger(ledger({ llmCalls: 4, costUsd: 0.04 }));
    expect(measured.basis).toBe("measured");
    expect(measured.costUsd).toBeCloseTo(0.01);
    expect(measured.note).toContain("실측");
    const unknown = estimateFromLedger(ledger({ llmCalls: 0, costUsd: null }));
    expect(unknown.basis).toBe("unknown");
    expect(unknown.costUsd).toBeNull();
    expect(unknown.note).toContain("1,500"); // fmtInt(DRY_RUN_MAX_TOKENS_UI) — 토큰 상한 안내
  });
  test("비용 확인 문구 상수는 execute 응답 meta.note와 동일 문장을 유지한다(§6.2)", () => {
    expect(DRY_RUN_DISCLOSURE).toContain("is_dry_run");
    expect(DRY_RUN_DISCLOSURE).toContain("운영 대시보드 기본 집계에서 제외");
    // lib/dry-run.ts DRY_RUN_MAX_TOKENS 사본 드리프트 감지용 하한(§6.6 토큰 상한).
    expect(DRY_RUN_MAX_TOKENS_UI).toBe(1500);
  });
  test("fmtUsd는 미측정을 — 로 표시한다(0과 구분)", () => {
    expect(fmtUsd(null)).toBe("—");
    expect(fmtUsd(0)).toBe("$0");
  });
});

describe("dry-run-view-lib — diff 요약과 드라이런 행 판별", () => {
  test("lineDiffSummary는 multiset 라인 비교로 +/− 줄 수를 계산한다", () => {
    expect(lineDiffSummary("a\nb\nc", "a\nb\nc")).toEqual({ added: 0, removed: 0 });
    expect(lineDiffSummary("a\nb", "a\nb\nNEW")).toEqual({ added: 1, removed: 0 });
    expect(lineDiffSummary("a\nb\nb", "a\nb")).toEqual({ added: 0, removed: 1 });
  });
  test("dryRunGroupOf는 is_dry_run=1 + 그룹 id가 있을 때만 세션 키를 돌려준다", () => {
    const row = (over: Partial<LlmCallRow> = {}) => ({ is_dry_run: 1, dry_run_group_id: "dr_1", ...over }) as LlmCallRow;
    expect(dryRunGroupOf(row())).toBe("dr_1");
    expect(dryRunGroupOf(row({ is_dry_run: 0 }))).toBeNull();
    expect(dryRunGroupOf(row({ dry_run_group_id: null }))).toBeNull();
    expect(dryRunGroupOf({} as LlmCallRow)).toBeNull(); // includeDryRun 미조회 행
  });
});

describe("드라이런 화면 소스 — a11y·상호작용·경계 규약 (화면 설계 §9·§6)", () => {
  const sessionPage = readFileSync(join(DRY_RUN_DIR, "[sessionId]/page.tsx"), "utf8");
  const listPage = readFileSync(join(DRY_RUN_DIR, "page.tsx"), "utf8");
  const suggestionPanel = readFileSync(join(DRY_RUN_DIR, "suggestion-panel.tsx"), "utf8");
  const blueprint = readFileSync(join(FLOWS_DIR, "blueprint-view.tsx"), "utf8");
  const ledgerView = readFileSync(join(FLOWS_DIR, "ledger-view.tsx"), "utf8");
  const flowsPage = readFileSync(join(FLOWS_DIR, "page.tsx"), "utf8");

  test("A3 — 모든 표가 table-scroll region + sr-only caption + th scope=col 규약을 따른다", () => {
    for (const [name, src] of [["session", sessionPage], ["list", listPage]] as const) {
      if ((src.split("table-scroll").length - 1) > 0) {
        expect(src, `${name} table-scroll role`).toContain('role="region"');
        expect(src, `${name} table-scroll aria-label`).toContain('aria-label="데이터 표 (가로 스크롤)"');
        expect(src, `${name} table-scroll tabIndex`).toContain("tabIndex={0}");
        expect(src, `${name} sr-only caption`).toContain('className="sr-only"');
      }
    }
  });

  test("§6.2 — 드라이런 실행은 반드시 비용 확인 대화상자를 통과한다(ADR-0082)", () => {
    expect(sessionPage).toContain("useConfirm");
    expect(sessionPage).toContain("ConfirmDialog");
    expect(sessionPage).toContain('"드라이런 실행 — 비용 확인"');
    expect(sessionPage).toContain("estimateFromLedger");
    expect(sessionPage).toContain("DRY_RUN_DISCLOSURE");
    // 상호작용 순서 보초 — askExecute가 confirm을 부르고 doExecute만 POST한다.
    const confirmIdx = sessionPage.indexOf('confirm(\n      "드라이런 실행 — 비용 확인"');
    const doExecuteIdx = sessionPage.indexOf("api.post<DryRunExecutePayload>");
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(doExecuteIdx).toBeGreaterThan(confirmIdx);
    // LLM 미구성·오버라이드 없음은 실행 버튼이 사유 텍스트와 함께 막힌다(§6.2/§10).
    expect(sessionPage).toContain("LLM이 구성되지 않아 드라이런을 실행할 수 없습니다");
    expect(sessionPage).toContain("오버라이드가 없는 실행은 base와 동일합니다");
  });

  test("§6.1 — 오버라이드 편집기는 로스터 한정 select + SSOT 비반영 상시 문구를 가진다", () => {
    expect(sessionPage).toContain("에이전트 재배정 (로스터 한정");
    expect(sessionPage).toContain("미변경");
    expect(sessionPage).toContain("SSOT(prompts.json·flow.spec.yaml)에는 반영되지 않");
    expect(sessionPage).toContain("base_system");
  });

  test("§13-5 — 선호 기록은 3상(base/override/tie) + 비고 1줄 UI다", () => {
    expect(sessionPage).toContain('aria-label="선호 기록 (base/override/tie 3상 + 비고)"');
    expect(sessionPage).toContain("base 선호");
    expect(sessionPage).toContain("override 선호");
    expect(sessionPage).toContain("동률");
    expect(sessionPage).toContain("선호 기록");
    expect(sessionPage).toContain("실행 전에는 선호를 기록할 수 없습니다");
    // maxLength 500 — 서버 invalid_note 계약과 동일 상한.
    expect(sessionPage).toContain("maxLength={500}");
  });

  test("§6.6 (4) — 제안 패키지 내보내기가 브라우저 다운로드로 와이어링된다", () => {
    expect(sessionPage).toContain("/export");
    expect(sessionPage).toContain("createObjectURL");
    expect(sessionPage).toContain("a.download");
    expect(sessionPage).toContain("제안 패키지 내보내기");
    expect(sessionPage).toContain("저장소 PR");
  });

  test("§7 — 제안 패널은 제안 전용 칩·수용=오버라이드만·생성 불가 사유를 가진다(경계 #2)", () => {
    expect(suggestionPanel).toContain("제안 전용</span>");
    expect(suggestionPanel).toContain("제안 생성 불가");
    expect(suggestionPanel).toContain("오버라이드에 적용");
    expect(suggestionPanel).toContain("이 에이전트로 재배치");
    expect(suggestionPanel).toContain("영구 반영은 제안 패키지(저장소 PR)로만 가능합니다");
    // 수용은 폼 콜백만 부른다 — 저장소 쓰기(파일 시스템/PUT SSOT) 경로가 없다(§12-4).
    expect(suggestionPanel).not.toMatch(/writeFile|appendFile|fs\./);
    expect(suggestionPanel).toContain("onApplyOverride");
    expect(suggestionPanel).toContain("onApplyAgent");
  });

  test("§6.1 — 세션 헤더에 비용 누계 바와 만료 칩이 있다", () => {
    expect(sessionPage).toContain("세션 비용 누계");
    expect(sessionPage).toContain("expiryChip(session.expires_at)"); // 칩 어휘는 expiryChip 헬퍼에서 온다
    expect(sessionPage).toContain("TTL 만료");
    expect(sessionPage).toContain("제안 전용</span>");
  });

  test("§6.3 — 세션 목록은 mine 토글·빈 상태 시작 링크·만료 칩을 가진다", () => {
    expect(listPage).toContain("?mine=1");
    expect(listPage).toContain("내 세션");
    expect(listPage).toContain("드라이런 세션이 없습니다. 블루프린트에서 활동을 골라 시작하세요.");
    expect(listPage).toContain("만료");
    expect(listPage).toContain("purgedExpired");
    expect(listPage).toContain('aria-label="데이터 표 (가로 스크롤)"');
  });

  test("§2.2 — 블루프린트 진입점은 세션 생성 후 세션 화면으로 이동한다(준비 중 placeholder 제거)", () => {
    expect(blueprint).not.toContain("준비 중");
    expect(blueprint).toContain("드라이런 시작");
    expect(blueprint).toContain("/api/flows/dry-run/sessions");
    expect(blueprint).toContain("router.push(`/flows/dry-run/");
    // 동적 프롬프트는 v1 대상이 아님을 버튼이 아니라 이유 텍스트로 알린다(§6.10).
    expect(blueprint).toContain("v1 드라이런 대상이 아닙니다");
  });

  test("§5.3 — 런 레저 드라이런 행은 amber 칩 + 세션 딥링크를 가진다(벤치 B1-2 변형)", () => {
    expect(ledgerView).toContain('status-chip status-amber">드라이런');
    expect(ledgerView).toContain("/flows/dry-run/");
    expect(ledgerView).toContain("dryRunGroupOf");
  });

  test("§2.2 — /flows 탭 행에 드라이런 세션 목록 링크가 있다", () => {
    expect(flowsPage).toContain('href="/flows/dry-run"');
    expect(flowsPage).toContain("드라이런 세션 →");
  });

  test("A10 — 코드 키는 code 스타일, 문구는 한국어로 일관된다(발췌 검사)", () => {
    expect(sessionPage).toContain('className="dd-item-id"');
    expect(listPage).toContain("누적 비용");
  });
});
