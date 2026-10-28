// @version 1.0.0
// ADR-0187 P3 (finding H8): the stable engine blocker keys - registry integrity, ko/en
// i18n parity (processBlockers.*), label round-trip, the flow.spec `blockers:` declaration
// and the capability-register lead (D5) that rides on the same change.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import { BLOCKER_LABELS, blocker, blockerKeyForLabel, blockerMessageKey, blockerStage, type BlockerKey } from "../../app/web-next/lib/process-blocker-keys.ts";
import { STAGES } from "../../app/web-next/lib/process-flow.ts";

const TEST_DB_PATH = "db/data/test-process-blocker-keys.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { capabilityRegisterLead } = await import("../../app/web-next/lib/capability-register-lead.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const keys = Object.keys(BLOCKER_LABELS) as BlockerKey[];
const ko = JSON.parse(readFileSync("app/web-next/locales/ko.json", "utf8")) as { processBlockers: Record<string, string> };
const en = JSON.parse(readFileSync("app/web-next/locales/en.json", "utf8")) as { processBlockers: Record<string, string> };
const spec = parseYaml(readFileSync("process/flow.spec.yaml", "utf8")) as {
  meta: { version: string };
  stages: Array<{ id: string; requiredArtifacts: string[]; completionCriteria: string[]; blockers: Array<{ key: string; artifacts?: number[]; criteria?: number[] }>; nonBlockingArtifacts?: number[] }>;
};

describe("registry", () => {
  test("key format s<n>.snake_case, the prefix names a real stage, labels are unique within a stage", () => {
    const stageIds = new Set(spec.stages.map((s) => s.id));
    const seen = new Set<string>();
    for (const k of keys) {
      expect(k).toMatch(/^s\d+\.[a-z0-9_]+$/);
      expect(stageIds.has(blockerStage(k))).toBe(true);
      const id = `${blockerStage(k)}|${BLOCKER_LABELS[k]}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
  test("blocker() returns the exact label the engine has always emitted; labels resolve back to their key per stage", () => {
    expect(blocker("s3.capability_register")).toBe("필요 역량 목록(출처 포함)");
    expect(blockerKeyForLabel("검토한 대안", "S4")).toBe("s4.alternatives_considered");
    expect(blockerKeyForLabel("검토한 대안", "S5")).toBe("s5.alternatives_considered");
    expect(blockerKeyForLabel("자유 서술 차단 문장")).toBeUndefined();
    for (const k of keys) expect(blockerKeyForLabel(BLOCKER_LABELS[k], blockerStage(k))).toBe(k);
  });
  test("every requiredArtifact the engine mirrors verbatim from flow.spec is a registered label or an unblocked one", () => {
    const labels = new Set<string>(Object.values(BLOCKER_LABELS));
    for (const stage of STAGES) {
      const declared = spec.stages.find((s) => s.id === stage.id)!;
      expect(stage.requiredArtifacts).toEqual(declared.requiredArtifacts);
      // a requiredArtifact that names its own key must equal that key's label
      for (const b of declared.blockers) {
        const only = (b.artifacts ?? []).length === 1 && (declared.blockers.filter((x) => (x.artifacts ?? []).includes(b.artifacts![0]!)).length === 1);
        if (only && labels.has(declared.requiredArtifacts[b.artifacts![0]!]!)) expect<string>(BLOCKER_LABELS[b.key as BlockerKey]).toBe(declared.requiredArtifacts[b.artifacts![0]!]!);
      }
    }
  });
});

describe("i18n (processBlockers.*)", () => {
  const catalogKey = (k: string) => k.replace(".", "_");
  test("ko and en carry exactly the registry keys", () => {
    const want = keys.map(catalogKey).sort();
    expect(Object.keys(ko.processBlockers).sort()).toEqual(want);
    expect(Object.keys(en.processBlockers).sort()).toEqual(want);
  });
  test("en text is English, ko text is Korean, both non-empty", () => {
    for (const k of keys.map(catalogKey)) {
      expect(ko.processBlockers[k]!.trim().length).toBeGreaterThan(0);
      expect(en.processBlockers[k]!.trim().length).toBeGreaterThan(0);
      expect(/[가-힣]/.test(en.processBlockers[k]!)).toBe(false);
      expect(/[가-힣]/.test(ko.processBlockers[k]!)).toBe(true);
    }
  });
  test("a stored label resolves to its catalog key", () => {
    expect(blockerMessageKey("시너지 평가")).toBe("processBlockers.s3_synergy_assessment");
    expect(blockerMessageKey("검토한 대안", "S5")).toBe("processBlockers.s5_alternatives_considered");
    expect(blockerMessageKey("free text")).toBeUndefined();
    expect(en.processBlockers[blockerMessageKey("시너지 평가")!.split(".")[1]!]).toBe("Synergy assessment");
  });
});

describe("flow.spec 2.16.0 blockers declaration", () => {
  test("version and shape: every stage declares blockers; indices are in range; keys carry the stage prefix", () => {
    expect(spec.meta.version).toBe("2.16.0");
    for (const s of spec.stages) {
      expect(Array.isArray(s.blockers) && s.blockers.length > 0).toBe(true);
      for (const b of s.blockers) {
        expect(b.key.startsWith(`${s.id.toLowerCase()}.`)).toBe(true);
        for (const i of b.artifacts ?? []) expect(i).toBeLessThan(s.requiredArtifacts.length);
        for (const i of b.criteria ?? []) expect(i).toBeLessThan(s.completionCriteria.length);
      }
    }
  });
  test("the declared key set is exactly the registry", () => {
    const declared = spec.stages.flatMap((s) => s.blockers.map((b) => b.key)).sort();
    expect(declared).toEqual([...keys].sort());
  });
  test("the only unblocked requiredArtifact is the S12 baseline-variance report (advisory)", () => {
    const unblocked = spec.stages.flatMap((s) => s.requiredArtifacts.map((_, i) => [s.id, i] as const).filter(([, i]) => !s.blockers.some((b) => (b.artifacts ?? []).includes(i))));
    expect(unblocked).toEqual([["S12", 3]]);
    expect(spec.stages.find((s) => s.id === "S12")!.nonBlockingArtifacts).toEqual([3]);
  });
});

describe("capability register lead (D5)", () => {
  const opp = (): string => {
    const id = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [id, "o", "t", "selected", "u", new Date().toISOString()]);
    return id;
  };
  const route = (o: string, track: string, at: string) =>
    db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), o, track, "t", "u", at]);
  test("greenfield-agent before S4 and for a greenfield route; brownfield-agent once the latest route is brownfield", () => {
    const a = opp();
    expect(capabilityRegisterLead(db, a)).toBe("greenfield-agent");
    route(a, "greenfield", "2026-10-28T00:00:00.000Z");
    expect(capabilityRegisterLead(db, a)).toBe("greenfield-agent");
    db.run("UPDATE route_decision SET is_current = 0 WHERE opportunity_id = ?", [a]);
    route(a, "brownfield", "2026-10-29T00:00:00.000Z");
    expect(capabilityRegisterLead(db, a)).toBe("brownfield-agent");
  });
  test("the prompt catalog binds s3.capability_gap_draft to the greenfield lead's activity, which flow.spec defines", async () => {
    const { PM_CATALOG } = await import("../../app/web-next/lib/pm-catalog.generated.ts");
    const entry = (PM_CATALOG as Record<string, { agentKey: string; activityId: string; stageId: string }>)["s3.capability_gap_draft"]!;
    expect(entry).toMatchObject({ agentKey: "greenfield-agent", activityId: "capability-register-greenfield", stageId: "S3" });
  });
});
