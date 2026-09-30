import { test, expect, describe } from "bun:test";
import {
  requireBusinessActor,
  ADMIN_BUSINESS_FORBIDDEN_MESSAGE,
  VIEWER_WRITE_FORBIDDEN_MESSAGE,
  type AuthContext,
} from "../../app/web-next/lib/auth.ts";

// ADR-0146 — central business-content actor guard.
const ctx = (role: AuthContext["role"]): AuthContext => ({
  userId: "u1",
  role,
  via: "cookie",
  scopes: [],
  mustChangePassword: false,
});

const CASES: Array<["analyst" | "viewer" | "admin", "read" | "write", string | null]> = [
  ["analyst", "read", null],
  ["analyst", "write", null],
  ["viewer", "read", null],
  ["viewer", "write", "role_required"],
  ["admin", "read", "role_forbidden"],
  ["admin", "write", "role_forbidden"],
];

describe("requireBusinessActor", () => {
  for (const [role, mode, code] of CASES) {
    test(`${role} x ${mode} -> ${code ?? "allowed"}`, async () => {
      const res = requireBusinessActor(ctx(role), mode);
      if (code === null) {
        expect(res).toBeNull();
        return;
      }
      expect(res).not.toBeNull();
      expect(res!.status).toBe(403);
      const body = (await res!.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe(code);
      expect(body.error.message).toBe(
        code === "role_forbidden" ? ADMIN_BUSINESS_FORBIDDEN_MESSAGE : VIEWER_WRITE_FORBIDDEN_MESSAGE,
      );
    });
  }

  test("viewerMessage overrides the default viewer message only", async () => {
    const res = requireBusinessActor(ctx("viewer"), "write", { viewerMessage: "custom" });
    const body = (await res!.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("role_required");
    expect(body.error.message).toBe("custom");
    const admin = requireBusinessActor(ctx("admin"), "write", { viewerMessage: "custom" });
    expect(((await admin!.json()) as { error: { message: string } }).error.message).toBe(ADMIN_BUSINESS_FORBIDDEN_MESSAGE);
  });
});
