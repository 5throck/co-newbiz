// Spec 2026-11-07-review-internal-items — system-internal items stay off the
// human decision surface. LLM is ALWAYS mocked; the DB is a throwaway sqlite file.
import { test, expect, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-review-internal-items.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { findReview } = await import("../../db/repositories/review.repository.ts");
const { buildGateArtifact, sanitizeContentForReview } = await import("../../app/web-next/lib/review/gate-artifacts.ts");
const { runAiSecond, ai2ndPayloadContent, buildAi2ndMessages } = await import(
  "../../app/web-next/lib/review/ai-second.ts"
);
const { getArtifactReviewView } = await import("../../app/web-next/lib/review/engine.ts");
const {
  PROVENANCE_CODES,
  filterInternalItems,
  isInternalPlumbingItem,
  ensureCouldNotVerify,
  SOURCES_NOT_INSPECTED_ITEM,
  reclassifyLegacyProvenance,
} = await import("../../app/web-next/lib/review/internal-item-filter.ts");
const { resolveKeyedItem } = await import("../../app/web-next/lib/review/review-display.ts");
import type { Ai2ndDeps } from "../../app/web-next/lib/review/ai-second.ts";
import type { ReviewBuckets } from "../../db/repositories/review.repository.ts";

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = new Date().toISOString();
const USER = "reviewer-human";
const ULID_ID = "01M6JN4YGJXD0BYT7DFH9MWKQ0";

function newOpp(): string {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [
    id,
    `opp-${id.slice(-5)}`,
    "assessed",
    "test",
    NOW,
  ]);
  return id;
}
const CLEAN: ReviewBuckets = {
  verified: [],
  could_not_verify: [{ claim: "Accuracy not examined", reason: "structure only" }],
  needs_judgement: [],
};
const replyDeps = (reply: unknown): Ai2ndDeps => ({
  complete: async () => JSON.stringify(reply),
  isConfigured: () => true,
  modelId: () => "mock-model",
});

// The three strings reported on /deals/[id]/s3.
const REPORTED = [
  { claim: `entity_id ${ULID_ID.slice(0, 4)}..., track field is null`, reason: "Is this intended or a missing-data error?" },
  { claim: "Allow the gate to proceed with track unset?", reason: "The track field has no value." },
  { claim: "The coordinating agent was excluded from author-domain judgement.", reason: "Orchestrator has no review domain." },
];

