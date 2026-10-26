// UI drivers for the human acts the E2E scenarios perform through the app:
// gate decisions, the S12 transition decision, and the closure modal.
import type { Locator, Page } from "./playwright.ts";
import type { TestApp } from "./harness.ts";
import { visit } from "./browser.ts";

export type GateDecision = "go" | "hold" | "kill";

/** The gate panel (`section[aria-label="의사결정"]`) that offers `gate` in its 진행 select (or the only panel on the page). */
export async function recordGate(
  page: Page,
  app: TestApp,
  path: string,
  gateLabel: string | null,
  decision: GateDecision,
  rationale: string,
  opts: { learning?: string; panelIndex?: number; gapRationale?: string } = {},
): Promise<void> {
  // S8's decision panel lives on its own "결정" tab (R2-B), not under every analysis tab.
  await visit(page, app, /\/business-case$/.test(path) ? `${path}?tab=decision` : path);
  const panels = await openGatePanels(page, opts.panelIndex ?? 0);
  const panel: Locator = panels.nth(opts.panelIndex ?? 0);
  await panel.scrollIntoViewIfNeeded();
  const form = panel.locator('form[aria-label="의사결정 기록"]');
  if (gateLabel) {
    const gateSelect = form.locator("select").first();
    if ((await form.locator("select").count()) > 1) await gateSelect.selectOption({ label: gateLabel });
  }
  await form.locator("select").last().selectOption(decision);
  await form.locator("input[required]").first().fill(rationale);
  if (decision === "kill") {
    await form.locator("textarea[required]").first().fill(opts.learning ?? "");
  }
  const responsePromise = page.waitForResponse((r) => /gate-decisions$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
  await form.locator('button[type="submit"]').last().click();
  // Shared gate-recording flow (R2-B): a confirm dialog first - or, for an IC GO with missing artifacts,
  // the warning dialog that requires a typed rationale. Nothing is sent before one of them is accepted.
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  if ((await dialog.getAttribute("aria-label")) === "누락 산출물 경고") {
    await dialog.locator("textarea").fill(opts.gapRationale ?? "E2E: 누락 산출물을 인지하고 예외로 GO를 기록함");
    await dialog.getByRole("button", { name: "그래도 GO 기록" }).click();
  } else {
    await dialog.getByRole("button", { name: "기록", exact: true }).click();
  }
  const res = await responsePromise;
  if (res.status() !== 201) throw new Error(`gate decision POST returned ${res.status()}: ${await res.text()}`);
}

/**
 * The gate decision panels of the current screen, with panel `index` open and visible: mounts the screen's own
 * "의사결정"/"결정" tab when the panel is not in the DOM, and reveals a hidden tab panel that holds it.
 */
export async function openGatePanels(page: Page, index = 0): Promise<Locator> {
  const panels = page.locator('section[aria-label="의사결정"]');
  const mounted = await panels.first().waitFor({ state: "attached", timeout: 8_000 }).then(() => true, () => false);
  if (!mounted) {
    await page.getByRole("tab", { name: /^(의사결정|결정)$/ }).filter({ visible: true }).first().click();
    await panels.first().waitFor({ state: "attached", timeout: 30_000 });
  }
  await revealTab(page, panels.nth(index));
  await panels.nth(index).waitFor({ state: "visible", timeout: 30_000 });
  return panels;
}

/**
 * Open the tab that owns `target` when it sits inside a hidden `[role=tabpanel]` (stage screens keep every
 * panel mounted and toggle `hidden`). Clicks the tab named by the panel's `aria-labelledby`.
 */
export async function revealTab(page: Page, target: Locator): Promise<void> {
  const tabId = await target.first().evaluate((el) => {
    const panel = el.closest("[role=tabpanel][hidden]");
    return panel?.getAttribute("aria-labelledby") ?? null;
  });
  if (tabId) await page.locator(`[id="${tabId}"]`).first().click();
}

/** S12 transition form on /projects/{id}/portfolio. `record` is the dedicated ADR-0151 column value. */
export async function recordTransition(
  page: Page,
  app: TestApp,
  projectId: string,
  decision: "next_tranche_released" | "held_evidence_incomplete" | "graduate_to_core" | "reduce_or_divest" | "kill_with_learning_captured",
  rationale: string,
  extra: { record?: string; learning?: string },
): Promise<void> {
  await visit(page, app, `/projects/${projectId}/portfolio`);
  const form = page.locator('form[aria-label="전환 결정 기록"]');
  await form.waitFor({ state: "visible", timeout: 30_000 });
  await form.scrollIntoViewIfNeeded();
  await form.locator("select").selectOption(decision);
  await form.getByPlaceholder("투자심의 근거").fill(rationale);
  if (extra.learning) await form.getByPlaceholder("플레이북으로 회수할 학습 내용").fill(extra.learning);
  if (extra.record) await form.locator("input.sizing-new-input").last().fill(extra.record);
  await form.locator('button[type="submit"]').click();
  // P4 confirm dialog (useConfirm) — the explicit human confirmation.
  const responsePromise = page.waitForResponse((r) => /transition-decision$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  const res = await responsePromise;
  if (res.status() >= 300) throw new Error(`transition POST returned ${res.status()}: ${await res.text()}`);
}

export type ClosureTypeLabel = "게이트 KILL로 종료" | "철회" | "핵심사업 편입" | "매각/청산" | "중단(학습 포착)" | "제외";

/** Open the closure modal from the S12 header action and submit. Returns the dialog for axe scans before submit when `beforeSubmit` is provided. */
export async function closeProjectViaModal(
  page: Page,
  app: TestApp,
  projectId: string,
  type: ClosureTypeLabel,
  reason: string,
  opts: { learning?: string; beforeSubmit?: (page: Page) => Promise<void> } = {},
): Promise<void> {
  await visit(page, app, `/projects/${projectId}/portfolio`);
  await page.getByRole("button", { name: /프로젝트 종료…/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  await dialog.getByText("전제조건을 확인하는 중").waitFor({ state: "detached", timeout: 20_000 }).catch(() => undefined);
  await dialog.getByRole("radio", { name: new RegExp(type.replace(/[()]/g, "\\$&")) }).check();
  const [reasonBox, learningBox] = [dialog.locator("textarea").nth(0), dialog.locator("textarea").nth(1)];
  await reasonBox.fill(reason);
  if (opts.learning) await learningBox.fill(opts.learning);
  if (opts.beforeSubmit) await opts.beforeSubmit(page);
  const responsePromise = page.waitForResponse((r) => /\/close$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "프로젝트 종료", exact: true }).click();
  const res = await responsePromise;
  if (res.status() >= 300) throw new Error(`close POST returned ${res.status()}: ${await res.text()}`);
}

/** Playwright-style visibility assertion for bun:test (no expect matchers for locators). */
export async function see(page: Page, text: string | RegExp, timeout = 20_000): Promise<void> {
  const visible = page.getByText(text).filter({ visible: true }).first();
  const any = page.getByText(text).first();
  await any.waitFor({ state: "attached", timeout }).catch(() => undefined);
  // Reveal the owning tab when every match sits inside a hidden tab panel.
  if (!(await visible.isVisible().catch(() => false))) await revealTab(page, any).catch(() => undefined);
  await visible.waitFor({ state: "visible", timeout });
}

export async function seeNot(page: Page, text: string | RegExp, timeout = 5_000): Promise<void> {
  await page.getByText(text).first().waitFor({ state: "detached", timeout }).catch(async () => {
    if (await page.getByText(text).first().isVisible()) throw new Error(`unexpected text still visible: ${String(text)}`);
  });
}
