// @version 1.0.0
// ADR-0161 Row 3: pure view helpers for the S11 greenfield execution baseline panel, plus
// source-reading wiring checks (existing style: read the component sources, no DOM).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  EMPTY_ENTRIES, ENTRY_KINDS, ENTRY_SPECS, buildEntry, canAddEntry, canConfirm, confirmationView, cumulativeHeadcounts, emptyValues,
  entriesClearConfirmation, permitStepNote, baselineErrorText, reconciliationVerdict, requirementView, rowCells, validateRationale, valuesOf, withEntry,
  FINDING_LABEL_KEY, findingText, fmtMoney,
  type BaselineRecord, type TrancheReconciliationView,
} from "../../app/web-next/lib/execution-baseline-view.ts";

const W = "./app/web-next";
const src = (p: string) => readFileSync(`${W}/${p}`, "utf8");
// i18n (design 2026-10-23-i18n-ui-adoption): wording pins assert the key call site + the ko
// master catalog value (the original Korean wording, byte-identical to the pre-extraction lib).
const koCatalog = await import("../../app/web-next/locales/ko.json");
const koOf = (key: string): string =>
  key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog) as string;
const ko = (m: { key: string | null; text: string | null }): string => (m.key ? koOf(m.key) : m.text ?? "");

const rec = (over: Partial<TrancheReconciliationView> = {}): TrancheReconciliationView => ({
  tranches: [], tranche_total: 100, tranche_currencies: ["KRW"], case: { model_id: "m", capex_total_krw_m: 100, capex_lines: 1, unit_issue: false },
  s10_structure_recorded: true, difference: 0, matches: true, findings: [], ...over,
});
const record = (confirmed: boolean): BaselineRecord => ({
  id: "r1", recorded_by: "u1", recorded_at: "2026-10-12T00:00:00Z", entries: EMPTY_ENTRIES,
  confirmation: confirmed ? { confirmed_by: "u2", confirmed_at: "2026-10-13T00:00:00Z", rationale: "ok", tranche_ids: [], tranche_hash: "h", open_findings: [] } : null,
});

describe("requirement / retroactive messaging", () => {
  test("recommended reads non-blocking, blocking reads blocking until confirmed (ko master values)", () => {
    expect(ko(requirementView("recommended").text)).toContain("차단하지 않");
    expect(ko(requirementView("recommended").chip)).toContain("권장");
    expect(ko(requirementView("blocking").text)).toContain("확인할 때까지");
    expect(ko(requirementView("blocking").chip)).toContain("차단");
    expect(ko(requirementView("satisfied").chip)).toContain("확인됨");
  });
  test("status is never colour only: every chip carries an icon and text", () => {
    for (const r of ["satisfied", "blocking", "recommended", "needs_classification", "not_applicable"] as const) {
      expect(ko(requirementView(r).chip)).toMatch(/^[●○▲] .+/);
    }
  });
});

describe("confirmation chip", () => {
  test("unconfirmed vs confirmed with who and when (ko master values)", () => {
    expect(ko(confirmationView(null, []).chip)).toBe("○ 미확정");
    const c = confirmationView(record(true), []);
    expect(ko(c.chip)).toBe("● 확정됨");
    expect(c.detail).toBe("u2 · 2026-10-13");
  });
  test("changed tranches after confirmation downgrade the chip and flag it", () => {
    const c = confirmationView(record(true), [{ code: "tranches_changed_since_confirmation", message: "x" }]);
    expect(c.tranchesChanged).toBe(true);
    expect(ko(c.chip)).toContain("트랜치 변경");
    expect(c.cls).toBe("status-amber");
  });
  test("new entries clear an earlier confirmation notice only when one exists", () => {
    expect(entriesClearConfirmation(record(true))).toBe(true);
    expect(entriesClearConfirmation(record(false))).toBe(false);
    expect(entriesClearConfirmation(null)).toBe(false);
  });
});