describe("post-filter (design 3.4)", () => {
  test("the three reported strings are dropped", () => {
    for (const it of REPORTED) expect(isInternalPlumbingItem(it), it.claim).toBe(true);
    expect(isInternalPlumbingItem({ claim: `entity_id ${ULID_ID} track is null`, reason: "intended?" })).toBe(true);
  });

  test("dropped items are recorded as filtered_internal_item provenance with their original text", () => {
    const { buckets, dropped } = filterInternalItems({
      verified: [],
      could_not_verify: [REPORTED[0]!],
      needs_judgement: [REPORTED[1]!, REPORTED[2]!, { claim: "Attractiveness weighting", reason: "growth vs risk" }],
    });
    expect(buckets.could_not_verify).toHaveLength(0);
    expect(buckets.needs_judgement.map((i) => i.claim)).toEqual(["Attractiveness weighting"]);
    expect(dropped).toHaveLength(3);
    expect(dropped.every((d) => d.code === PROVENANCE_CODES.filteredInternalItem)).toBe(true);
    expect(dropped[0]!.params).toMatchObject({ bucket: "could_not_verify", claim: REPORTED[0]!.claim });
    expect(dropped[1]!.params).toMatchObject({ bucket: "needs_judgement", claim: REPORTED[1]!.claim });
  });

  test("items mixing an identifier with deal content are kept", () => {
    const keep = [
      { claim: `entity_id ${ULID_ID}: revenue forecast missing`, reason: "No evidence for the demand estimate." },
      { claim: "track field is null", reason: "The market entry route (500 million KRW capex) depends on it." },
      { claim: "Allow the gate to proceed with track unset?", reason: "Regulatory permit risk differs by route." },
      { claim: "Track record of the target company", reason: "Management track record is unverified." },
      { claim: "Source accuracy", reason: "no source documents were provided" },
    ];
    for (const it of keep) expect(isInternalPlumbingItem(it), it.claim).toBe(false);
    // a verified item is dropped only when it is purely about identifiers / schema fields
    const realVerified = { claim: "S1 stage is complete with all 3 required artifacts", reason: "status: complete, blockers: []" };
    const out = filterInternalItems({ verified: [realVerified], could_not_verify: [], needs_judgement: [] });
    expect(out.buckets.verified).toEqual([realVerified]);
    expect(out.dropped).toHaveLength(0);
    const dealVerified = { claim: `entity_id ${ULID_ID} revenue is stated`, reason: "market size figure present" };
    expect(filterInternalItems({ verified: [dealVerified], could_not_verify: [], needs_judgement: [] }).dropped).toHaveLength(0);
  });

  test("never-empty could_not_verify invariant", () => {
    const emptied = filterInternalItems({ verified: [], could_not_verify: [REPORTED[0]!], needs_judgement: [] });
    expect(emptied.buckets.could_not_verify).toHaveLength(0);
    const fixed = ensureCouldNotVerify(emptied.buckets.could_not_verify, SOURCES_NOT_INSPECTED_ITEM);
    expect(fixed).toHaveLength(1);
    expect(fixed[0]!.claim).toBe(SOURCES_NOT_INSPECTED_ITEM.claim);
    expect(resolveKeyedItem(fixed[0]!)?.messageId).toBe("review.ai2.sourcesNotInspected");
    const keepsReal = ensureCouldNotVerify([{ claim: "c", reason: "r" }], SOURCES_NOT_INSPECTED_ITEM);
    expect(keepsReal).toEqual([{ claim: "c", reason: "r" }]);
  });
});

describe("payload sanitizing (design 3.1)", () => {
  const stage = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    status,
    required_artifacts: [],
    blockers: [],
    missing_artifacts: [],
    ...extra,
  });

  test("opaque ids are omitted; stage ids stay; stored content is not mutated", () => {
    const content = {
      gate: "screening",
      entity_type: "opportunity",
      entity_id: ULID_ID,
      run_id: ulid(),
      track: null,
      stages: [stage("S1", "complete")],
    };
    const before = JSON.stringify(content);
    const out = ai2ndPayloadContent(content);
    expect(JSON.stringify(out)).not.toContain(ULID_ID);
    expect(out).not.toHaveProperty("entity_id");
    expect(out).not.toHaveProperty("run_id");
    expect(out.entity_type).toBe("opportunity");
    expect((out.stages as Array<{ id: string }>)[0]!.id).toBe("S1");
    expect(JSON.stringify(content)).toBe(before);
  });

  test("a null track before the S4 route decision is annotated", () => {
    const pending = sanitizeContentForReview({
      gate: "screening",
      track: null,
      stages: [stage("S3", "complete"), stage("S4", "current")],
    });
    expect(pending.track).toBe("not yet decided — set at the S4 route decision");
    const notReached = sanitizeContentForReview({
      gate: "screening",
      track: null,
      stages: [stage("S3", "complete"), stage("S4", "locked", { not_reached: true })],
    });
    expect(String(notReached.track)).toContain("not yet decided");
    const stageArtifact = sanitizeContentForReview({ kind: "stage-artifact", stage: "S2", track: null });
    expect(String(stageArtifact.track)).toContain("S4");
  });

  test("after S4 (or beyond the gate span) a null track stays null; real values are untouched", () => {
    const after = sanitizeContentForReview({
      gate: "screening",
      track: null,
      stages: [stage("S3", "complete"), stage("S4", "complete")],
    });
    expect(after.track).toBeNull();
    const beyond = sanitizeContentForReview({ gate: "fs", track: null, stages: [stage("S8", "current")] });
    expect(beyond.track).toBeNull();
    const project = sanitizeContentForReview({ kind: "stage-artifact", stage: "S9", track: null });
    expect(project.track).toBeNull();
    const set = sanitizeContentForReview({ gate: "screening", track: "greenfield", stages: [stage("S4", "current")] });
    expect(set.track).toBe("greenfield");
    // other nulls pass through unannotated
    const other = sanitizeContentForReview({ gate: "screening", sub_track: null, stages: [stage("S4", "current")] });
    expect(other.sub_track).toBeNull();
  });

  test("the prompt carries the no-plumbing rule and the real artifact payload has no ULID", () => {
    const artifact = buildGateArtifact("screening", newOpp());
    const [sys, user] = buildAi2ndMessages(artifact, "platform-lead", "technical", "functional");
    expect(sys!.content).toContain("Do not raise items about system identifiers");
    expect(sys!.content).toContain("reviewer routing and agent assignment");
    expect(user!.content).not.toContain(artifact.entityId);
    expect(user!.content).toContain("not yet decided");
  });
});

