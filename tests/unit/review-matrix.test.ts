// Cross-validation matrix routing (ADR-0187 P4, M7/M8, decision D3 as amended by D3').
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { spawnSync } from "node:child_process";
import { AGENT_REGISTRY } from "../../app/web-next/lib/agent-registry.generated.ts";
import {
  agentDomain,
  artifactTypeFor,
  DEFAULT_REVIEWER_DOMAIN,
  MATRIX,
  selectReviewer,
  type ReviewDomain,
} from "../../app/web-next/lib/review/domains.ts";
import { STAGES } from "../../app/web-next/lib/process-flow.ts";
import { loadStageActivities } from "../../app/web-next/lib/spec-activities.ts";

const DOMAINS: ReviewDomain[] = ["functional", "technical", "industry", "region"];
const AUTHOR: Record<ReviewDomain, string> = {
  functional: "financial-analyst",
  technical: "backend-engineer",
  industry: "industry-lead",
  region: "region-lead",
};

describe("matrix content (D3)", () => {
  test("market and proxy-chain go to industry-lead; regulatory and labor to region-lead", () => {
    expect(selectReviewer([AUTHOR.functional], { artifactType: "market" })).toMatchObject({ ok: true, reviewerAgent: "industry-lead", fallbackUsed: false });
    expect(selectReviewer([AUTHOR.functional], { artifactType: "proxy_chain" })).toMatchObject({ reviewerAgent: "industry-lead" });
    expect(selectReviewer([AUTHOR.functional], { artifactType: "regulatory" })).toMatchObject({ reviewerAgent: "region-lead", fallbackUsed: false });
    expect(selectReviewer([AUTHOR.functional], { artifactType: "labor" })).toMatchObject({ reviewerAgent: "region-lead" });
  });
  test("platform-lead reviews technical artifacts only (plus the explicit multi-type bundle row)", () => {
    for (const [type, def] of Object.entries(MATRIX.artifactTypes)) {
      if (type === "technical" || type === "bundle") continue;
      expect(Object.values(def.reviewers), type).not.toContain("platform-lead");
    }
    expect(selectReviewer([AUTHOR.functional], { artifactType: "technical" })).toMatchObject({ reviewerAgent: "platform-lead" });
  });
  test("valuation and synergy (D3', 2026-10-28): industry-lead for functional/technical/region authors, region-lead for industry authors, no fallback", () => {
    for (const t of ["valuation", "synergy"]) {
      for (const d of ["functional", "technical", "region"] as ReviewDomain[]) {
        expect(selectReviewer([AUTHOR[d]], { artifactType: t }), `${t}/${d}`).toMatchObject({ ok: true, reviewerAgent: "industry-lead", fallbackUsed: false });
      }
      expect(selectReviewer([AUTHOR.industry], { artifactType: t })).toMatchObject({ ok: true, reviewerAgent: "region-lead", fallbackUsed: false });
      // risk-officer stays a first-stage specialist; it is never the AI-2nd reviewer.
      expect(Object.values(MATRIX.artifactTypes[t]!.reviewers)).not.toContain("risk-officer");
    }
  });
  test("an unknown artifact type uses the default lead and is labelled fallback", () => {
    const sel = selectReviewer([AUTHOR.industry], { artifactType: "no_such_type" });
    expect(sel.ok).toBe(true);
    if (sel.ok) {
      expect(sel.fallbackUsed).toBe(true);
      expect(sel.reviewerDomain).toBe(DEFAULT_REVIEWER_DOMAIN.industry);
      expect(sel.fallbackReason).toContain("no matrix entry");
    }
  });
});

describe("cross-domain is enforced (table-driven over type x author domain)", () => {
  test("the selected reviewer is never in an author's domain, with or without fallback", () => {
    for (const type of Object.keys(MATRIX.artifactTypes)) {
      for (const d of DOMAINS) {
        const sel = selectReviewer([AUTHOR[d]], { artifactType: type });
        expect(sel.ok, `${type}/${d}`).toBe(true);
        if (sel.ok) {
          expect(sel.reviewerDomain, `${type}/${d}`).not.toBe(d);
          expect(agentDomain(sel.reviewerAgent), `${type}/${d}`).toBe(sel.reviewerDomain);
          if (!sel.fallbackUsed) expect(sel.fallbackReason).toBeNull();
        }
      }
    }
  });
  test("mixed-domain authors: the reviewer is outside every author domain or the review is not performed", () => {
    const sel = selectReviewer([AUTHOR.functional, AUTHOR.region], { artifactType: "regulatory" });
    if (sel.ok) for (const a of [AUTHOR.functional, AUTHOR.region]) expect(agentDomain(a)).not.toBe(sel.reviewerDomain);
    else expect(sel.reason).toContain("no cross-domain reviewer");
  });
  test("every reviewer named in the matrix is a real roster agent whose domain matches", () => {
    for (const [agent, dom] of Object.entries(MATRIX.reviewerDomains)) {
      expect(AGENT_REGISTRY.some((a) => a.key === agent), agent).toBe(true);
      expect(agentDomain(agent), agent).toBe(dom as ReviewDomain);
    }
  });
});

describe("pm exemption", () => {
  test("pm is excluded from author domains and reported as exempt, not unresolved", () => {
    const sel = selectReviewer(["pm", "financial-analyst"], { artifactType: "market" });
    expect(sel).toMatchObject({ ok: true, reviewerAgent: "industry-lead", exemptAgents: ["pm"], unresolvedAgents: [] });
  });
  test("a pm-only artifact is still not performed (never a synthesized review)", () => {
    const sel = selectReviewer(["pm"]);
    expect(sel.ok).toBe(false);
    if (!sel.ok) expect(sel.reason).toBe("reviewer domain unresolved");
  });
});

describe("stage typing and registry", () => {
  test("artifactTypeFor uses the stage default and prefix overrides", () => {
    expect(artifactTypeFor("S1", "가치사슬 구조")).toBe("proxy_chain");
    expect(artifactTypeFor("S1", "시장 규모·성장 추정")).toBe("market");
    expect(artifactTypeFor("S3", "시너지 평가")).toBe("synergy");
    expect(artifactTypeFor("S4", "법무·규제 스크리닝 판정 (chk-legal-regulatory lr-01)")).toBe("regulatory");
    expect(artifactTypeFor("S99", "x")).toBe("bundle");
  });
  test("every stage artifact of every stage resolves to a defined matrix type and a reviewer (no stage skips AI-2nd by routing)", () => {
    for (const st of STAGES) {
      const authors = loadStageActivities(st.id).map((a) => a.agent);
      for (const name of st.requiredArtifacts) {
        const type = artifactTypeFor(st.id, name);
        expect(MATRIX.artifactTypes[type], `${st.id}/${name}`).toBeDefined();
        const sel = selectReviewer(authors, { artifactType: type });
        if (!sel.ok) expect(sel.reason.length).toBeGreaterThan(0);
        else expect(sel.authorDomains).not.toContain(sel.reviewerDomain);
      }
    }
  });
  test("target_screening is a named matrix exception", () => {
    expect(MATRIX.gateExceptions).toContain("target_screening");
  });
});

describe("generated projection", () => {
  test("review-matrix.generated.ts is the up-to-date projection of the YAML", () => {
    const r = spawnSync("bun", ["scripts/co-newbiz/generate-review-matrix.ts", "--check"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
  test("YAML version equals the projection version", () => {
    const doc = load(readFileSync("process/cross-validation-matrix.yaml", "utf8")) as { version: string };
    expect(MATRIX.version).toBe(doc.version);
  });
});