describe("tranche reconciliation verdict (exact match, never a pass on a difference)", () => {
  test("exact match only (ko master value)", () => {
    expect(ko(reconciliationVerdict(rec()).chip)).toContain("정확히 일치");
  });
  test("a difference is shown as a finding with the amount, not a pass", () => {
    const v = reconciliationVerdict(rec({ matches: false, difference: 5 }));
    expect(v.cls).toBe("status-amber");
    expect(ko(v.chip)).toContain("불일치");
    expect(v.chip.params.p1).toBe(fmtMoney(5)); // the amount is a param of the chip key
    expect(ko(v.text)).toContain("자동으로 통과되지 않습니다");
  });
  test("unknown difference is not comparable, not a pass", () => {
    const v = reconciliationVerdict(rec({ difference: null, matches: false }));
    expect(v.cls).toBe("status-not-started");
    expect(ko(v.chip)).toContain("대조 불가");
  });
});

describe("entry forms mirror the server limits", () => {
  test("every kind has four headers and a spec", () => {
    for (const k of ENTRY_KINDS) {
      expect(ENTRY_SPECS[k].headers).toHaveLength(4);
      expect(ENTRY_SPECS[k].fields.length).toBeGreaterThan(0);
    }
  });
  test("permit and certification are separate kinds with separate titles", () => {
    expect(ko(ENTRY_SPECS.permit_milestones.title)).not.toBe(ko(ENTRY_SPECS.certification_milestones.title));
    expect(ENTRY_KINDS.indexOf("permit_milestones")).not.toBe(ENTRY_KINDS.indexOf("certification_milestones"));
  });
  test("milestone: required fields, date format, length limit", () => {
    const base = { name: "공장 건축허가", issuer: "시청", target_date: "2027-03-01", gates_ref: "", source_id: "" };
    expect(buildEntry("permit_milestones", base)).toEqual({ ok: true, value: { name: "공장 건축허가", issuer: "시청", target_date: "2027-03-01", gates_ref: null, source_id: null } });
    expect(buildEntry("permit_milestones", { ...base, name: "" }).ok).toBe(false);
    expect(buildEntry("permit_milestones", { ...base, target_date: "2027-13-01" }).ok).toBe(false);
    const long = buildEntry("certification_milestones", { ...base, name: "가".repeat(201) });
    expect(long.ok).toBe(false);
    // i18n: structured error — the panel composes errMaxLength with the field's catalog label.
    if (!long.ok) expect(long.error).toEqual({ kind: "maxLength", field: "name", max: 200 });
    if (!long.ok) expect(koOf("stages.s11.executionBaseline.errMaxLength")).toContain("자 이하여야");
  });
  test("hiring plan is aggregate only: quarter format and integer headcount", () => {
    expect(buildEntry("hiring_plan", { role_family: "생산", quarter: "2027-Q2", headcount: "12" })).toEqual({ ok: true, value: { role_family: "생산", quarter: "2027-Q2", headcount: 12 } });
    expect(buildEntry("hiring_plan", { role_family: "생산", quarter: "2027-5", headcount: "12" }).ok).toBe(false);
    expect(buildEntry("hiring_plan", { role_family: "생산", quarter: "2027-Q2", headcount: "1.5" }).ok).toBe(false);
    expect(buildEntry("hiring_plan", { role_family: "생산", quarter: "2027-Q2", headcount: "-1" }).ok).toBe(false);
    expect(ENTRY_SPECS.hiring_plan.fields.map((f) => f.key)).toEqual(["role_family", "quarter", "headcount"]);
    expect(cumulativeHeadcounts([{ role_family: "a", quarter: "2027-Q1", headcount: 3 }, { role_family: "b", quarter: "2027-Q2", headcount: 4 }])).toEqual([3, 7]);
  });
  test("kpi target: metric key shape (goal: prefix allowed), finite value, due format", () => {
    expect(buildEntry("kpi_targets", { metric_key: "goal:revenue", target_value: "10.5", unit: "", due: "2028-Q1" }).ok).toBe(true);
    expect(buildEntry("kpi_targets", { metric_key: "Revenue", target_value: "10", unit: "", due: "2028-Q1" }).ok).toBe(false);
    expect(buildEntry("kpi_targets", { metric_key: "revenue", target_value: "", unit: "", due: "2028-Q1" }).ok).toBe(false);
    expect(buildEntry("kpi_targets", { metric_key: "revenue", target_value: "10", unit: "", due: "내년" }).ok).toBe(false);
  });
  test("incentive obligation: text required, deadline optional but dated", () => {
    expect(buildEntry("incentive_obligations", { obligation: "고용 50명 유지", deadline: "", depends_on: "", incentive_id: "" }).ok).toBe(true);
    expect(buildEntry("incentive_obligations", { obligation: "x", deadline: "soon", depends_on: "", incentive_id: "" }).ok).toBe(false);
    expect(buildEntry("incentive_obligations", { obligation: "가".repeat(1001), deadline: "", depends_on: "", incentive_id: "" }).ok).toBe(false);
  });
  test("withEntry add / replace / remove returns new lists and never mutates", () => {
    const a = withEntry(EMPTY_ENTRIES, "hiring_plan", null, { role_family: "a", quarter: "2027-Q1", headcount: 1 });
    expect(EMPTY_ENTRIES.hiring_plan).toHaveLength(0);
    expect(a.hiring_plan).toHaveLength(1);
    const b = withEntry(a, "hiring_plan", 0, { role_family: "b", quarter: "2027-Q1", headcount: 2 });
    expect(b.hiring_plan[0].role_family).toBe("b");
    expect(withEntry(b, "hiring_plan", 0, null).hiring_plan).toHaveLength(0);
    expect(canAddEntry(EMPTY_ENTRIES, "hiring_plan")).toBe(true);
  });
  test("valuesOf round-trips a row into form values and emptyValues covers all fields", () => {
    expect(valuesOf("kpi_targets", { metric_key: "a", target_value: 3, unit: null, due: "2028-Q1" })).toEqual({ metric_key: "a", target_value: "3", unit: "", due: "2028-Q1" });
    expect(Object.keys(emptyValues("permit_milestones"))).toEqual(ENTRY_SPECS.permit_milestones.fields.map((f) => f.key));
    expect(rowCells("hiring_plan", { role_family: "a", quarter: "2027-Q1", headcount: 3 }, { cumulativeHeadcount: 3 })).toEqual(["a", "2027-Q1", "3", "3"]);
  });
});

