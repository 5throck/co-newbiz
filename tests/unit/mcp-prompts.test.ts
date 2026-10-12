// @version 1.0.0
/**
 * Wave M PR M-3 (ADR-0154 §7) — stage_guide_s1..s12 prompts and the
 * glossary:// / flowspec:// resources, on both transports. No database: the
 * server is wired to a recording RestPort through an in-memory MCP client.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { RestPort } from "../../mcp/co-newbiz/shared/rest-port.ts";
import type { Envelope } from "../../mcp/co-newbiz/shared/rest-client.ts";
import { buildMcpServer, type McpTransportKind } from "../../mcp/co-newbiz/registry.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");

interface SpecStage {
  id: string;
  requiredArtifacts?: string[];
  activities: Array<{ id: string; procedure: string[] }>;
}
const spec = yamlLoad(readFileSync(join(ROOT, "process", "flow.spec.yaml"), "utf8")) as { stages: SpecStage[] };

function recordingPort(): { port: RestPort; gets: string[] } {
  const gets: string[] = [];
  const reply = async <T,>(data: unknown): Promise<Envelope<T>> => ({ data: data as T, meta: {}, error: null });
  return {
    gets,
    port: {
      get: async <T,>(p: string) => {
        gets.push(p);
        return reply<T>(p === "/api/glossary" ? [{ key: "wacc", ko: "가중평균자본비용", en: "WACC", category: "financial" }] : { key: p.split("/").pop() });
      },
      post: () => reply(null),
      put: () => reply(null),
      patch: () => reply(null),
      delete: () => reply(null),
    },
  };
}

async function connect(transport: McpTransportKind, scopes?: readonly string[]) {
  const { port, gets } = recordingPort();
  const server = buildMcpServer({ transport, resolveContext: () => ({ port, scopes }) });
  const client = new Client({ name: "prompts-test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, gets };
}

const resourceText = (r: { contents: Array<{ uri: string; text?: string; blob?: string }> }): string => r.contents[0].text ?? "";
const textOf = (m: { content: { type: string; text?: string } }): string => (m.content.type === "text" ? (m.content.text ?? "") : "");

describe.each<McpTransportKind>(["stdio", "http"])("prompts and resources on %s", (transport) => {
  const scopes = transport === "http" ? ["read"] : undefined;

  test("twelve stage guides are advertised and each renders from the spec", async () => {
    const { client } = await connect(transport, scopes);
    const listed = await client.listPrompts();
    expect(listed.prompts.map((p) => p.name)).toEqual(Array.from({ length: 12 }, (_, i) => `stage_guide_s${i + 1}`));
    for (const stage of spec.stages) {
      const got = await client.getPrompt({ name: `stage_guide_${stage.id.toLowerCase()}` });
      const text = got.messages.map(textOf).join("\n");
      expect(text).toContain(`# ${stage.id} `);
      expect(text).toContain("get_procedure");
      for (const a of stage.activities) {
        expect(text).toContain(a.id);
        for (const proc of a.procedure) expect(text).toContain(proc);
      }
      for (const artifact of stage.requiredArtifacts ?? []) expect(text).toContain(artifact);
    }
    await expect(client.getPrompt({ name: "stage_guide_s13" })).rejects.toThrow();
    await client.close();
  });

  test("a guide maps activities to tools and never restates procedure steps", async () => {
    const { client } = await connect(transport, scopes);
    const s9 = textOf((await client.getPrompt({ name: "stage_guide_s9" })).messages[0]);
    expect(s9).toContain("get_project_dd_workspace"); // activity commercial/technical/legal/financial/hr/market/financing-dd
    expect(s9).toContain("propose_gate_decision");
    expect(s9).toContain("a person decides");

    // Boundary #3: no description of any step of any referenced procedure leaks into a guide.
    for (const stage of spec.stages) {
      const text = textOf((await client.getPrompt({ name: `stage_guide_${stage.id.toLowerCase()}` })).messages[0]);
      for (const key of new Set(stage.activities.flatMap((a) => a.procedure))) {
        const file = join(ROOT, "procedures", "_shared", key, "schema.yaml");
        if (!existsSync(file)) continue;
        const proc = yamlLoad(readFileSync(file, "utf8")) as { steps?: Array<{ description?: string }> };
        for (const step of proc.steps ?? []) {
          const description = String(step.description ?? "").replace(/\s+/g, " ").trim();
          if (description.length >= 40) expect(text.replace(/\s+/g, " ")).not.toContain(description.slice(0, 40));
        }
      }
    }
    await client.close();
  });

  test("flowspec:// resources serve the read-only stage slice", async () => {
    const { client } = await connect(transport, scopes);
    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri).sort()).toEqual(["flowspec://index", "glossary://index"]);
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual(["flowspec://stage/{id}", "glossary://term/{key}"]);

    const index = JSON.parse(resourceText(await client.readResource({ uri: "flowspec://index" }))) as { stages: unknown[] };
    expect(index.stages).toHaveLength(12);
    const s3 = JSON.parse(resourceText(await client.readResource({ uri: "flowspec://stage/S3" }))) as { id: string; activities: unknown[] };
    expect(s3.id).toBe("S3");
    expect(s3.activities.length).toBeGreaterThan(0);
    await expect(client.readResource({ uri: "flowspec://stage/S99" })).rejects.toThrow();
    await client.close();
  });

  test("glossary:// resources read through the same REST path as lookup_term", async () => {
    const { client, gets } = await connect(transport, scopes);
    const index = JSON.parse(resourceText(await client.readResource({ uri: "glossary://index" }))) as { data: Array<{ key: string }> };
    expect(index.data[0].key).toBe("wacc");
    const term = JSON.parse(resourceText(await client.readResource({ uri: "glossary://term/wacc" }))) as { data: { key: string } };
    expect(term.data.key).toBe("wacc");
    const viaTool = await client.callTool({ name: "lookup_term", arguments: { term: "wacc" } });
    expect(viaTool.isError).not.toBe(true);
    expect(gets).toEqual(["/api/glossary", "/api/glossary/wacc", "/api/glossary/wacc"]);
    await client.close();
  });
});

test("an http token without the read scope cannot read glossary resources", async () => {
  const { client, gets } = await connect("http", ["propose"]);
  await expect(client.readResource({ uri: "glossary://term/wacc" })).rejects.toThrow(/read/);
  expect(gets).toEqual([]);
  await client.close();
});

describe("generated projection", () => {
  test("stage-guides.generated.ts is the up-to-date regeneration of the spec", () => {
    const proc = Bun.spawnSync(["bun", join(ROOT, "scripts", "co-newbiz", "generate-spec-activities.ts"), "--check"], { cwd: ROOT });
    expect(proc.exitCode).toBe(0);
  });

});
