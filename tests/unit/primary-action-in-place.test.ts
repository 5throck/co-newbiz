// Guard: PrimaryAction must render in place. The StageFrame head slot was removed (head-action
// standard 2026-10-22), so a slot/portal path would silently render nothing again.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "..", "..", "app", "web-next");
const ui = readFileSync(join(WEB, "components", "ui.tsx"), "utf8");
const frame = readFileSync(join(WEB, "components", "StageFrame.tsx"), "utf8");

describe("PrimaryAction renders in place", () => {
  test("no header-slot / portal path remains in ui.tsx", () => {
    expect(ui).not.toMatch(/createPortal|PrimarySlot|primarySlot/);
  });
  test("StageFrame does not depend on a primary slot", () => {
    expect(frame).not.toMatch(/PrimarySlot/);
  });
  test("PrimaryAction always wraps its output in the in-place container", () => {
    const body = ui.slice(ui.indexOf("export function PrimaryAction("));
    expect(body).toContain('<span className="primary-inline">{node}</span>');
    expect(body).not.toMatch(/return null/);
  });
});