describe("confirmation form and messages", () => {
  test("rationale is required and limited to 2000 characters", () => {
    expect(ko(validateRationale("   ")!)).toContain("입력");
    expect(validateRationale("가".repeat(2001))!.params.p1).toBe("2000");
    expect(validateRationale("근거")).toBeNull();
    expect(canConfirm(false, "근거").allowed).toBe(false);
    expect(canConfirm(true, "").allowed).toBe(false);
    expect(canConfirm(true, "근거").allowed).toBe(true);
  });
  test("server messages win, codes fill the gaps, no raw English fallback", () => {
    expect(baselineErrorText("invalid_request", "목표일은 YYYY-MM-DD 날짜여야 합니다.")).toEqual({ key: null, params: {}, text: "목표일은 YYYY-MM-DD 날짜여야 합니다." }); // server message passthrough (data)
    expect(ko(baselineErrorText("not_applicable_track", undefined))).toContain("PMI");
    expect(ko(baselineErrorText(undefined, undefined))).toBe("기록하지 못했습니다.");
  });
  test("intra_venture permit note appears only when the permit step does not apply", () => {
    expect(permitStepNote(true)).toBeNull();
    expect(ko(permitStepNote(false)!)).toContain("사내벤처");
  });
});

describe("component wiring (source checks)", () => {
  const panel = src("components/stages/ExecutionBaselinePanel.tsx");
  const ic = src("components/stages/IcReviewStage.tsx");
  test("S11 mounts the panel; brownfield/needs_classification branches render no form", () => {
    expect(ic).toContain("<ExecutionBaselinePanel projectId={projectId} canAct={canAct} />");
    // 2026-10-21 decider: the panel owns a dedicated S11 tab, so not_applicable renders an
    // informational notice (never silent null, never a form); loading stays a bare status line.
    expect(panel).toContain('status.applicability.state === "not_applicable"');
    expect(panel).toContain('data-testid="gx-not-applicable"');
    expect(panel).toContain('적용 대상 아님');
    const na = panel.slice(panel.indexOf('state === "not_applicable"'), panel.indexOf('if (status.requirement === "classification_conflict")'));
    expect(na).not.toContain("<form");
    const nc = panel.slice(panel.indexOf('state === "needs_classification"'), panel.indexOf("const rec = status.reconciliation"));
    expect(nc).not.toContain("<form");
    expect(nc).toContain("NEEDS_CLASSIFICATION_KEY");
  });
  test("posts record_entries and confirm, links to the S10 capex tab, never writes tranches", () => {
    expect(panel).toContain('action: "record_entries"');
    expect(panel).toContain('action: "confirm"');
    expect(panel).toContain("deal-structure?tab=capex");
    expect(panel).not.toContain("capex-tranches");
  });
  test("uses the shared table system, aria-live, and a single non-primary confirm button", () => {
    expect(panel).toContain("table-fixed-pct");
    expect(panel).toContain("<ColGroup");
    expect(panel).toContain('aria-live="polite"');
    expect(panel).not.toContain("btn-primary");
    expect(panel).not.toContain("<PrimaryAction");
  });
  test("goals are reference evidence only, never a pass/fail", () => {
    expect(panel).toContain('t("referenceEvidenceS8BusinessGoals")'); // i18n: stages.s11.executionBaseline.*
    expect(panel).toContain('t("aReferenceValueForSetting")');
  });
});

