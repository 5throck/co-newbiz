import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ai2ndStatusMessage, localizeNotPerformedReason } from "../../app/web-next/lib/review/review-display.ts";

const RAW = "AI 1st found structural gaps (incomplete or locked stages); nothing worth cross-domain review yet";

describe("ai2ndStatusMessage", () => {
  test("skipped path carries the same reason text as the AI 2nd line and never says 아래", () => {
    const msg = ai2ndStatusMessage({ performed: false, not_performed_reason: RAW });
    expect(msg).toContain(localizeNotPerformedReason(RAW));
    expect(msg.startsWith("AI 2차 검토는 수행되지 않았습니다 — ")).toBe(true);
    expect(msg).not.toContain("아래");
  });
  test("empty reason points upward, not below", () => {
    const msg = ai2ndStatusMessage({ performed: false, not_performed_reason: null });
    expect(msg).toContain("위쪽");
    expect(msg).not.toContain("아래");
  });
  test("performed or missing stage reports the refreshed result", () => {
    expect(ai2ndStatusMessage({ performed: true, not_performed_reason: null })).toBe(
      "AI 2차 검토 결과가 갱신되었습니다.",
    );
    expect(ai2ndStatusMessage(null)).toBe("AI 2차 검토 결과가 갱신되었습니다.");
  });
});

describe("ReviewBuckets source", () => {
  const src = readFileSync(new URL("../../app/web-next/components/ReviewBuckets.tsx", import.meta.url), "utf8");
  test("uses the shared helper and the renamed dev details label", () => {
    expect(src).toContain("setStatus(ai2ndStatusMessage(r.data.ai_2nd))");
    expect(src).not.toContain("사유가 아래에 표시됩니다");
    // PR3 (design 2026-11-06): the label renders via the catalog key (ko "원문 기록 (추적·대조용)" lives in locales/*/json; reworded 2026-11-11 per design §9.6).
    expect(src).toContain('<summary>{tr("review.dev.summary")}</summary>');
    expect(src).not.toContain("<summary>개발자 세부정보</summary>");
  });
});
