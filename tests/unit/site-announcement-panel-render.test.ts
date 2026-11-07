// ADR-0194 item B (PR-2): the S5 site-announcement + infrastructure-plan panel renders as designed
// (design 2026-11-07-kill-data-sources §4.6). Status line (missing parts are "unassessed", never clean or triggered),
// earliest announcement date highlighted as the #5 reference, human-only recording (empty forms, no default date, no AI
// pre-fill), the effective-date field only for 'yes', review state chips as icon + text, review offered only to a person
// other than the asserter, history collapsed, ko/en parity, and the link from the #5 snapshot row.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const WEB = "../../app/web-next";
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as { renderToStaticMarkup: (el: unknown) => string };
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as { createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown };
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as { NextIntlClientProvider: unknown };
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { SiteAnnouncementPanelView } = (await import(`${WEB}/components/stages/SiteAnnouncementPanel.tsx`)) as { SiteAnnouncementPanelView: unknown };
const { GateAckBlock } = (await import(`${WEB}/components/GateSnapshotAck.tsx`)) as { GateAckBlock: unknown };
const { EMPTY_ACK_STATE } = (await import(`${WEB}/lib/gate-ack-view.ts`)) as { EMPTY_ACK_STATE: unknown };
const V = await import(`${WEB}/lib/site-announcement-view.ts`);

const KINDS = ["board_resolution", "public_announcement", "mou_signing", "regulatory_filing"];
const TODAY = "2026-11-07";

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" }, el));

const ann = (kind: string, on: string, over: Record<string, unknown> = {}) => ({
  id: `a-${kind}`, project_id: "p1", site_id: null, announced_on: on, announcement_kind: kind, evidence_ref: "doc:board-minutes-7",
  recorded_by: "user-7", recorded_at: "2026-11-07T01:00:00.000Z", superseded_by: null, ...over,
});
const annData = (live: ReturnType<typeof ann>[], over: Record<string, unknown> = {}) => ({
  project_id: "p1", live, history: [], earliest_announced_on: live.length ? live.map((r) => r.announced_on).sort()[0] : null,
  unrecorded_kinds: KINDS.filter((k) => !live.some((r) => r.announcement_kind === k)), vocabulary: { announcement_kinds: KINDS }, ...over,
});
const plan = (value: "yes" | "no", over: Record<string, unknown> = {}) => ({
  id: "d-1", run_id: "run-1", project_id: "p1", var_key: "infra.plan_finalized", value_kind: "text", value_text: value, value_num: null, unit: null,
  evidence_ref: "doc:plan-v3", asserted_by: "user-1", reviewed_by: null, rationale: "plan v3 signed", observed_at: "2026-11-06T01:00:00.000Z",
  effective_on: value === "yes" ? "2026-03-01" : null, superseded_by: null, ...over,
});
const planData = (rows: ReturnType<typeof plan>[], inputs?: ReturnType<typeof plan>[]) => ({
  project_id: "p1", inputs: inputs ?? rows, live: rows.filter((r) => r.superseded_by === null),
  vocabulary: { assertable_vars: [{ var_key: "infra.plan_finalized", label_ko: "x", value_type: "string", unit: null, requires_evidence_ref: 0 }] },
});
const noop = () => {};
const view = (a: unknown, p: unknown, over: Record<string, unknown> = {}, locale: "ko" | "en" = "ko") => render(createElement(SiteAnnouncementPanelView, {
  announcements: a, announcementsError: null, plan: p, planError: null, canAct: true, meId: "user-2", today: TODAY,
  announce: { form: V.EMPTY_ANNOUNCEMENT_FORM, onForm: noop, onSubmit: noop, onEdit: noop, busy: false, problem: null, serverError: null, notice: null, loadedFromRow: false },
  planBlock: { form: V.EMPTY_PLAN_FORM, onForm: noop, onSubmit: noop, busy: false, problem: null, serverError: null, notice: null, onReview: noop, reviewBusy: false, reviewError: null, reviewNotice: null },
  ...over,
}), locale);
const withPlanForm = (f: Record<string, unknown>) => ({ planBlock: { form: { ...V.EMPTY_PLAN_FORM, ...f }, onForm: noop, onSubmit: noop, busy: false, problem: null, serverError: null, notice: null, onReview: noop, reviewBusy: false, reviewError: null, reviewNotice: null } });

