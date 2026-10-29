// @version 1.0.0
// 드라이런 실험 레인 화면(2026-10-24-flow-console-screen-design §6·§7, Row 6) —
// 순수 뷰 헬퍼 단위 테스트 + 화면 소스의 a11y·상호작용·경계 규약 정적 검사.
// 비용 확인 선행(§6.2), 선호 3상(§13-5), 제안 전용 칩(경계 #2), 내보내기 와이어링,
// 세션 스코프 경계(§12-3/4 — 저장소 쓰기 경로 0)를 화면 소스 수준에서 단언한다.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DRY_RUN_DISCLOSURE_KEY,
  DRY_RUN_MAX_TOKENS_UI,
  dryRunGroupOf,
  estimateFromLedger,
  expiryChip,
  fmtUsd,
  gradeFromPreference,
  lineDiffSummary,
  preferenceLabelKey,
  sessionStatusChip,
  sourceChip,
  type DryRunLedger,
  type LlmCallRow,
} from "../../app/web-next/app/flows/flows-view-lib.ts";

const DRY_RUN_DIR = join(import.meta.dirname, "../../app/web-next/app/flows/dry-run");
const FLOWS_DIR = join(import.meta.dirname, "../../app/web-next/app/flows");
// i18n (design 2026-10-23-i18n-ui-adoption): wording pins assert the key call site
// in the component source and the ko master catalog value (the original Korean).
const koCatalog = await import("../../app/web-next/locales/ko.json");
const koOf = (key: string): string =>
  key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog) as string;

const ledger = (over: Partial<DryRunLedger> = {}): DryRunLedger => ({ runs: 2, llmCalls: 2, costUsd: 0.02, lastRunAt: "2026-10-24T09:00:00Z", ...over });

describe("dry-run-view-lib — 세션 상태·등급·출처 칩 (A5: 색 단독 금지; i18n 키 방출)", () => {
  test("세션 상태는 편집 중/완료로 렌더한다(§6.1 상태 칩 어휘) — catalog 키 방출", () => {
    expect(sessionStatusChip("active")).toEqual({ key: "pages.flows.chips.sessionEditing", label: "", cls: "status-chip status-in-progress" });
    expect(koOf("pages.flows.chips.sessionEditing")).toBe("편집 중");
    expect(sessionStatusChip("closed")).toEqual({ key: "pages.flows.chips.sessionDone", label: "", cls: "status-chip status-approved" });
    expect(koOf("pages.flows.chips.sessionDone")).toBe("완료");
    expect(sessionStatusChip("expired").cls).toContain("status-chip");
    expect(sessionStatusChip("expired")).toMatchObject({ key: null, label: "expired" });
  });
  test("등급 필은 선호 방향에서 유도된다(벤치 A3-2 — 개선/악화/동률/미판정, 색+텍스트)", () => {
    expect(gradeFromPreference("override")).toEqual({ key: "pages.flows.chips.gradeImproved", cls: "status-chip status-approved" });
    expect(koOf("pages.flows.chips.gradeImproved")).toBe("개선");
    expect(gradeFromPreference("base")).toEqual({ key: "pages.flows.chips.gradeRegressed", cls: "status-chip status-rejected" });
    expect(koOf("pages.flows.chips.gradeRegressed")).toBe("악화");
    expect(gradeFromPreference("tie").key).toBe("pages.flows.chips.gradeTie");
    expect(koOf("pages.flows.chips.gradeTie")).toBe("동률");
    expect(gradeFromPreference(null).key).toBe("pages.flows.chips.gradeUnjudged");
    expect(koOf("pages.flows.chips.gradeUnjudged")).toBe("미판정");
  });
  test("다리 출처는 AI/결정론 텍스트 병기 칩이다", () => {
    expect(sourceChip("llm")).toEqual({ key: "pages.flows.chips.sourceAi", cls: "status-chip status-in-progress" });
    expect(koOf("pages.flows.chips.sourceAi")).toBe("AI");
    expect(sourceChip("synthesis").key).toBe("pages.flows.chips.deterministic");
    expect(sourceChip(null).key).toBe("pages.flows.chips.deterministic");
  });
  test("세션 목록의 선호 라벨은 3상 + 미기록 — catalog 키 방출, 미기록 null", () => {
    expect(preferenceLabelKey("base")).toBe("pages.flows.chips.prefBase");
    expect(koOf("pages.flows.chips.prefBase")).toBe("기본(base) 선호"); // 2026-10-26 UX 리뷰 F9 — 도메인 용어 괄호 표기
    expect(preferenceLabelKey("override")).toBe("pages.flows.chips.prefOverride");
    expect(koOf("pages.flows.chips.prefOverride")).toBe("대체(override) 선호");
    expect(preferenceLabelKey("tie")).toBe("pages.flows.chips.prefTie");
    expect(koOf("pages.flows.chips.prefTie")).toBe("동률");
    expect(preferenceLabelKey(null)).toBeNull();
  });
});