describe("runAiSecond persistence", () => {
  test("routing claims go to provenance, plumbing items are filtered, could_not_verify is never empty", async () => {
    const artifact = buildGateArtifact("screening", newOpp());
    const out = await runAiSecond(
      { artifact, ai1stBuckets: CLEAN, userId: USER, db },
      replyDeps({
        verified: [{ claim: "Stage S1 records exist", reason: "listed in artifact", evidence_ref: "stage:S1" }],
        could_not_verify: [REPORTED[0]!],
        needs_judgement: [REPORTED[1]!, { claim: "Attractiveness weighting", reason: "trade-off between growth and risk" }],
      }),
    );
    expect(out.performed).toBe(true);
    expect(out.buckets.could_not_verify.length).toBeGreaterThan(0);
    expect(out.buckets.could_not_verify[0]!.claim).toBe(SOURCES_NOT_INSPECTED_ITEM.claim);
    expect(out.buckets.needs_judgement.map((i) => i.claim)).toEqual(["Attractiveness weighting"]);
    const prov = out.buckets.provenance ?? [];
    expect(prov.filter((p) => p.code === "filtered_internal_item")).toHaveLength(2);
    // no routing claim ever lands in a decision bucket
    const all = [...out.buckets.could_not_verify, ...out.buckets.needs_judgement, ...out.buckets.verified];
    expect(all.some((i) => /fallback routing|Orchestrator agents|could not be resolved/.test(i.claim))).toBe(false);

    const row = findReview("ai_2nd", "opportunity", artifact.entityId, artifact.artifactKey, artifact.contentHash, db)!;
    const stored = JSON.parse(row.buckets_json!) as ReviewBuckets;
    expect(stored.provenance).toEqual(prov);
    expect(JSON.parse(row.unverified_items_json)).toEqual(stored.could_not_verify);

    const view = getArtifactReviewView(artifact, db);
    expect(view.ai_2nd!.provenance).toEqual(prov);
    expect(view.ai_1st).toBeNull();
  });

  test("a clean reply keeps its own could_not_verify and records no filtered provenance", async () => {
    const artifact = buildGateArtifact("screening", newOpp());
    const out = await runAiSecond(
      { artifact, ai1stBuckets: CLEAN, userId: USER, db },
      replyDeps({
        verified: [],
        could_not_verify: [{ claim: "Source accuracy", reason: "no source documents were provided" }],
        needs_judgement: [],
      }),
    );
    expect(out.buckets.could_not_verify.map((i) => i.claim)).toEqual(["Source accuracy"]);
    expect((out.buckets.provenance ?? []).some((p) => p.code === "filtered_internal_item")).toBe(false);
  });
});