describe("view logic: dates and citations", () => {
  test("isIsoCalendarDate rejects impossible dates and loose formats", () => {
    expect(V.isIsoCalendarDate("2026-11-07")).toBe(true);
    expect(V.isIsoCalendarDate("2026-02-30")).toBe(false);
    expect(V.isIsoCalendarDate("2026-13-01")).toBe(false);
    expect(V.isIsoCalendarDate("2026-1-7")).toBe(false);
    expect(V.isIsoCalendarDate("")).toBe(false);
  });
  test("seoulToday uses the Asia/Seoul calendar day (UTC+9)", () => {
    expect(V.seoulToday(new Date("2026-11-06T16:00:00.000Z"))).toBe("2026-11-07");
    expect(V.seoulToday(new Date("2026-11-06T14:59:59.000Z"))).toBe("2026-11-06");
  });
  test("evidence citation vocabulary; only https becomes a link", () => {
    for (const ok of ["doc:abc", "src:KIS-2025", "https://example.org/a"]) expect(V.isValidEvidenceRef(ok)).toBe(true);
    for (const bad of ["", "doc:", "cim.pdf#p12", "http://x.org", "doc: a b", "javascript:alert(1)"]) expect(V.isValidEvidenceRef(bad)).toBe(false);
    expect(V.evidenceHref("https://example.org/a")).toBe("https://example.org/a");
    expect(V.evidenceHref("doc:abc")).toBeNull();
    expect(V.evidenceHref("javascript:alert(1)")).toBeNull();
  });
});

describe("view logic: announcement rows and form", () => {
  test("announcementKindRows keeps vocabulary order, flags every row on the earliest date, marks the rest unrecorded", () => {
    const d = annData([ann("public_announcement", "2026-05-02"), ann("board_resolution", "2026-04-01"), ann("mou_signing", "2026-04-01")]);
    const rows = V.announcementKindRows(d);
    expect(rows.map((r: { kind: string }) => r.kind)).toEqual(KINDS);
    expect(rows.map((r: { state: string; earliest?: boolean }) => (r.state === "recorded" ? r.earliest : "-"))).toEqual([true, false, true, "-"]);
  });
  test("an empty data set has no earliest row", () => {
    expect(V.announcementKindRows(annData([])).every((r: { state: string }) => r.state === "unrecorded")).toBe(true);
  });
  test("the form starts empty (no default date, no default kind) and validation follows field order", () => {
    const f = V.EMPTY_ANNOUNCEMENT_FORM;
    expect(f).toEqual({ announcedOn: "", kind: "", evidenceRef: "" });
    expect(V.validateAnnouncementForm(f, TODAY)).toBe("kind");
    expect(V.validateAnnouncementForm({ ...f, kind: "board_resolution" }, TODAY)).toBe("announcedOn");
    expect(V.validateAnnouncementForm({ ...f, kind: "board_resolution", announcedOn: "2026-02-30" }, TODAY)).toBe("announcedOn");
    expect(V.validateAnnouncementForm({ ...f, kind: "board_resolution", announcedOn: "2026-11-08" }, TODAY)).toBe("announcedOnFuture");
    expect(V.validateAnnouncementForm({ ...f, kind: "board_resolution", announcedOn: TODAY }, TODAY)).toBe("evidence");
    expect(V.validateAnnouncementForm({ ...f, kind: "board_resolution", announcedOn: TODAY, evidenceRef: "minutes" }, TODAY)).toBe("evidenceFormat");
    expect(V.validateAnnouncementForm({ ...f, kind: "board_resolution", announcedOn: TODAY, evidenceRef: `doc:${"x".repeat(2001)}` }, TODAY)).toBe("evidenceTooLong");
    const ok = { kind: "mou_signing", announcedOn: "2026-04-01", evidenceRef: "  doc:mou-1  " };
    expect(V.validateAnnouncementForm(ok, TODAY)).toBeNull();
    expect(V.buildAnnouncementBody(ok)).toEqual({ announced_on: "2026-04-01", announcement_kind: "mou_signing", evidence_ref: "doc:mou-1" });
  });
  test("correction loads the person's own recorded row", () => {
    expect(V.announcementFormFromRow(ann("mou_signing", "2026-04-01"))).toEqual({ announcedOn: "2026-04-01", kind: "mou_signing", evidenceRef: "doc:board-minutes-7" });
  });
});

