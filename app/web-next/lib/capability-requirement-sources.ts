// @version 1.0.0
/**
 * ADR-0172 amendment 2026-10-14 (3): evidence base of the S3 "필요 역량 제안 (AI)". The proposal used to work only
 * from a completed synergy analysis; it now also works from the S2 business-model sketch and the S1 factors /
 * opportunity fields. Each block is labelled with its source kind, which becomes the proposed row's `source`
 * (an existing GapSource value) and drives the "<origin> — …" wording of `requiredNote` (gapSourceLabel).
 * Pure helpers (the DB read is isolated in loadSynergyAreas) so the whole thing runs against fixtures in unit tests.
 */
import { ulid } from "../../../db/lib/ulid.ts";
import { gapSourceLabel, type CapabilityGapRow, type GapSource } from "./capability-gap.ts";
import { normalizeSketchV2 } from "./sketch-schema.ts";

export type RequirementSourceKind = Extract<GapSource, "synergy_area" | "s2_sketch" | "s1_factors">;
export const REQUIREMENT_SOURCE_KINDS: RequirementSourceKind[] = ["synergy_area", "s2_sketch", "s1_factors"];

export interface SourceBlock {
  kind: RequirementSourceKind;
  /** Heading shown to the LLM, e.g. "[S2 스케치]". */
  heading: string;
  text: string;
  /** Candidate capability names for the deterministic fallback. */
  names: string[];
}

export interface SynergyAreaInput { area?: string; opportunity?: string; risk?: string; shortlist?: boolean }

export interface RequirementSourceInput {
  oppName: string;
  marketScope: string | null;
  valueChainNode?: string | null;
  rationale?: string | null;
  sketchJson?: string | null;
  factorsJson?: string | null;
  synergyAreas?: SynergyAreaInput[];
}

const SOURCE_NAME: Record<RequirementSourceKind, string> = { synergy_area: "시너지 영역", s2_sketch: "S2 스케치", s1_factors: "S1 요인" };
const clip = (v: unknown, cap: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, cap);
const strList = (v: unknown, max: number, cap: number): string[] => (Array.isArray(v) ? v.map((x) => clip(typeof x === "string" ? x : (x as { text?: string })?.text, cap)).filter(Boolean).slice(0, max) : []);

/** Completed synergy analysis -> its priority areas (Short List first), same selection the route always used. */
export function parseSynergyAreas(payload: string | null | undefined): SynergyAreaInput[] {
  if (!payload) return [];
  try {
    const p = JSON.parse(payload) as {
      marketLinkage?: { synergyAreas?: Array<{ area?: string; opportunity?: string; risk?: string }> };
      shortList?: Array<{ area?: string; verdict?: string; reason?: string }>;
    };
    const short = (p.shortList ?? []).filter((s) => s.area);
    return [
      ...short.map((s) => ({ area: s.area, shortlist: Boolean(s.verdict?.includes("Short")), opportunity: (s as { opportunity?: string }).opportunity, risk: (s as { risk?: string }).risk })),
      ...(p.marketLinkage?.synergyAreas ?? []).filter((a) => a.area && !short.some((s) => s.area === a.area)).map((a) => ({ ...a, shortlist: false })),
    ].slice(0, 8);
  } catch { return []; }
}

export function loadSynergyAreas(db: { query: (sql: string) => { get: (...a: unknown[]) => unknown } }, oppId: string): SynergyAreaInput[] {
  try {
    const v = db
      .query(`SELECT v.payload FROM synergy_version v JOIN synergy_analysis sa ON sa.id = v.analysis_id
              WHERE sa.opportunity_id = ? AND sa.status = 'completed' ORDER BY v.version_no DESC LIMIT 1`)
      .get(oppId) as { payload: string } | undefined;
    return parseSynergyAreas(v?.payload);
  } catch { return []; }
}

function sketchBlock(sketchJson: string | null | undefined): SourceBlock | null {
  if (!sketchJson) return null;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(sketchJson) as Record<string, unknown>; } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const required = strList(raw.requiredCapabilities, 20, 200);
  const lines: string[] = [];
  const names = [...required];
  if (required.length > 0) lines.push(`필요 역량(스케치 기재): ${required.join(" / ")}`);
  if (raw.schema === 2) {
    const sk = normalizeSketchV2(raw);
    const blocks: Array<[string, string[]]> = [
      ["핵심 활동", sk.canvas.keyActivities.map((i) => clip(i.text, 120))],
      ["핵심 자원", sk.canvas.keyResources.map((i) => clip(i.text, 120))],
      ["핵심 파트너", sk.canvas.keyPartners.map((i) => clip(i.text, 120))],
      ["가치 제안", sk.canvas.valuePropositions.map((i) => clip(i.text, 120))],
    ];
    for (const [label, items] of blocks) if (items.length > 0) lines.push(`${label}: ${items.join(" / ")}`);
    if (names.length === 0) names.push(...sk.canvas.keyResources.map((i) => clip(i.text, 120)), ...sk.canvas.keyActivities.map((i) => clip(i.text, 120)));
  }
  if (lines.length === 0) return null;
  return { kind: "s2_sketch", heading: "[S2 비즈니스 모델 스케치]", text: lines.join("\n"), names: names.filter(Boolean).slice(0, 10) };
}

