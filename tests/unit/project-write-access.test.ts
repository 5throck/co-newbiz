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

import { canWriteBusiness, canReadBusiness } from "../../app/web-next/lib/project-write-access.ts";

const roleCases: Array<[string | null | undefined, boolean, boolean, boolean]> = [
  // role, canWriteBusiness, canReadBusiness, canWriteProject
  ["analyst", true, true, true],
  ["viewer", false, true, false],
  ["admin", false, false, false],
  [null, false, false, false],
  [undefined, false, false, false],
  ["unknown-role", false, true, false],
];
for (const [role, write, read, project] of roleCases) {
  test(`business access for role=${String(role)}`, () => {
    expect(canWriteBusiness(role)).toBe(write);
    expect(canReadBusiness(role)).toBe(read);
    expect(canWriteProject(role)).toBe(project);
  });
}