describe("legacy reclassification (design 3.5)", () => {
  const legacy: ReviewBuckets = {
    verified: [],
    could_not_verify: [
      { claim: "Source accuracy", reason: "no source documents were provided", key: "review.ai2.freeText" },
      {
        claim: "Reviewer chosen by fallback routing, not by a cross-validation matrix entry",
        reason:
          "no matrix entry for artifact type 'bundle' x author domain 'functional'; default cross-domain lead platform-lead reviewed. Specialist industry-lead is same-domain (first stage only).",
      },
      {
        claim: "Orchestrator agents excluded from the author-domain check",
        reason:
          "pm, platform-lead: no review domain by explicit matrix exemption; the artifact domain comes from the other authoring agents.",
      },
      {
        claim: "Domain of some authoring agents could not be resolved",
        reason: "Excluded from the cross-domain check: ghost-agent.",
      },
    ],
    needs_judgement: [REPORTED[0]!, REPORTED[1]!, REPORTED[2]!, { claim: "Attractiveness weighting", reason: "growth vs risk" }],
  };

  test("known routing claims (en, no key) move to provenance; legacy plumbing LLM items are filtered with legacy:true", () => {
    const out = reclassifyLegacyProvenance(legacy);
    expect(out.could_not_verify.map((i) => i.claim)).toEqual(["Source accuracy"]);
    expect(out.needs_judgement.map((i) => i.claim)).toEqual(["Attractiveness weighting"]);
    const filteredProv = out.provenance!.filter((p) => p.code === "filtered_internal_item");
    expect(filteredProv).toHaveLength(3);
    expect(filteredProv.every((p) => p.params.legacy === true && p.params.bucket === "needs_judgement")).toBe(true);
    expect(filteredProv.map((p) => p.params.claim)).toEqual(REPORTED.map((r) => r.claim));
    expect(out.provenance!.slice(0, 3).map((p) => p.code)).toEqual([
      "fallback_reviewer",
      "orchestrator_exempt",
      "unresolved_agent",
    ]);
    expect(out.provenance![0]!.params).toMatchObject({
      reviewerAgent: "platform-lead",
      specialist: "industry-lead",
      legacy: true,
    });
    expect(out.provenance![1]!.params).toMatchObject({ agents: "pm, platform-lead" });
    expect(out.provenance![2]!.params).toMatchObject({ agents: "ghost-agent" });
  });

  test("keyed rows use stored params; ko claim strings are recognized", () => {
    const out = reclassifyLegacyProvenance({
      verified: [],
      could_not_verify: [
        { claim: "x", reason: "y", key: "review.ai2.exemptAgents", params: { agents: "pm" } },
        { claim: "조정 에이전트는 작성 도메인 판단에서 제외했습니다", reason: "pm: ..." },
        { claim: "일부 작성 에이전트의 도메인을 확인하지 못했습니다", reason: "교차 도메인 검사에서 제외됨: a." },
        { claim: "검토자를 교차검증 매트릭스 항목이 아니라 대체 규칙으로 정했습니다", reason: "z" },
        { claim: "Real gap", reason: "r" },
      ],
      needs_judgement: [],
    });
    expect(out.provenance!.map((p) => p.code)).toEqual([
      "orchestrator_exempt",
      "orchestrator_exempt",
      "unresolved_agent",
      "fallback_reviewer",
    ]);
    expect(out.provenance![0]!.params.agents).toBe("pm");
    expect(out.could_not_verify.map((i) => i.claim)).toEqual(["Real gap"]);
  });

  test("never-empty after reclassification; rows without routing claims are unchanged", () => {
    const only = reclassifyLegacyProvenance({
      verified: [],
      could_not_verify: [legacy.could_not_verify[1]!, legacy.could_not_verify[2]!],
      needs_judgement: [],
    });
    expect(only.could_not_verify).toHaveLength(1);
    expect(only.could_not_verify[0]!.claim).toBe("Scope not declared in this legacy review");
    expect(resolveKeyedItem(only.could_not_verify[0]!)?.messageId).toBe("review.ai2.legacyScopeNotDeclared");
    const plumbingOnly = reclassifyLegacyProvenance({ verified: [], could_not_verify: [REPORTED[0]!], needs_judgement: [] });
    expect(plumbingOnly.could_not_verify.map((i) => i.claim)).toEqual(["Scope not declared in this legacy review"]);
    expect(plumbingOnly.provenance![0]!.params).toMatchObject({ bucket: "could_not_verify", legacy: true });
    const plain: ReviewBuckets = {
      verified: [],
      could_not_verify: [{ claim: "AI 2nd cross-domain review was not performed", reason: "x" }],
      needs_judgement: [],
    };
    const same = reclassifyLegacyProvenance(plain);
    expect(same.could_not_verify).toEqual(plain.could_not_verify);
    expect(same.provenance).toEqual([]);
  });

  test("a stored legacy row is reclassified in the API view, the stored row is untouched", () => {
    const artifact = buildGateArtifact("screening", newOpp());
    const bucketsJson = JSON.stringify(legacy);
    db.run(
      `INSERT INTO review_stage (id, run_id, stage, reviewer_agent_or_user, reviewer_domain, unverified_items_json, result, created_at,
        artifact_key, entity_type, entity_id, stage_id, content_hash, buckets_json, author_domain, model_id, cost_tokens, performed, not_performed_reason, requested_by, reviewed_refs_json)
       VALUES (?,NULL,'ai_2nd','platform-lead','technical',?,NULL,?,?,?,?,?,?,?,'functional','m',0,1,NULL,?,NULL)`,
      [
        ulid(),
        JSON.stringify(legacy.could_not_verify),
        NOW,
        artifact.artifactKey,
        artifact.entityType,
        artifact.entityId,
        artifact.stageId,
        artifact.contentHash,
        bucketsJson,
        USER,
      ],
    );
    const view = getArtifactReviewView(artifact, db);
    expect(view.ai_2nd!.could_not_verify.map((i) => i.claim)).toEqual(["Source accuracy"]);
    expect(view.ai_2nd!.needs_judgement.map((i) => i.claim)).toEqual(["Attractiveness weighting"]);
    expect(view.ai_2nd!.provenance).toHaveLength(6);
    const row = findReview("ai_2nd", "opportunity", artifact.entityId, artifact.artifactKey, artifact.contentHash, db)!;
    expect(row.buckets_json).toBe(bucketsJson);
  });
});