describe("ADR-0161 review-fix wiring (source checks)", () => {
  test("policy-migration panel: shared lead hook, hash display, insider gate", () => {
    const panel = src("components/stages/PolicyMigrationPanel.tsx");
    expect(panel).toContain('useIsProjectLead');
    expect(panel).toContain("pm-migration-hash");
    expect(panel).toContain("migration_note_hash");
    expect(panel).toContain("INSIDER_REQUIRED_KEY");
  });
  test("post-management panel GET maps insider_required through baselineErrorText", () => {
    const panel = src("components/stages/PostManagementPanel.tsx");
    expect(panel).toContain('baselineErrorText((e as { code?: string } | null)?.code');
    expect(panel).toContain('from "../../lib/execution-baseline-view.ts"');
  });
  test("baseline panel: lead-only gating, findings dialog, ack payload, withheld rows, conflict no-form", () => {
    const panel = src("components/stages/ExecutionBaselinePanel.tsx");
    expect(panel).toContain("gx-lead-only");
    expect(panel).toContain("LEAD_ONLY_KEY");
    expect(panel).toContain("canAct && isLead");
    expect(panel).toContain("BaselineConfirmDialog");
    expect(panel).toContain("acknowledged_findings");
    expect(panel).toContain("gx-classification-conflict");
    // Withheld tranche rows render excluded and the total label says so.
    expect(panel).toContain("isExcludedTranche");
    expect(panel).toContain("EXCLUDED_TRANCHE_KEY");
    expect(panel).toContain('t("trancheTotalHoldRowsExcluded")');
  });
  test("dialog requires a per-finding rationale and builds the ack payload", () => {
    const dialog = src("components/stages/BaselineConfirmDialog.tsx");
    expect(dialog).toContain("buildAcknowledgements");
    expect(dialog).toContain("acknowledged_findings");
    expect(dialog).toContain("MAX_ACK_RATIONALE_LEN");
  });
  test("shared lead hook reads the same source as the closure button", () => {
    const hook = src("components/stages/useIsProjectLead.ts");
    expect(hook).toContain("/api/projects?status=all");
    expect(hook).toContain("is_lead === true");
  });
});

describe("findingText / fmtMoney (display only)", () => {
  test("known codes emit their catalog key (never the raw backend message)", () => {
    for (const code of Object.keys(FINDING_LABEL_KEY)) {
      expect(findingText({ code, message: "RAW backend message (planned·released)" })).toEqual({ key: FINDING_LABEL_KEY[code], params: {}, text: null });
      expect(koOf(FINDING_LABEL_KEY[code]).length).toBeGreaterThan(0);
    }
  });
  test("unknown codes fall back to the message (data passthrough)", () => {
    expect(findingText({ code: "zzz_unknown", message: "raw" })).toEqual({ key: null, params: {}, text: "raw" });
  });
  test("KRW: separators, at most 1 decimal; others at most 2", () => {
    expect(fmtMoney(10030.133473)).toBe("10,030.1");
    expect(fmtMoney(1234567, "KRW")).toBe("1,234,567");
    expect(fmtMoney(1234.5678, "USD")).toBe("1,234.57");
  });
  test("a tiny nonzero difference is not shown as 0", () => {
    expect(fmtMoney(0.04)).not.toBe("0");
    expect(fmtMoney(0)).toBe("0");
  });
});