function factorsBlock(input: RequirementSourceInput): SourceBlock | null {
  let opportunity: string[] = [];
  let risk: string[] = [];
  if (input.factorsJson) {
    try {
      const f = JSON.parse(input.factorsJson) as { opportunity?: unknown; risk?: unknown };
      opportunity = strList(f.opportunity, 8, 160);
      risk = strList(f.risk, 8, 160);
    } catch { /* malformed — no factors */ }
  }
  const rationale = clip(input.rationale, 400);
  // Content test: the name / market scope alone are not evidence of what the business needs.
  if (opportunity.length === 0 && risk.length === 0 && !rationale) return null;
  const lines = [
    `기회명: ${clip(input.oppName, 120)}`,
    ...(input.marketScope?.trim() ? [`시장 범위: ${clip(input.marketScope, 120)}`] : []),
    ...(input.valueChainNode?.trim() ? [`가치사슬 노드: ${clip(input.valueChainNode, 120)}`] : []),
    ...(rationale ? [`근거: ${rationale}`] : []),
    ...(opportunity.length > 0 ? [`기회 요인: ${opportunity.join(" / ")}`] : []),
    ...(risk.length > 0 ? [`위험 요인: ${risk.join(" / ")}`] : []),
  ];
  return { kind: "s1_factors", heading: "[S1 요인·기회 정보]", text: lines.join("\n"), names: opportunity.map((o) => clip(o, 80)).slice(0, 3) };
}

/** Blocks in priority order (synergy areas, S2 sketch, S1 factors); only sources that actually have content. */
export function buildRequirementSources(input: RequirementSourceInput): SourceBlock[] {
  const out: SourceBlock[] = [];
  const areas = (input.synergyAreas ?? []).filter((a) => a.area?.trim());
  if (areas.length > 0) {
    out.push({
      kind: "synergy_area", heading: "[S3 연계 시너지 영역 — 선별 우선]",
      text: areas.map((a, i) => `${i + 1}. ${a.area}${a.shortlist ? " (선별)" : ""} — 기회: ${a.opportunity ?? "—"} · 위험: ${a.risk ?? "—"}`).join("\n"),
      names: areas.map((a) => a.area!.trim()),
    });
  }
  const sk = sketchBlock(input.sketchJson);
  if (sk) out.push(sk);
  const f = factorsBlock(input);
  if (f) out.push(f);
  return out;
}

/** "근거: 시너지 영역·S2 스케치" — which sources the proposal was based on. */
export function sourcesUsedNote(blocks: Array<Pick<SourceBlock, "kind">>): string {
  return blocks.length > 0 ? `근거: ${blocks.map((b) => SOURCE_NAME[b.kind]).join("·")}` : "";
}

/** Precise 400 text when there is neither a row nor any source. */
export const NO_REQUIREMENT_BASIS_MESSAGE =
  "제안할 근거가 없습니다 — 필요 역량 행이 없고 시너지 영역, S2 스케치, S1 요인도 비어 있습니다. 시너지 분석 실행, S2 스케치 작성 또는 S1 요인 입력 후 다시 시도하거나 행을 직접 추가하세요.";

const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
const ID_PREFIX: Record<RequirementSourceKind, string> = { synergy_area: "gap-synarea-", s2_sketch: "gap-s2sketch-", s1_factors: "gap-s1factors-" };

/** requiredNote for a proposed row: the shared origin label first ("S2 스케치에서 도출 — …"), never duplicated. */
export function sourcedRequiredNote(source: GapSource, note: string): string {
  const label = gapSourceLabel(source, true);
  const body = note.trim().replace(/\s+/g, " ");
  if (!body) return label;
  if (body.startsWith(label)) return body.slice(0, 300);
  // Synergy rows keep the model's own "시너지 영역 X에서 도출 — …" wording.
  if (source === "synergy_area" && body.startsWith("시너지 영역")) return body.slice(0, 300);
  return `${label} — ${body}`.slice(0, 300);
}

export function newGapRowFromSource(source: RequirementSourceKind, capability: string, requiredNote: string, note: string): CapabilityGapRow {
  return {
    id: `${ID_PREFIX[source]}${ulid()}`, capability: capability.trim().slice(0, 200), source,
    requiredNote: sourcedRequiredNote(source, requiredNote),
    held: { status: "unevaluated", holders: [], evidence: "" }, resolution: null,
    note, necessity: "", necessityScopeNote: "", requiredLevel: "", currentLevel: "",
  };
}

/** Deterministic no-LLM fallback: rows from the same sources (synergy areas, then sketch, then S1), deduped, at most `max`. */
export function deterministicSeedRows(blocks: SourceBlock[], existing: CapabilityGapRow[], max = 5): CapabilityGapRow[] {
  const have = new Set(existing.map((r) => norm(r.capability)));
  const out: CapabilityGapRow[] = [];
  for (const b of blocks) {
    for (const n of b.names) {
      if (out.length >= max) return out;
      const k = norm(n);
      if (!k || have.has(k)) continue;
      have.add(k);
      out.push(newGapRowFromSource(
        b.kind, n,
        `"${n.trim().slice(0, 80)}" (결정론 폴백 — 역량명은 원문을 그대로 옮긴 것이니 구체화하세요)`,
        `결정론 ${SOURCE_NAME[b.kind]} 시드 — 사람이 확인해 확정하세요.`,
      ));
    }
  }
  return out;
}

export function isRequirementSourceKind(v: unknown): v is RequirementSourceKind {
  return typeof v === "string" && (REQUIREMENT_SOURCE_KINDS as string[]).includes(v);
}