// Real review_stage row 01M6T67CR1NBVQPJ6BVK791BGC (opportunity 01M6JN4YGJXD0BYT7DFH9MWKQ0, ai_2nd,
// Korean-locale LLM output) read from the dev DB on 2026-11-07. The synthetic English fixtures above
// passed while the real row filtered nothing, so the real texts are pinned here.
describe("real Korean-locale row (dev DB 01M6T67CR1NBVQPJ6BVK791BGC)", () => {
  const item = (claim: string, reason: string, evidence_ref?: string) => ({
    claim,
    reason,
    ...(evidence_ref ? { evidence_ref } : {}),
    key: "review.ai2.freeText",
  });
  const plumbing = {
    verified: [
      item(
        "해당 개체는 opportunity 유형의 screening 게이트 심사 대상이다.",
        "entity_id, entity_type, gate 필드가 아티팩트에 명시되어 있다.",
        "entity_id/entity_type/gate",
      ),
    ],
    could_not_verify: [
      item(`entity_id ${ULID_ID}가 실제 기회 개체와 일치하는지 여부`, "개체 원장과의 대조가 불가능하다."),
      item("track 필드가 null인 것이 의도된 것인지, 누락 오류인지 여부", "아티팩트에 track 관련 근거 설명이 없다."),
    ],
    needs_judgement: [
      item(
        "track 미지정 상태로 게이트 진행을 허용할지 여부",
        "track이 null이지만 단계는 complete로 기록되어 있어, 트랙 지연이 후속 게이트에 미치는 영향은 인간 판단이 필요하다.",
        "track",
      ),
    ],
  };
  const real = {
    verified: [
      item("S1(시장분석) 단계의 상태가 complete이며 필수 아티팩트 3건(시장 규모·성장 추정, 경쟁 구조, 가치사슬 구조)이 모두 충족되었다.", "아티팩트에 S1 status: complete, blockers: [], missing_artifacts: []로 명시되어 있다.", "stages[id=S1]"),
      item("모든 단계에 차단 요인(blocker)이 없다.", "S1~S3 모두 blockers 배열이 비어 있다.", "stages[*].blockers"),
    ],
    could_not_verify: [
      item("각 필수 아티팩트의 실제 내용 품질(시장 추정 방법론, 경쟁 분석 깊이, 시너지 점수 산정 근거 등)", "아티팩트는 아티팩트 존재 여부와 상태만 기록하며, 원문 아티팩트 내용이 포함되어 있지 않아 기술적 타당성을 검증할 수 없다."),
      item("기회 등록에 기재된 가치사슬 노드·매력도 및 진입시장 산정의 정확성", "S2 아티팩트 원문이 없어 링크·범위·도출 사슬의 실제 내용을 확인할 수 없다."),
    ],
    needs_judgement: [
      item("screening 게이트에서 시너지 점수(전략적 적합성 판단)가 기술·플랫폼 관점에서 충분히 검토되었는지 여부", "시너지 평가 결과의 내용이 없어 기술적 실현 가능성·플랫폼 적합성에 대한 인간 판단이 필요하다.", "stages[id=S3].required_artifacts"),
    ],
  };
  const orchestrator = {
    claim: "Orchestrator agents excluded from the author-domain check",
    reason: "pm: no review domain by explicit matrix exemption; the artifact domain comes from the other authoring agents.",
    key: "review.ai2.exemptAgents",
    params: { agents: "pm" },
  };
  const row: ReviewBuckets = {
    verified: [...real.verified, ...plumbing.verified],
    could_not_verify: [...real.could_not_verify, ...plumbing.could_not_verify, orchestrator],
    needs_judgement: [...real.needs_judgement, ...plumbing.needs_judgement],
  };

  test("every plumbing item is dropped, every deal item is kept (read-time, legacy:true)", () => {
    const out = reclassifyLegacyProvenance(row);
    expect(out.verified.map((i) => i.claim)).toEqual(real.verified.map((i) => i.claim));
    expect(out.could_not_verify.map((i) => i.claim)).toEqual(real.could_not_verify.map((i) => i.claim));
    expect(out.needs_judgement.map((i) => i.claim)).toEqual(real.needs_judgement.map((i) => i.claim));
    const filtered = out.provenance!.filter((p) => p.code === "filtered_internal_item");
    expect(filtered.map((p) => p.params.claim)).toEqual([
      plumbing.verified[0]!.claim,
      plumbing.could_not_verify[0]!.claim,
      plumbing.could_not_verify[1]!.claim,
      plumbing.needs_judgement[0]!.claim,
    ]);
    expect(filtered.every((p) => p.params.legacy === true)).toBe(true);
    expect(out.provenance!.some((p) => p.code === "orchestrator_exempt")).toBe(true);
    // stored shape is untouched (pure function, input not mutated)
    expect(row.could_not_verify).toHaveLength(real.could_not_verify.length + 3);
  });

  test("each real item matches the predicate individually", () => {
    for (const it of [...plumbing.verified, ...plumbing.could_not_verify, ...plumbing.needs_judgement])
      expect(isInternalPlumbingItem(it), it.claim).toBe(true);
    for (const it of [...real.verified, ...real.could_not_verify, ...real.needs_judgement])
      expect(isInternalPlumbingItem(it), it.claim).toBe(false);
  });
});
