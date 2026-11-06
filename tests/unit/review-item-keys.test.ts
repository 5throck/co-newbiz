// Fix 3 (design 2026-11-06 PR3) — locale-keyed review items.
// LLM is ALWAYS mocked; the DB is a throwaway sqlite file.
import { test, expect, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-review-item-keys.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { insertAiReview, findReview } = await import("../../db/repositories/review.repository.ts");
const { runAiFirstChecks } = await import("../../app/web-next/lib/review/ai-first.ts");
const { runAiSecond } = await import("../../app/web-next/lib/review/ai-second.ts");
import type { Ai2ndDeps } from "../../app/web-next/lib/review/ai-second.ts";
const { REVIEW_ITEM_KEYS, REVIEW_ITEM_KEY_LIST, isReviewItemKey } = await import(
  "../../app/web-next/lib/review/review-item-keys.ts"
);
const { resolveKeyedItem, localizeItem } = await import("../../app/web-next/lib/review/review-display.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = new Date().toISOString();
const USER = "reviewer-human";

db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [
  ulid(),
  "opp-keys",
  "assessed",
  "test",
  NOW,
]);

// A minimal gate artifact (shape-checked against GateArtifact) covering every
// AI 1st branch: complete, skipped, terminated, incomplete, not_reached, locked.
const ARTIFACT = {
  gate: "screening",
  artifactKey: "gate:screening",
  entityType: "opportunity",
  entityId: ulid(),
  stageId: "S1",
  authorAgents: ["market-intelligence-agent"],
  content: {},
  contentHash: "hash-keys",
  stages: [
    {
      id: "S1",
      name: "시장조사",
      status: "complete",
      required_artifacts: ["시장규모 산정"],
      blockers: [],
      missing_artifacts: [],
    },
    {
      id: "S2",
      name: "기회 발굴",
      status: "skipped",
      required_artifacts: [],
      blockers: [],
      missing_artifacts: [],
    },
    {
      id: "S3",
      name: "시너지",
      status: "terminated",
      required_artifacts: [],
      blockers: [],
      missing_artifacts: [],
    },
    {
      id: "S4",
      name: "사업계획",
      status: "current",
      required_artifacts: ["신규 사업 계획"],
      blockers: ["보완 필요: 시장 근거"],
      missing_artifacts: ["신규 사업 계획"],
    },
    {
      id: "S6",
      name: "롱리스트",
      status: "locked",
      not_reached: true,
      required_artifacts: [],
      blockers: [],
      missing_artifacts: [],
    },
    {
      id: "S7",
      name: "숏리스트",
      status: "locked",
      required_artifacts: [],
      blockers: [],
      missing_artifacts: [],
    },
  ],
} as const;

const buckets = runAiFirstChecks(ARTIFACT as unknown as Parameters<typeof runAiFirstChecks>[0]);
const allItems = [...buckets.verified, ...buckets.could_not_verify, ...buckets.needs_judgement];

describe("AI 1st key coverage", () => {
  test("every emitted item carries a catalog key and params", () => {
    expect(allItems.length).toBeGreaterThan(0);
    for (const it of allItems) {
      expect(isReviewItemKey(it.key ?? "")).toBe(true);
      expect(typeof it.claim).toBe("string");
    }
  });

  test("specific branches map to their catalog keys", () => {
    const byClaim = (sub: string) => allItems.find((i) => i.claim.includes(sub))!;
    expect(byClaim("completion predicate").key).toBe(REVIEW_ITEM_KEYS.ai1StageComplete);
    expect(byClaim("does not apply").key).toBe(REVIEW_ITEM_KEYS.ai1StageSkipped);
    expect(byClaim("was not evaluated").key).toBe(REVIEW_ITEM_KEYS.ai1StageTerminated);
    expect(byClaim("is incomplete").key).toBe(REVIEW_ITEM_KEYS.ai1StageIncomplete);
    expect(byClaim("has not been reached").key).toBe(REVIEW_ITEM_KEYS.ai1StageNotReached);
    expect(byClaim("locked behind").key).toBe(REVIEW_ITEM_KEYS.ai1StageLocked);
    expect(byClaim("gate verdict").key).toBe(REVIEW_ITEM_KEYS.ai1GateVerdict);
    expect(byClaim("Substance of").key).toBe(REVIEW_ITEM_KEYS.ai1StageSubstance);
    expect(byClaim("Accuracy, sourcing").key).toBe(REVIEW_ITEM_KEYS.ai1ContentAccuracy);
  });

  test("not_reached item keeps scope and carries stageId/stageName params", () => {
    const it = allItems.find((i) => i.scope === "not_reached")!;
    expect(it.key).toBe(REVIEW_ITEM_KEYS.ai1StageNotReached);
    expect(it.params).toEqual({ stageId: "S6", stageName: "롱리스트" });
    expect(it.structural).toBe(false);
  });

  test("catalog list is unique and complete", () => {
    expect(new Set(REVIEW_ITEM_KEY_LIST).size).toBe(REVIEW_ITEM_KEY_LIST.length);
    expect(isReviewItemKey("review.ai2.freeText")).toBe(true);
    expect(isReviewItemKey("review.nope")).toBe(false);
  });
});

describe("AI 2nd key tagging", () => {
  test("not-performed path tags the synthesized item", async () => {
    const deps = {
      isConfigured: () => false,
      modelId: () => null,
      complete: async () => {
        throw new Error("must not be called");
      },
    } as unknown as Ai2ndDeps;
    const structuralAi1st = {
      verified: [],
      could_not_verify: [
        {
          claim: "Stage S4 (사업계획) is incomplete",
          reason: "Completion predicate not satisfied.",
          structural: true,
          key: REVIEW_ITEM_KEYS.ai1StageIncomplete,
          params: { stageId: "S4", stageName: "사업계획" },
        },
      ],
      needs_judgement: [],
    };
    const res = await runAiSecond(
      {
        artifact: ARTIFACT as unknown as Parameters<typeof runAiSecond>[0]["artifact"],
        ai1stBuckets: structuralAi1st,
        userId: USER,
        db,
        now: NOW,
      },
      deps,
    );
    expect(res.performed).toBe(false);
    const item = res.buckets.could_not_verify[0]!;
    expect(item.key).toBe(REVIEW_ITEM_KEYS.ai2NotPerformed);
    expect(item.params).toEqual({
      reason: "AI 1st found structural gaps (incomplete or locked stages); nothing worth cross-domain review yet",
    });
  });

  test("LLM free-text items are tagged review.ai2.freeText; synthesized labels keep their own keys", async () => {
    // Unconfigured-provider shortcut would skip the reviewer; force the
    // performed path with a valid structured reply and a passing reviewer
    // selection by using the real selectReviewer (authorAgents resolve).
    const ai1stClean = {
      verified: [],
      could_not_verify: [],
      needs_judgement: [],
    };
    const deps = {
      isConfigured: () => true,
      modelId: () => "test-model",
      completeStructured: async () => ({
        value: {
          verified: [{ claim: "Records exist", reason: "listed in artifact" }],
          could_not_verify: [{ claim: "Source accuracy", reason: "no sources provided" }],
          needs_judgement: [{ claim: "Weighting", reason: "trade-off" }],
        },
        tokens: 100,
      }),
    } as unknown as Ai2ndDeps;
    const res = await runAiSecond(
      {
        artifact: {
          ...ARTIFACT,
          authorAgents: ["market-intelligence-agent"],
          entityId: ulid(),
        } as unknown as Parameters<typeof runAiSecond>[0]["artifact"],
        ai1stBuckets: ai1stClean,
        userId: USER,
        db,
        now: NOW,
      },
      deps,
    );
    expect(res.performed).toBe(true);
    for (const bucket of [res.buckets.verified, res.buckets.could_not_verify, res.buckets.needs_judgement]) {
      for (const it of bucket) expect(it.key).toBe(REVIEW_ITEM_KEYS.ai2FreeText);
    }
  });
});

describe("repository round-trip", () => {
  test("key/params survive buckets_json JSON round-trip", () => {
    const entityId = ulid();
    const id = insertAiReview({
      stage: "ai_1st",
      artifactKey: "gate:screening",
      entityType: "opportunity",
      entityId,
      stageId: "S1",
      contentHash: "hash-rt",
      performed: true,
      reviewerAgent: "none",
      authorDomain: null,
      reviewerDomain: null,
      buckets: {
        verified: [],
        could_not_verify: [
          {
            claim: "Stage S6 (롱리스트) has not been reached yet",
            reason: "The entity is still at an earlier stage.",
            structural: false,
            scope: "not_reached",
            key: REVIEW_ITEM_KEYS.ai1StageNotReached,
            params: { stageId: "S6", stageName: "롱리스트" },
          },
        ],
        needs_judgement: [],
      },
      requestedBy: USER,
      db,
      now: NOW,
    });
    const row = findReview("ai_1st", "opportunity", entityId, "gate:screening", "hash-rt", db)!;
    expect(row.id).toBe(id);
    const buckets = JSON.parse(row.buckets_json!) as {
      could_not_verify: Array<{ key?: string; params?: Record<string, unknown> }>;
    };
    expect(buckets.could_not_verify[0]!.key).toBe(REVIEW_ITEM_KEYS.ai1StageNotReached);
    expect(buckets.could_not_verify[0]!.params).toEqual({ stageId: "S6", stageName: "롱리스트" });
  });
});

describe("legacy rows", () => {
  test("items without key resolve to null and still localize via localizeItem", () => {
    const legacy = { claim: "Stage S4 (사업계획) is incomplete", reason: "Completion predicate not satisfied." };
    expect(resolveKeyedItem(legacy)).toBeNull();
    const loc = localizeItem(legacy);
    expect(loc.localized).toBe(true);
    expect(loc.claim).toContain("사업계획");
  });

  test("a keyed item resolves to its next-intl message id and params", () => {
    const keyed = {
      claim: "ignored",
      reason: "ignored",
      key: REVIEW_ITEM_KEYS.ai1StageNotReached,
      params: { stageId: "S6", stageName: "롱리스트" },
    };
    const res = resolveKeyedItem(keyed);
    expect(res).not.toBeNull();
    expect(res!.messageId).toBe("review.ai1.stageNotReached");
    expect(res!.params).toEqual({ stageId: "S6", stageName: "롱리스트" });
  });

  test("an unknown key (not in catalog) is treated as legacy", () => {
    expect(resolveKeyedItem({ claim: "x", reason: "y", key: "review.future.thing" })).toBeNull();
  });
});