describe("view logic: plan assertion", () => {
  test("livePlanRow picks only the live infra.plan_finalized row; history lists the superseded ones", () => {
    const old = plan("no", { id: "old", superseded_by: "d-1" });
    const d = planData([plan("yes")], [plan("yes"), old]);
    expect(V.livePlanRow(d).id).toBe("d-1");
    expect(V.planHistoryRows(d).map((r: { id: string }) => r.id)).toEqual(["old"]);
    expect(V.livePlanRow(planData([]))).toBeNull();
    expect(V.livePlanRow(null)).toBeNull();
  });
  test("a row is pending until reviewed", () => {
    expect(V.planReviewState(plan("yes"))).toBe("pending");
    expect(V.planReviewState(plan("yes", { reviewed_by: "user-2" }))).toBe("reviewed");
  });
  test("review is offered only to a different, signed-in analyst on a pending row", () => {
    const pending = plan("yes");
    expect(V.reviewAvailability(pending, "user-2", true)).toBe("available");
    expect(V.reviewAvailability(pending, "user-1", true)).toBe("own_assertion");
    expect(V.reviewAvailability(pending, "user-2", false)).toBe("no_access");
    expect(V.reviewAvailability(pending, null, true)).toBe("no_access");
    expect(V.reviewAvailability(plan("yes", { reviewed_by: "user-2" }), "user-3", true)).toBe("not_pending");
  });
  test("the effective-date field belongs to 'yes' only; the body carries it only then, and no asserter", () => {
    expect(V.showsEffectiveOn({ value: "yes" })).toBe(true);
    expect(V.showsEffectiveOn({ value: "no" })).toBe(false);
    expect(V.showsEffectiveOn({ value: "" })).toBe(false);
    expect(V.buildPlanBody({ value: "yes", effectiveOn: "2026-03-01", evidenceRef: " doc:p ", rationale: " r " }))
      .toEqual({ var_key: "infra.plan_finalized", value: "yes", evidence_ref: "doc:p", rationale: "r", effective_on: "2026-03-01" });
    const no = V.buildPlanBody({ value: "no", effectiveOn: "2026-03-01", evidenceRef: "", rationale: "r" });
    expect(no).toEqual({ var_key: "infra.plan_finalized", value: "no", evidence_ref: "", rationale: "r" });
    expect("effective_on" in no).toBe(false);
  });
  test("validatePlanForm: 'yes' needs the document date and a citation; 'no' needs neither; rationale always", () => {
    const f = V.EMPTY_PLAN_FORM;
    expect(f.value).toBe("");
    expect(V.validatePlanForm(f, TODAY, false)).toBe("value");
    const yes = { ...f, value: "yes" };
    expect(V.validatePlanForm(yes, TODAY, false)).toBe("effectiveOn");
    expect(V.validatePlanForm({ ...yes, effectiveOn: "2026-11-08" }, TODAY, false)).toBe("effectiveOnFuture");
    expect(V.validatePlanForm({ ...yes, effectiveOn: "2026-03-01" }, TODAY, false)).toBe("evidence");
    expect(V.validatePlanForm({ ...yes, effectiveOn: "2026-03-01", evidenceRef: "plan.pdf" }, TODAY, false)).toBe("evidenceFormat");
    expect(V.validatePlanForm({ ...yes, effectiveOn: "2026-03-01", evidenceRef: "doc:p" }, TODAY, false)).toBe("rationale");
    expect(V.validatePlanForm({ ...yes, effectiveOn: "2026-03-01", evidenceRef: "doc:p", rationale: "x".repeat(2001) }, TODAY, false)).toBe("rationaleTooLong");
    expect(V.validatePlanForm({ ...yes, effectiveOn: "2026-03-01", evidenceRef: "doc:p", rationale: "ok" }, TODAY, false)).toBeNull();
    const no = { ...f, value: "no", rationale: "not yet" };
    expect(V.validatePlanForm(no, TODAY, false)).toBeNull();
    expect(V.validatePlanForm(no, TODAY, true)).toBe("evidence");
  });
});

