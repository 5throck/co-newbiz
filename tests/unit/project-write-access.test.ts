import { test, expect } from "bun:test";
import { canWriteProject, isReadOnlyAdmin } from "../../app/web-next/lib/project-write-access.ts";

test("only analyst may write project data", () => {
  expect(canWriteProject("analyst")).toBe(true);
  for (const r of ["admin", "viewer", null, undefined]) expect(canWriteProject(r)).toBe(false);
});
test("admin gets the read-only notice", () => {
  expect(isReadOnlyAdmin("admin")).toBe(true);
  expect(isReadOnlyAdmin("analyst")).toBe(false);
});