describe("dry-run-view-lib — 만료 칩(§13-3)과 비용 추정(§6.2)", () => {
  const NOW = Date.parse("2026-10-24T09:00:00Z");
  test("만료 72시간 이내에서만 '만료 예정' 칩이 나온다(§6.8 TTL 14일) — 칩·title 모두 catalog 키 방출", () => {
    const soon = expiryChip("2026-10-25T21:00:00Z", NOW); // 36h 남음
    expect(soon?.key).toBe("pages.flows.chips.expiringSoon");
    expect(koOf("pages.flows.chips.expiringSoon")).toBe("만료 예정");
    expect(soon?.titleKey).toBe("pages.flows.chips.expiringSoonTitle");
    expect(koOf("pages.flows.chips.expiringSoonTitle")).toContain("TTL 만료 임박");
    expect(expiryChip("2026-10-26T09:00:00Z", NOW)?.key).toBe("pages.flows.chips.expiringSoon"); // 48h
    expect(expiryChip("2026-10-28T09:00:00Z", NOW)).toBeNull(); // 96h — 여유
    const done = expiryChip("2026-10-23T09:00:00Z", NOW); // 지난 세션
    expect(done?.key).toBe("pages.flows.chips.expired");
    expect(koOf("pages.flows.chips.expired")).toBe("만료됨");
    expect(done?.titleKey).toBe("pages.flows.chips.expiredTitle");
    expect(koOf("pages.flows.chips.expiredTitle")).toContain("세션 TTL이 만료되었습니다");
    expect(expiryChip(null, NOW)).toBeNull();
    expect(expiryChip("not-a-date", NOW)).toBeNull();
  });
  test("비용 추정은 세션 누계 장부에서 유도 — 실측 있으면 measured, 없으면 unknown(안내 문구는 키+params)", () => {
    const measured = estimateFromLedger(ledger({ llmCalls: 4, costUsd: 0.04 }));
    expect(measured.basis).toBe("measured");
    expect(measured.costUsd).toBeCloseTo(0.01);
    expect(measured.noteKey).toBe("pages.flows.chips.costMeasuredNote");
    expect(koOf("pages.flows.chips.costMeasuredNote")).toContain("실측");
    expect(measured.noteParams.p1).toBe("$0.04"); // 누계
    expect(measured.noteParams.p2).toBe("4"); // llm 호출 수
    expect(measured.noteParams.p3).toBe("$0.01"); // 회당
    const unknown = estimateFromLedger(ledger({ llmCalls: 0, costUsd: null }));
    expect(unknown.basis).toBe("unknown");
    expect(unknown.costUsd).toBeNull();
    expect(unknown.noteKey).toBe("pages.flows.chips.costUnknownNote");
    expect(unknown.noteParams.p1).toBe("1,500"); // fmtInt(DRY_RUN_MAX_TOKENS_UI) — 토큰 상한 안내
    expect(koOf("pages.flows.chips.costUnknownNote")).toContain("토큰 상한");
  });
  test("비용 확인 문구는 catalog 키로 방출되며 execute 응답 meta.note와 동일 문장을 유지한다(§6.2)", () => {
    expect(DRY_RUN_DISCLOSURE_KEY).toBe("pages.flows.dryRunSession.disclosure");
    // 2026-10-26 UX 개편 — 내부 플래그명(is_dry_run)은 보이는 문구에서 제거됐다.
    expect(koOf(DRY_RUN_DISCLOSURE_KEY)).not.toContain("is_dry_run");
    expect(koOf(DRY_RUN_DISCLOSURE_KEY)).toContain("운영 대시보드 기본 집계에서 제외");
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
        // i18n: the aria label resolves through pages.* catalog keys — key call site + ko value.
        const scrollKey = name === "session" ? "tableScrollRegion" : "sessionsTableScroll";
        expect(src, `${name} table-scroll aria-label key`).toContain(`aria-label={t("${scrollKey}")}`);
        expect(koOf(`pages.flows.dryRunSession.${scrollKey}`)).toBe("데이터 표 (가로 스크롤)");
        expect(src, `${name} table-scroll tabIndex`).toContain("tabIndex={0}");
        expect(src, `${name} sr-only caption`).toContain('className="sr-only"');
      }
    }
  });

  test("§6.2 — 드라이런 실행은 반드시 비용 확인 대화상자를 통과한다(ADR-0082)", () => {
    expect(sessionPage).toContain("useConfirm");
    // i18n: execute CTA/confirm title resolves through pages.flows.dryRunSession.executeConfirmTitle.
    expect(sessionPage).toContain('t("executeConfirmTitle")');
    expect(koOf("pages.flows.dryRunSession.executeConfirmTitle")).toBe("시험 실행 — 비용 확인");
    expect(sessionPage).toContain("estimateFromLedger");
    expect(sessionPage).toContain("DRY_RUN_DISCLOSURE");
    // 상호작용 순서 보초 — askRun이 confirm을 부르고, doRun은 dirty면 세션 생성(POST)→이동, 아니면 execute만. PATCH 없음.
    const confirmIdx = sessionPage.indexOf('confirm(\n      t("executeConfirmTitle")');
    const createIdx = sessionPage.indexOf('api.post<{ session: { id: string } }>("/api/flows/dry-run/sessions"');
    const pushIdx = sessionPage.indexOf("router.push(");
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(confirmIdx);
    expect(pushIdx).toBeGreaterThan(createIdx);
    expect(sessionPage).toContain("api.post<DryRunExecutePayload>");
    expect(sessionPage).not.toContain("api.patch");
    expect(sessionPage).not.toContain("patchBody");
    expect(sessionPage).toContain('t("createFailed")');
    expect(sessionPage).toContain('t("runAsNewCta")');
    expect(sessionPage).toContain('t("blockedClosed")');
    // LLM 미구성·오버라이드 없음은 실행 버튼이 사유 텍스트와 함께 막힌다(§6.2/§10).
    expect(sessionPage).toContain('t("blockedNoLlm")');
    expect(koOf("pages.flows.dryRunSession.blockedNoLlm")).toContain("LLM이 구성되지 않아 시험 실행을 할 수 없습니다");
    expect(sessionPage).toContain('t("blockedNoOverride")');
    expect(koOf("pages.flows.dryRunSession.blockedNoOverride")).toContain("기본(base)과 같은 내용은 실행할 수 없습니다"); // F9 도메인 용어 괄호 표기
  });

  test("§6.1 — 오버라이드 편집기는 로스터 한정 select + SSOT 비반영 상시 문구를 가진다", () => {
    expect(sessionPage).toContain('t("reassignLabel")');
    expect(koOf("pages.flows.dryRunSession.reassignLabel")).toContain("에이전트 재배정 (목록에 있는");
    expect(koOf("pages.flows.dryRunSession.unchanged")).toBe("(미변경)");
    // 제안 전용 경고는 화면당 단일 배너(2026-10-26 UX 개편 §4) — 내부 경로명 없이 한 문장.
    expect(koOf("pages.flows.dryRunSession.proposalOnlyBanner")).toContain("제안 전용");
    expect(sessionPage).toContain('t("proposalOnlyBanner")');
    expect(sessionPage).toContain("base_system");
  });

  test("§13-5 — 선호 기록은 3상(base/override/tie) + 비고 1줄 UI다", () => {
    expect(sessionPage).toContain('aria-label={t("prefGroup")}');
    expect(sessionPage).toContain('t("prefBase")');
    expect(koOf("pages.flows.dryRunSession.prefBase")).toBe("기본(base) 선호"); // F9 도메인 용어 괄호 표기
    expect(sessionPage).toContain('t("prefOverride")');
    expect(koOf("pages.flows.dryRunSession.prefOverride")).toBe("대체(override) 선호");
    expect(sessionPage).toContain('t("prefTie")');
    expect(koOf("pages.flows.dryRunSession.prefTie")).toBe("동률");
    expect(sessionPage).toContain('t("recordCta")');
    expect(koOf("pages.flows.dryRunSession.recordCta")).toBe("선호 기록");
    expect(sessionPage).toContain('t("prefBeforeExecute")');
    expect(koOf("pages.flows.dryRunSession.prefBeforeExecute")).toContain("실행 전에는 선호를 기록할 수 없습니다");
    // maxLength 500 — 서버 invalid_note 계약과 동일 상한.
    expect(sessionPage).toContain("maxLength={500}");
  });

  test("§6.6 (4) — 제안 패키지 내보내기가 브라우저 다운로드로 와이어링된다", () => {
    expect(sessionPage).toContain("/export");
    expect(sessionPage).toContain("createObjectURL");
    expect(sessionPage).toContain("a.download");
    expect(sessionPage).toContain('t("exportCta")');
    expect(koOf("pages.flows.dryRunSession.exportCta")).toBe("제안 패키지 내보내기");
  });

  test("§7 — 제안 패널은 수용=오버라이드만·생성 불가 사유를 가진다(경고는 세션 화면 단일 배너로 일원화)", () => {
    expect(suggestionPanel).not.toContain("proposalOnlyMeta");
    expect(suggestionPanel).not.toContain("proposalOnlyNote");
    expect(suggestionPanel).toContain('t("suggestUnavailableChip")');
    expect(koOf("pages.flows.dryRunSession.suggestUnavailableChip")).toBe("제안 생성 불가");
    expect(suggestionPanel).toContain('t("acceptOverrideCta")');
    expect(koOf("pages.flows.dryRunSession.acceptOverrideCta")).toContain("편집기에 적용");
    expect(suggestionPanel).toContain("CandidateChips");
    expect(suggestionPanel).toContain('t("discardCta")');
    expect(koOf("pages.flows.dryRunSession.discardCta")).toBe("버리기");
    // 수용은 폼 콜백만 부른다 — 저장소 쓰기(파일 시스템/PUT SSOT) 경로가 없다(§12-4).
    expect(suggestionPanel).not.toMatch(/writeFile|appendFile|fs\./);
    expect(suggestionPanel).toContain("onApplyPrompt");
    expect(suggestionPanel).toContain("onPick");
  });

  test("§6.1 — 세션 헤더에 비용 누계 바와 만료 칩이 있다", () => {
    expect(sessionPage).toContain('t("costTotal")');
    expect(koOf("pages.flows.dryRunSession.costTotal")).toBe("세션 비용 누계");
    expect(sessionPage).toContain("expiryChip(session.expires_at)"); // 칩 어휘는 expiryChip 헬퍼에서 온다
    // 2026-10-25 가독성 개편 — 인라인 blob(purposeLine)은 라벨:값 메타 그리드로 분해.
    // TTL 만료는 독립 라벨 키가 담당하고, 생성 메타는 createdValue(p1 시각 · by p2 작성자)다.
    expect(koOf("pages.flows.dryRunSession.labelExpiry")).toBe("TTL 만료");
    expect(sessionPage).toContain('t("labelExpiry")');
    expect(sessionPage).toContain('t("createdValue"');
    expect(koOf("pages.flows.dryRunSession.createdValue")).toContain("{p1}");
    expect(koOf("pages.flows.dryRunSession.createdValue")).toContain("{p2}");
    // 제안 전용 문구는 배너 1곳 — 배지 줄·부제·패키지 노트에는 더 이상 없다.
    expect(sessionPage).not.toContain("proposalOnlyChip");
    expect(sessionPage.split('t("proposalOnlyBanner")').length - 1).toBe(1);
  });

  test("가독성 개편 — 세션 id 잘라보기+복사, 실행 카드 상단 승격, 두 창 grid 레이아웃", () => {
    // 세션 id — 접힘 세션 정보 안에서 cell-truncate 잘라보기 + 클립보드 복사 버튼(긴 id 가독성).
    expect(sessionPage).toContain('<details className="dry-run-info');
    expect(sessionPage).toContain('cell-truncate"');
    expect(sessionPage).toContain('t("copySessionIdAria")');
    expect(koOf("pages.flows.dryRunSession.copySessionIdAria")).toContain("복사");
    expect(sessionPage).toContain("navigator.clipboard.writeText(session.id)");
    // 2026-10-26 개편 — 주 동작은 고정 요약 줄의 단일 PrimaryAction(상태별), 비용 추정은 실행·비교 탭.
    expect(sessionPage).toContain('t("runCardTitle")');
    expect(koOf("pages.flows.dryRunSession.runCardTitle")).toBe("시험 실행");
    expect(sessionPage).toContain('t("costEstimateLabel")');
    expect(sessionPage).toContain("dry-run-summary-bar");
    expect(sessionPage.split("<PrimaryAction").length - 1).toBe(1); // 화면당 주 동작 1개
    expect(sessionPage).toContain("primaryAction(runCount, dirty)");
    // 단일 페이지(2026-10-26b) — 탭 ARIA·해시 동기화·탭 키가 남지 않는다.
    expect(sessionPage).not.toContain('role="tablist"');
    expect(sessionPage).not.toContain("hashchange");
    expect(sessionPage).not.toContain('role="tab"');
    expect(koOf("pages.flows.dryRunSession.tabRun")).toBeUndefined();
  });

  test("가독성 개편 — diff 색 칩(녹색 추가/적색 삭제, 수치는 텍스트 병기)과 dirty 칩", () => {
    // diff +N/−M — 색이 단독 채널이 아니다: 추가=녹색 칩, 삭제=적색 칩, 칩 문구에 수치 포함.
    expect(sessionPage).toContain('"status-chip status-approved">{t("diffAdded"');
    expect(sessionPage).toContain('"status-chip status-rejected">{t("diffRemoved"');
    expect(koOf("pages.flows.dryRunSession.diffAdded")).toBe("+{p1}줄 추가");
    expect(koOf("pages.flows.dryRunSession.diffRemoved")).toBe("−{p1}줄 삭제");
    expect(koOf("pages.flows.dryRunSession.diffSame")).toBe("원본과 동일");
    // dirty 상태는 편집기 툴바(섹션 제목 옆)에 amber 칩으로 표시된다.
    expect(sessionPage).toContain('{t("dirtyChip")}</span>'); // 색 단독이 아니라 "저장 안 된 편집" 텍스트 라벨
    expect(sessionPage).toContain("status-chip status-amber");
    expect(koOf("pages.flows.dryRunSession.dirtyChip")).toBe("저장 안 된 편집");
  });

  test("가독성 개편 — 적용=새 세션 경고 콜아웃이 적용 컨트롤 옆에 있고, 실행 전 비교 창은 구조화된 빈 상태다", () => {
    // 고친 내용 실행 = 파생 세션 생성 후 이동(PATCH 없음), 안내는 dirtyNote 한 줄.
    expect(sessionPage).not.toContain("applyOverrideAsNewSession");
    expect(sessionPage).not.toContain("router.replace");
    expect(sessionPage).toContain('t("dirtyNote")');
    // 실행 전 A/B — base/override 두 라벨 패널 + 실행 안내(단일 이탤릭 문장 대체).
    expect(sessionPage).toContain('t("legBaseEmpty")');
    expect(koOf("pages.flows.dryRunSession.legBaseEmpty")).toContain("base");
    expect(sessionPage).toContain('t("legOverrideEmpty")');
    expect(sessionPage).toContain('t("notExecuted")');
    expect(koOf("pages.flows.dryRunSession.notExecuted")).toContain("시험 실행");
  });

  test("가독성 개편 — 실행 기록 표에 토큰 열이 있고(A10), 재배정 select와 제안 후보의 역할이 문맥화된다", () => {
    // 실행 기록은 접힌 disclosure — 실행별 에이전트 키·프롬프트 해시·비용·"현재" 표식(matchesCurrent).
    expect(sessionPage).toContain('t("runHistorySummary"');
    expect(sessionPage).toContain("run.matchesCurrent");
    expect(sessionPage).toContain('t("colPromptHash")');
    expect(koOf("pages.flows.dryRunSession.colPromptHash")).toBe("프롬프트 해시");
    expect(sessionPage).toContain("runCount"); // ledger.runs(실행당 2)가 아니라 runCount를 쓴다
    expect(sessionPage).not.toContain("ledger.runs");
    // 에디터 select = 이 세션의 실행 축 / 제안 후보 수용 = 그 select를 채우는 입력.
    expect(sessionPage).toContain('t("reassignContext")');
    expect(koOf("pages.flows.dryRunSession.reassignContext")).toContain("선택기");
    expect(suggestionPanel).toContain('t("candidatesContext")');
    expect(koOf("pages.flows.dryRunSession.candidatesContext")).toContain("선택기");
  });

  test("§6.3 — 세션 목록은 mine 토글·빈 상태 시작 링크·만료 칩을 가진다", () => {
    expect(listPage).toContain("?mine=1");
    expect(listPage).toContain('t("mySessions")');
    expect(koOf("pages.flows.dryRunSession.mySessions")).toBe("내 세션");
    expect(listPage).toContain('t("emptySessions")');
    expect(koOf("pages.flows.dryRunSession.emptySessions")).toBe("시험 실행 세션이 없습니다. 설계도에서 활동을 골라 시작하세요.");
    expect(koOf("pages.flows.dryRunSession.colExpiry")).toBe("만료");
    expect(listPage).toContain("purgedExpired");
    // 2026-10-26 개편 — 상태 칩(실제 상태값), 짧은 ID+복사, 작성자 열, 검색.
    expect(listPage).toContain("SESSION_STATUS_FILTERS");
    expect(listPage).toContain("shortId(s.id)");
    expect(listPage).toContain('t("colOwner")');
    expect(listPage).toContain('t("searchLabel")');
    expect(listPage).toContain('aria-label={t("sessionsTableScroll")}');
  });

  test("§2.2 — 블루프린트 진입점은 세션 생성 후 세션 화면으로 이동한다(준비 중 placeholder 제거)", () => {
    expect(blueprint).not.toContain("준비 중");
    expect(blueprint).toContain('t("dryRunStart")');
    expect(koOf("pages.flows.blueprint.dryRunStart")).toBe("시험 실행 시작");
    expect(blueprint).toContain("/api/flows/dry-run/sessions");
    expect(blueprint).toContain("router.push(`/flows/dry-run/");
    // 동적 프롬프트는 v1 대상이 아님을 버튼이 아니라 이유 텍스트로 알린다(§6.10).
    expect(blueprint).toContain('t("dynamicTitle")');
    expect(koOf("pages.flows.blueprint.dynamicTitle")).toContain("v1 시험 실행 대상이 아닙니다");
  });

  test("§5.3 — 런 레저 드라이런 행은 amber 칩 + 세션 딥링크를 가진다(벤치 B1-2 변형)", () => {
    expect(ledgerView).toContain('status-chip status-amber">{t("dryRunChip")}');
    expect(koOf("pages.flows.ledger.dryRunChip")).toBe("시험 실행");
    expect(ledgerView).toContain("/flows/dry-run/");
    expect(ledgerView).toContain("dryRunGroupOf");
  });

  test("§2.2 — /flows 탭 행에 드라이런 세션 목록 링크가 있다", () => {
    expect(flowsPage).toContain('href="/flows/dry-run"');
    expect(flowsPage).toContain('t("dryRunSessionsLink")');
    expect(koOf("pages.flows.flowsAdmin.dryRunSessionsLink")).toBe("시험 실행 세션 →");
  });

  test("A10 — 코드 키는 code 스타일, 문구는 한국어로 일관된다(발췌 검사)", () => {
    expect(sessionPage).toContain('className="dd-item-id"');
    expect(koOf("pages.flows.dryRunSession.colAccumCost")).toBe("누적 비용");
  });
});