describe("view logic: kill criterion #5 status", () => {
  const reviewedYes = (on: string | null) => plan("yes", { reviewed_by: "user-2", effective_on: on });
  test("missing announcement and/or plan is unassessed and lists what is missing", () => {
    expect(V.killFiveStatus(null, null)).toEqual({ kind: "unassessed", missing: ["announcement", "plan"] });
    expect(V.killFiveStatus("2026-04-01", null)).toEqual({ kind: "unassessed", missing: ["plan"] });
    expect(V.killFiveStatus(null, reviewedYes("2026-03-01"))).toEqual({ kind: "unassessed", missing: ["announcement"] });
  });
  test("an unreviewed assertion fills nothing, and a reviewed 'yes' without a date is unassessed", () => {
    expect(V.killFiveStatus("2026-04-01", plan("yes"))).toEqual({ kind: "unassessed", missing: ["review"] });
    expect(V.killFiveStatus("2026-04-01", plan("no"))).toEqual({ kind: "unassessed", missing: ["review"] });
    expect(V.killFiveStatus("2026-04-01", reviewedYes(null))).toEqual({ kind: "unassessed", missing: ["effectiveOn"] });
  });
  test("plan on or before the announcement is clean; after it is triggered", () => {
    expect(V.killFiveStatus("2026-04-01", reviewedYes("2026-03-01"))).toEqual({ kind: "clean", announcedOn: "2026-04-01", planOn: "2026-03-01" });
    expect(V.killFiveStatus("2026-04-01", reviewedYes("2026-04-01")).kind).toBe("clean");
    expect(V.killFiveStatus("2026-04-01", reviewedYes("2026-04-02"))).toEqual({ kind: "triggered", reason: "plan_after_announcement", announcedOn: "2026-04-01", planOn: "2026-04-02" });
  });
  test("a reviewed 'no' with an announcement on record is triggered", () => {
    expect(V.killFiveStatus("2026-04-01", plan("no", { reviewed_by: "user-2" }))).toEqual({ kind: "triggered", reason: "plan_not_finalized", announcedOn: "2026-04-01" });
  });
  test("error envelope maps to a message kind", () => {
    expect(V.killDataErrorKind(403, "role_required")).toBe("viewer");
    expect(V.killDataErrorKind(403, "role_forbidden")).toBe("admin");
    expect(V.killDataErrorKind(403, "human_only")).toBe("humanOnly");
    expect(V.killDataErrorKind(404, "not_found")).toBe("notFound");
    expect(V.killDataErrorKind(400, "invalid_request")).toBe("invalid");
    expect(V.killDataErrorKind(409, "second_person_required")).toBe("secondPerson");
    expect(V.killDataErrorKind(409, "review_rejected")).toBe("reviewRejected");
    expect(V.killDataErrorKind(409, "no_run")).toBe("noRun");
    expect(V.killDataErrorKind(500, "internal")).toBe("other");
  });
});

describe("status line", () => {
  test("nothing recorded: unassessed with what is missing", () => {
    const html = view(annData([]), planData([]));
    expect(html).toContain('data-status="unassessed"');
    expect(html).toContain("평가 전 — 아직 없는 것: 부지 발표 기록, 인프라 계획 기록");
    expect(html).not.toContain("해당하지 않습니다");
  });
  test("an unreviewed plan names the review as missing", () => {
    const html = view(annData([ann("board_resolution", "2026-04-01")]), planData([plan("yes")]));
    expect(html).toContain('data-status="unassessed"');
    expect(html).toContain("인프라 계획 기록의 다른 사람 검토");
  });
  test("plan on or before the announcement: clean, with an icon", () => {
    const html = view(annData([ann("board_resolution", "2026-04-01")]), planData([plan("yes", { reviewed_by: "user-2" })]));
    expect(html).toContain('data-status="clean"');
    expect(html).toContain("계획 확정일(2026-03-01)이 부지 발표 기준일(2026-04-01) 이전이거나 같은 날입니다");
    expect(html).toContain('<span aria-hidden="true">✓</span>');
  });
  test("plan after the announcement: warning with an icon", () => {
    const html = view(annData([ann("board_resolution", "2026-02-01")]), planData([plan("yes", { reviewed_by: "user-2" })]));
    expect(html).toContain('data-status="triggered"');
    expect(html).toContain('data-reason="plan_after_announcement"');
    expect(html).toContain("중단 조건 #5에 해당합니다(조건부 표시)");
    expect(html).toContain('<span aria-hidden="true">⚠</span>');
  });
  test("a reviewed 'no' with an announcement: warning that the plan was not finalized", () => {
    const html = view(annData([ann("board_resolution", "2026-02-01")]), planData([plan("no", { reviewed_by: "user-2" })]));
    expect(html).toContain('data-reason="plan_not_finalized"');
    expect(html).toContain("인프라 계획이 확정되지 않았습니다");
  });
});

describe("announcement card", () => {
  const d = annData([ann("public_announcement", "2026-05-02"), ann("board_resolution", "2026-04-01", { evidence_ref: "https://example.org/minutes" })]);
  const html = view(d, planData([]));
  test("every kind has a row, unrecorded kinds as icon plus text, labels localized", () => {
    expect(html.match(/data-state="unrecorded"/g)?.length).toBe(2);
    expect(html).toContain('<span aria-hidden="true">○</span> 기록 없음');
    for (const label of ["이사회 의결", "공개 발표", "양해각서(MOU) 체결", "규제 당국 제출"]) expect(html).toContain(label);
    expect(html).not.toContain(">board_resolution<");
    const enHtml = view(d, planData([]), {}, "en");
    for (const label of ["Board resolution", "Public announcement", "MOU signing", "Regulatory filing"]) expect(enHtml).toContain(label);
  });
  test("the earliest date is highlighted as the #5 reference (icon plus text), only on that row", () => {
    expect(html.match(/data-earliest="true"/g)?.length).toBe(1);
    expect(html).toMatch(/data-kind="board_resolution"[^>]*data-earliest="true"/);
    expect(html).toContain('<span aria-hidden="true">★</span> #5 기준일(가장 이른 날짜)');
    expect(html).toContain("부지 발표 기준일(가장 이른 날짜): 2026-04-01");
  });
  test("an https evidence reference is a link that opens safely; other citations stay text", () => {
    expect(html).toContain('href="https://example.org/minutes"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('href="doc:');
  });
  test("no announcement: explains that #5 is unassessed", () => {
    expect(view(annData([]), planData([]))).toContain("기록된 부지 발표가 없습니다");
  });
  test("history is a collapsed details", () => {
    const old = ann("board_resolution", "2026-04-09", { id: "old", superseded_by: "a-board_resolution", evidence_ref: "doc:old" });
    const h = view(annData([ann("board_resolution", "2026-04-01")], { history: [old] }), planData([]));
    const hist = h.match(/<details[^>]*data-testid="site-announcement-history"[\s\S]*?<\/details>/)![0];
    expect(hist).not.toContain("open=");
    expect(hist).toContain("정정 이력 (1건)");
    expect(hist).toContain("2026-04-09");
    expect(view(annData([ann("board_resolution", "2026-04-01")]), planData([]))).not.toContain("site-announcement-history");
  });
});

describe("human-only recording", () => {
  const html = view(annData([]), planData([]));
  test("states that nothing is pre-filled; both forms start empty with required fields marked", () => {
    expect(html).toContain("AI 제안이나 날짜를 미리 채우지 않습니다");
    const forms = html.match(/<form[\s\S]*?<\/form>/g)!;
    expect(forms.length).toBe(2);
    for (const form of forms) {
      expect(form).not.toContain("checked");
      expect(form).toContain('aria-required="true"');
    }
    const annForm = forms[0];
    expect(annForm).toMatch(/<input[^>]*type="date"[^>]*value=""/);
    expect(annForm).toContain(`max="${TODAY}"`);
    expect(annForm).not.toContain(`value="${TODAY}"`);
    expect(forms[1].match(/<textarea[^>]*>[^<]*<\/textarea>/)![0]).toMatch(/><\/textarea>$/);
  });
  test("the page keeps one primary action: no record or review button is btn-primary", () => {
    expect(html).not.toContain("btn-primary");
    expect(view(annData([ann("board_resolution", "2026-04-01")]), planData([plan("yes")]))).not.toContain("btn-primary");
  });
  test("a viewer or admin gets the read-only note and no forms, correct or review buttons", () => {
    const h = view(annData([ann("board_resolution", "2026-04-01")]), planData([plan("yes")]), { canAct: false });
    expect(h).toContain('data-testid="site-announcement-readonly"');
    expect(h).not.toContain("<form");
    expect(h).not.toContain("정정<");
    expect(h).not.toContain("infra-plan-review-button");
  });
  test("an editor sees a correct button per recorded kind only", () => {
    expect(view(annData([ann("board_resolution", "2026-04-01")]), planData([])).match(/>정정</g)?.length).toBe(1);
  });
  test("problems and server errors render as alerts with an icon", () => {
    const h = view(annData([]), planData([]), {
      announce: { form: V.EMPTY_ANNOUNCEMENT_FORM, onForm: noop, onSubmit: noop, onEdit: noop, busy: false, problem: "announcedOnFuture", serverError: "boom", notice: null, loadedFromRow: false },
    });
    expect(h).toContain("오늘 이후 날짜는 기록할 수 없습니다.");
    expect(h).toContain('data-testid="site-announcement-server-error"');
  });
});

describe("infrastructure plan block", () => {
  test("no assertion yet: icon plus text, and the form is offered", () => {
    const h = view(annData([]), planData([]));
    expect(h).toContain('data-testid="infra-plan-none"');
    expect(h).toContain("인프라 계획이 확정되었는지 기록된 내용이 없습니다");
  });
  test("the effective-date field appears only for 'yes', labelled as the plan document's date, never defaulted", () => {
    const none = view(annData([]), planData([]));
    expect(none).not.toContain("infra-plan-effective");
    expect(none).not.toMatch(/<input[^>]*id="[^"]*-effective"/);
    const no = view(annData([]), planData([]), withPlanForm({ value: "no" }));
    expect(no).not.toMatch(/<input[^>]*id="[^"]*-effective"/);
    const yes = view(annData([]), planData([]), withPlanForm({ value: "yes" }));
    expect(yes).toMatch(/<input[^>]*id="[^"]*-effective"[^>]*type="date"[^>]*value=""/);
    expect(yes).toContain("확정된 계획 문서의 날짜");
    expect(yes).toContain("기록하는 날이나 오늘 날짜로 채우지 않습니다");
    expect(yes).toContain("근거 자료 참조 (필수)");
  });
  test("a pending live assertion shows a text-plus-icon chip and no value chip implies it counts", () => {
    const h = view(annData([]), planData([plan("yes")]));
    expect(h).toContain('data-review="pending"');
    expect(h).toContain('<span aria-hidden="true">○</span> 검토 대기');
    expect(h).toContain("2026-03-01");
    expect(h).toContain("확정됨");
  });
  test("a reviewed assertion shows the reviewed chip and the reviewer, with no review button", () => {
    const h = view(annData([]), planData([plan("yes", { reviewed_by: "user-2" })]));
    expect(h).toContain('data-review="reviewed"');
    expect(h).toContain('<span aria-hidden="true">✓</span> 검토됨');
    expect(h).toContain("검토한 사람");
    expect(h).not.toContain("infra-plan-review-button");
  });
  test("a 'no' assertion shows no effective date", () => {
    const h = view(annData([]), planData([plan("no")]));
    expect(h).toContain("확정되지 않음");
    expect(h).not.toContain("infra-plan-effective-on");
  });
  test("the review button is offered to someone other than the asserter, who gets an explanation instead", () => {
    const other = view(annData([]), planData([plan("yes")]), { meId: "user-2" });
    expect(other).toContain('data-testid="infra-plan-review-button"');
    expect(other).toContain("검토함으로 표시");
    const own = view(annData([]), planData([plan("yes")]), { meId: "user-1" });
    expect(own).not.toContain("infra-plan-review-button");
    expect(own).toContain('data-testid="infra-plan-own-note"');
    expect(own).toContain("내가 기록한 항목입니다");
  });
  test("history of earlier assertions is collapsed", () => {
    const old = plan("no", { id: "old", superseded_by: "d-1", rationale: "old reason" });
    const h = view(annData([]), planData([plan("yes")], [plan("yes"), old]));
    const hist = h.match(/<details[^>]*data-testid="infra-plan-history"[\s\S]*?<\/details>/)![0];
    expect(hist).not.toContain("open=");
    expect(hist).toContain("이전 기록 (1건)");
    expect(hist).toContain("old reason");
  });
  test("review error and notice render with an icon", () => {
    const h = view(annData([]), planData([plan("yes")]), { planBlock: { ...withPlanForm({}).planBlock, reviewError: "nope", reviewNotice: null } });
    expect(h).toContain('data-testid="infra-plan-review-error"');
  });
});

describe("load errors", () => {
  test("a 403 admin load error is explained and renders no form", () => {
    const h = view(null, null, { announcementsError: "admin", planError: "admin" });
    expect(h).toContain("관리자 역할은 사업 내용을 볼 수 없습니다");
    expect(h).not.toContain("<form");
    expect(h.match(/data-testid="site-announcement-load-error"/g)?.length).toBe(1);
    expect(h).not.toContain("data-status=");
  });
  test("while loading, no status line and no form", () => {
    const h = view(null, null);
    expect(h).not.toContain("data-status=");
    expect(h).not.toContain("<form");
  });
  test("one side failing keeps the other usable but shows no status line", () => {
    const h = view(annData([]), null, { planError: "other" });
    expect(h).toContain('data-testid="infra-plan-load-error"');
    expect(h).toContain('data-testid="site-announcement-form"');
    expect(h).not.toContain("data-status=");
  });
});

describe("catalog", () => {
  const keys = (o: unknown, prefix = ""): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const at = (o: unknown, path: string) => path.split(".").reduce((a: any, p) => a[p], o as any);
  test("ko and en carry the same keys, none empty", () => {
    const k = (ko.stages as { s5: { siteAnnouncementPanel: unknown } }).s5.siteAnnouncementPanel;
    const e = (en.stages as { s5: { siteAnnouncementPanel: unknown } }).s5.siteAnnouncementPanel;
    expect(keys(k).sort()).toEqual(keys(e).sort());
    for (const o of [k, e]) for (const key of keys(o)) expect(String(at(o, key)).length).toBeGreaterThan(0);
  });
  test("the dynamic message families cover every kind the code can produce", () => {
    const k = (ko.stages as { s5: { siteAnnouncementPanel: Record<string, Record<string, string>> } }).s5.siteAnnouncementPanel;
    for (const p of ["kind", "announcedOn", "announcedOnFuture", "evidence", "evidenceFormat", "evidenceTooLong"]) expect(k.announceProblem[p]).toBeTruthy();
    for (const p of ["value", "effectiveOn", "effectiveOnFuture", "evidence", "evidenceFormat", "evidenceTooLong", "rationale", "rationaleTooLong"]) expect(k.planProblem[p]).toBeTruthy();
    for (const p of ["viewer", "admin", "notFound", "invalid", "humanOnly", "secondPerson", "reviewRejected", "noRun", "other"]) expect(k.serverError[p]).toBeTruthy();
    for (const p of ["viewer", "admin", "notFound", "other"]) expect(k.loadError[p]).toBeTruthy();
    for (const p of ["announcement", "plan", "review", "effectiveOn"]) expect(k.missing[p]).toBeTruthy();
    for (const p of KINDS) expect(k.kind[p]).toBeTruthy();
  });
});

describe("gate snapshot link to the panel", () => {
  const snapshot = (key: string, procedure: string, criterion: string) => ({
    gate: "fs",
    kill: { triggered: [], unassessed: [{ key, procedure, criterion_id: criterion, title: "Plan not finalized", action: "mark_conditional" }], inert: 0, inert_list: [] },
    rag: null, validators: null, nonwaivable_open: [], wacc: null, waivers: { active: [], expiring_14d: [] },
    ladder: { prior_gate: null, prior_decision: null, effective: true, blocker: null }, ai: null,
    required_acks: [{ key, kind: "kill_unassessed", procedure, criterion_id: criterion, action: "mark_conditional" }],
    hard_blocks: [],
  });
  const block = (snap: unknown, dealId?: string, locale: "ko" | "en" = "ko") => render(createElement(GateAckBlock, {
    snapshot: snap, state: EMPTY_ACK_STATE, onChange: noop, problems: null, decision: "go", divergence: null, notice: null, dealId,
  }), locale);
  const five = snapshot(V.SITE_ANNOUNCEMENT_KILL_KEY, "greenfield-screening", "infrastructure_plan_not_finalized_at_site_announcement");
  test("the unassessed #5 row links to the S5 review tab anchor", () => {
    const html = block(five, "opp 1");
    expect(html).toContain('data-testid="site-announcement-link"');
    expect(html).toContain('href="/deals/opp%201/s5?tab=review#site-announcement-panel"');
    expect(html).toContain("부지 발표와 인프라 계획 확정을 기록하러 가기");
    expect(block(five, "opp-1", "en")).toContain("Go to the site announcement and infrastructure plan record");
  });
  test("no deal id, no link; other unassessed rows never get it", () => {
    expect(block(five)).not.toContain("site-announcement-link");
    expect(block(snapshot("deal-shape-chain:no_viable_deal_shape", "deal-shape-chain", "no_viable_deal_shape"), "opp-1")).not.toContain("site-announcement-link");
  });
  test("siteAnnouncementHref carries the tab and the anchor", () => {
    expect(V.siteAnnouncementHref("p/1")).toBe("/deals/p%2F1/s5?tab=review#site-announcement-panel");
  });
});

describe("S5 mount", () => {
  const src = readFileSync(new URL(`${WEB}/components/stages/GreenfieldStage.tsx`, import.meta.url), "utf8");
  test("the panel mounts on the review tab, only for a promoted project, and the primary action stays after it", () => {
    expect(src).toContain("selected.opportunity.project_id && <SiteAnnouncementPanel projectId={selected.opportunity.project_id} canAct={canAct} />");
    const panelAt = src.indexOf("<SiteAnnouncementPanel ");
    expect(panelAt).toBeGreaterThan(src.indexOf('panel("review"'));
    expect(src.indexOf("<PrimaryAction", panelAt)).toBeGreaterThan(panelAt);
  });
});
