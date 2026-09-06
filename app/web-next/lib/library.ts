// Governance library index — surfaces every documentation artifact that
// lives as a file in the repo (policies, procedures, checklists, manuals,
// reference docs, templates, design guide, DD methodology) so there is
// exactly one live-read screen instead of a second, separately-built static
// site (ADR-0108 supersedes ADR-0107's three-surface split). Read-only: the
// files on disk are the system of record; this module only indexes and
// serves them. Frontmatter is parsed with a small line scanner instead of a
// YAML dependency for flat top-level keys; procedures are shown as raw YAML
// text (same treatment checklists already got) rather than a bespoke
// step-table renderer.
import * as fs from "node:fs";
import path from "node:path";

export type LibraryCategory = "checklist" | "manual" | "policy" | "procedure" | "reference" | "template" | "design" | "dd";

export interface LibraryDocSummary {
  id: string;
  category: LibraryCategory;
  title: string;
  file: string;
  gate?: string;
  enforceability?: string;
  version?: string;
  owner_agent?: string;
  item_count?: number;
  // 단일 파일 문서는 그 내용 언어를, md 문서는 ko/en 페어 중 자기 파일의 언어를 표시한다.
  lang: "en" | "ko";
}

export interface LibraryDocContent extends LibraryDocSummary {
  content: string;
}

function repoRoot(): string {
  // web-next runs with cwd = app/web-next; the repo root is two levels up.
  // Walk up defensively so a different cwd (next start, tests) still resolves.
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "checklists")) && fs.existsSync(path.join(dir, "policies"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function readText(file: string): string {
  // Normalize CRLF — repo files on Windows carry \r\n, which would break the
  // frontmatter strip and inline parsing.
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function frontmatterField(text: string, key: string): string | undefined {
  // Flat top-level `key: value` before the first bare `items:`/blank-line body.
  // Trailing `# comment` is not part of the value.
  const match = text.match(new RegExp(`^${key}:\\s*"?([^"#\\n]*?)"?\\s*(?:#.*)?$`, "m"));
  return match ? match[1].trim() : undefined;
}

function firstHeading(text: string): string | undefined {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

function listYaml(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))
      .sort();
  } catch {
    return [];
  }
}

function listMd(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

function listMdRecursive(dir: string, relPrefix = ""): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(relPrefix + entry.name);
    } else if (entry.isDirectory()) {
      out.push(...listMdRecursive(path.join(dir, entry.name), `${relPrefix}${entry.name}/`));
    }
  }
  return out.sort();
}

function checklists(): LibraryDocSummary[] {
  const root = repoRoot();
  return listYaml(path.join(root, "checklists")).map((file) => {
    const text = readText(path.join(root, "checklists", file));
    return {
      id: `chk-${file.replace(/\.yaml$/, "")}`,
      category: "checklist" as const,
      title: frontmatterField(text, "title") ?? file.replace(/\.yaml$/, ""),
      file: `checklists/${file}`,
      gate: frontmatterField(text, "gate"),
      enforceability: frontmatterField(text, "enforceability"),
      version: frontmatterField(text, "version"),
      owner_agent: frontmatterField(text, "owner_agent"),
      item_count: (text.match(/^\s+- id:/gm) ?? []).length,
      lang: "en" as const,
    };
  });
}

function manuals(): LibraryDocSummary[] {
  const root = repoRoot();
  return listMd(path.join(root, "docs", "manuals")).map((file) => {
    const ko = file.endsWith("_ko.md");
    return {
      id: `man-${file.replace(/\.md$/, "")}`,
      category: "manual" as const,
      title: firstHeading(readText(path.join(root, "docs", "manuals", file))) ?? file,
      file: `docs/manuals/${file}`,
      lang: (ko ? "ko" : "en") as "ko" | "en",
    };
  });
}

function policies(): LibraryDocSummary[] {
  const root = repoRoot();
  return listMdRecursive(path.join(root, "policies")).map((rel) => {
    const text = readText(path.join(root, "policies", rel));
    const stem = rel.replace(/\.md$/, "");
    return {
      id: `pol-${stem.replace(/[/.]/g, "-")}`,
      category: "policy" as const,
      title: firstHeading(text) ?? rel,
      file: `policies/${rel}`,
      lang: (/_ko\.md$/.test(rel) ? "ko" : "en") as "ko" | "en",
    };
  });
}

// ── Curated file lists ───────────────────────────────────────────────────
// procedures/reference/templates are hand-picked files, not "every file in a
// directory" (unlike checklists/manuals/policies above) — the same curated
// mapping the retired static portal used (knowledge-hub/scripts/generate-portal.ts
// SECTIONS registry), kept here as the single place that owns it now.

interface CuratedDoc { slug: string; title: string; file: string; stage?: string; lang: "en" | "ko" }

const PROCEDURE_DOCS: CuratedDoc[] = [
  { stage: "S1~S3", slug: "greenfield-screening", title: "그린필드 스크리닝", file: "procedures/_shared/greenfield-screening/schema.yaml", lang: "ko" },
  { stage: "S1~S3", slug: "brownfield-screening", title: "브라운필드 스크리닝", file: "procedures/_shared/brownfield-screening/schema.yaml", lang: "ko" },
  { stage: "S3", slug: "company-profile-analysis", title: "기업 프로필 분석", file: "procedures/_shared/company-profile-analysis/schema.yaml", lang: "ko" },
  { stage: "S4", slug: "greenfield-pre-fs", title: "그린필드 Pre-FS", file: "procedures/_shared/greenfield-pre-fs/schema.yaml", lang: "ko" },
  { stage: "S4", slug: "brownfield-pre-fs", title: "브라운필드 Pre-FS", file: "procedures/_shared/brownfield-pre-fs/schema.yaml", lang: "ko" },
  { stage: "S4", slug: "deal-shape-chain", title: "딜 셰이프 체인", file: "procedures/_shared/deal-shape-chain/schema.yaml", lang: "ko" },
  { stage: "S5", slug: "greenfield-capability-assessment", title: "그린필드 역량 평가", file: "procedures/_shared/greenfield-capability-assessment/schema.yaml", lang: "ko" },
  { stage: "S6", slug: "brownfield-target-identification", title: "브라운필드 대상 후보 발굴", file: "procedures/_shared/brownfield-target-identification/schema.yaml", lang: "ko" },
  { stage: "S7", slug: "brownfield-target-screening", title: "브라운필드 대상 스크리닝", file: "procedures/_shared/brownfield-target-screening/schema.yaml", lang: "ko" },
  { stage: "S8", slug: "greenfield-fs", title: "그린필드 FS", file: "procedures/_shared/greenfield-fs/schema.yaml", lang: "ko" },
  { stage: "S8", slug: "brownfield-fs", title: "브라운필드 FS", file: "procedures/_shared/brownfield-fs/schema.yaml", lang: "ko" },
  { stage: "S9", slug: "greenfield-dd", title: "그린필드 실사", file: "procedures/_shared/greenfield-dd/schema.yaml", lang: "ko" },
  { stage: "S9", slug: "brownfield-dd", title: "브라운필드 실사", file: "procedures/_shared/brownfield-dd/schema.yaml", lang: "ko" },
  { stage: "S10", slug: "deal-structuring", title: "투자구조 설계", file: "procedures/_shared/deal-structuring/schema.yaml", lang: "ko" },
  { stage: "S11", slug: "entity-ic-review", title: "Entity IC 심의", file: "procedures/_shared/entity-ic-review/schema.yaml", lang: "ko" },
  { stage: "S11", slug: "group-investment-review", title: "그룹 투자 심의", file: "procedures/_shared/group-investment-review/schema.yaml", lang: "ko" },
  { stage: "S11", slug: "entity-establishment-execution", title: "법인 설립 실행", file: "procedures/_shared/entity-establishment-execution/schema.yaml", lang: "ko" },
  { stage: "S11", slug: "jv-lifecycle-governance", title: "JV 라이프사이클 거버넌스", file: "procedures/_shared/jv-lifecycle-governance/schema.yaml", lang: "ko" },
  { stage: "S11", slug: "pmi-integration-execution", title: "PMI 통합 실행", file: "procedures/_shared/pmi-integration-execution/schema.yaml", lang: "ko" },
  { stage: "S12", slug: "portfolio-venture-monitoring", title: "포트폴리오 벤처 모니터링", file: "procedures/_shared/portfolio-venture-monitoring/schema.yaml", lang: "ko" },
];

const REFERENCE_DOCS: CuratedDoc[] = [
  // ko/en 페어 — 같은 slug에 lang만 다른 항목을 나열한다.
  { slug: "process-map-ko", title: "프로세스 맵", file: "docs/governance/process-map_ko.md", lang: "ko" },
  { slug: "process-map", title: "Process Map", file: "docs/governance/process-map.md", lang: "en" },
  { slug: "raci-ko", title: "RACI 매트릭스", file: "docs/governance/raci_ko.md", lang: "ko" },
  { slug: "raci", title: "RACI Matrix", file: "docs/governance/raci.md", lang: "en" },
  { slug: "governance-operations-ko", title: "거버넌스 운영", file: "docs/governance/governance-operations_ko.md", lang: "ko" },
  { slug: "governance-operations", title: "Governance Operations", file: "docs/governance/governance-operations.md", lang: "en" },
  { slug: "ops-cadence-ko", title: "운영 주기", file: "docs/governance/ops-cadence_ko.md", lang: "ko" },
  { slug: "ops-cadence", title: "Operating Cadence", file: "docs/governance/ops-cadence.md", lang: "en" },
  { slug: "phase-definitions-ko", title: "단계 정의", file: "docs/phase-definitions_ko.md", lang: "ko" },
  { slug: "phase-definitions", title: "Stage Definitions", file: "docs/phase-definitions.md", lang: "en" },
  { slug: "rag-framework-ko", title: "RAG 프레임워크", file: "docs/governance/rag-framework_ko.md", lang: "ko" },
  { slug: "rag-framework", title: "RAG Framework", file: "docs/governance/rag-framework.md", lang: "en" },
  { slug: "security-model-ko", title: "보안 모델", file: "docs/security/security-model_ko.md", lang: "ko" },
  { slug: "security-model", title: "Security Model", file: "docs/security/security-model.md", lang: "en" },
  { slug: "security-baseline-ko", title: "보안 베이스라인", file: "docs/security/security-baseline_ko.md", lang: "ko" },
  { slug: "security-baseline", title: "Security Baseline", file: "docs/security/security-baseline.md", lang: "en" },
  { slug: "runbook-deployment-ko", title: "런북 — 배포", file: "docs/runbooks/deployment_ko.md", lang: "ko" },
  { slug: "runbook-deployment", title: "Runbook — Deployment", file: "docs/runbooks/deployment.md", lang: "en" },
  { slug: "runbook-backup-restore-ko", title: "런북 — 백업·복구", file: "docs/runbooks/backup-restore_ko.md", lang: "ko" },
  { slug: "runbook-backup-restore", title: "Runbook — Backup & Restore", file: "docs/runbooks/backup-restore.md", lang: "en" },
  { slug: "guide-expert-interview-ko", title: "가이드 — 전문가 인터뷰 수행", file: "docs/guidelines/expert-interview-conduct_ko.md", lang: "ko" },
  { slug: "guide-expert-interview", title: "Guide — Conducting Expert Interviews", file: "docs/guidelines/expert-interview-conduct.md", lang: "en" },
  { slug: "guide-proxy-chain-hop-ko", title: "가이드 — 프록시 체인 홉 분류", file: "docs/guidelines/proxy-chain-hop-classification_ko.md", lang: "ko" },
  { slug: "guide-proxy-chain-hop", title: "Guide — Proxy Chain Hop Classification", file: "docs/guidelines/proxy-chain-hop-classification.md", lang: "en" },
];

const TEMPLATE_DOCS: CuratedDoc[] = [
  { slug: "ic-memo-template-ko", title: "IC 메모", file: "templates/deliverables/ic-memo-template_ko.md", lang: "ko" },
  { slug: "ic-memo-template", title: "IC Memo", file: "templates/deliverables/ic-memo-template.md", lang: "en" },
  { slug: "gate-pass-record-template-ko", title: "게이트 통과 기록", file: "templates/deliverables/gate-pass-record-template_ko.md", lang: "ko" },
  { slug: "gate-pass-record-template", title: "Gate Pass Record", file: "templates/deliverables/gate-pass-record-template.md", lang: "en" },
  { slug: "partner-dd-report-template-ko", title: "파트너 DD 리포트", file: "templates/deliverables/partner-dd-report-template_ko.md", lang: "ko" },
  { slug: "partner-dd-report-template", title: "Partner DD Report", file: "templates/deliverables/partner-dd-report-template.md", lang: "en" },
  { slug: "jv-health-scorecard-template-ko", title: "JV 헬스 스코어카드", file: "templates/deliverables/jv-health-scorecard-template_ko.md", lang: "ko" },
  { slug: "jv-health-scorecard-template", title: "JV Health Scorecard", file: "templates/deliverables/jv-health-scorecard-template.md", lang: "en" },
  { slug: "portfolio-scorecard-rollup-template-ko", title: "포트폴리오 스코어카드 롤업", file: "templates/deliverables/portfolio-scorecard-rollup-template_ko.md", lang: "ko" },
  { slug: "portfolio-scorecard-rollup-template", title: "Portfolio Scorecard Rollup", file: "templates/deliverables/portfolio-scorecard-rollup-template.md", lang: "en" },
  { slug: "venture-transition-decision-template-ko", title: "벤처 전환 결정", file: "templates/deliverables/venture-transition-decision-template_ko.md", lang: "ko" },
  { slug: "venture-transition-decision-template", title: "Venture Transition Decision", file: "templates/deliverables/venture-transition-decision-template.md", lang: "en" },
  { slug: "venture-transition-evidence-template-ko", title: "벤처 전환 증적", file: "templates/deliverables/venture-transition-evidence-template_ko.md", lang: "ko" },
  { slug: "venture-transition-evidence-template", title: "Venture Transition Evidence", file: "templates/deliverables/venture-transition-evidence-template.md", lang: "en" },
  { slug: "bau-exit-evidence-pack-template-ko", title: "BAU exit 증적 팩", file: "templates/deliverables/bau-exit-evidence-pack-template_ko.md", lang: "ko" },
  { slug: "bau-exit-evidence-pack-template", title: "BAU Exit Evidence Pack", file: "templates/deliverables/bau-exit-evidence-pack-template.md", lang: "en" },
];


const DESIGN_TITLES: Record<string, string> = {
  "design-philosophy": "디자인 철학·원칙",
  "design-tokens": "디자인 가이드 — 토큰·타이포",
  "design-components": "주요 컴포넌트 카탈로그",
  "design-screens": "표준 화면 패턴 P0~P5",
  "design-accessibility": "접근성·유니버설 디자인",
};

const DESIGN_TITLES_EN: Record<string, string> = {
  "design-philosophy": "Design Philosophy & Principles",
  "design-tokens": "Design Guide — Tokens & Typography",
  "design-components": "Component Catalog",
  "design-screens": "Standard Screen Patterns P0-P5",
  "design-accessibility": "Accessibility & UD",
};

// design-system/dd 문서는 ko(_ko.md)/en(.md) 페어 — 각 파일 frontmatter의
// `counterpart:`가 쌍대상을 가리킨다(ADR-0108 문서 언어 규약).
const DESIGN_DOCS: CuratedDoc[] = [
  { slug: "design-guide-ko", title: "디자인 가이드 — Onyx 3.0", file: "docs/design-system/design-guide_ko.md", lang: "ko" as const },
  { slug: "design-guide", title: "Design Guide — Onyx 3.0", file: "docs/design-system/design-guide.md", lang: "en" as const },
  ...["design-philosophy", "design-tokens", "design-components", "design-screens", "design-accessibility"].flatMap((slug) => [
    { slug: `${slug}-ko`, title: DESIGN_TITLES[slug]!, file: `docs/design-system/${slug}_ko.md`, lang: "ko" as const },
    { slug, title: DESIGN_TITLES_EN[slug]!, file: `docs/design-system/${slug}.md`, lang: "en" as const },
  ]),
];

const DD_TITLES: Record<string, string> = {
  "dd-overview": "DD 개요·프로세스",
  "dd-domain-guides": "도메인별 실사 가이드",
  "dd-findings": "발견사항 기록 규칙",
  "dd-tailored-checklists": "맞춤 체크리스트",
  "dd-waiver-kill": "waiver·kill criteria",
  "dd-valuation-bridge": "DD→밸류에이션 브릿지",
  "dd-best-practices": "DD 운영 모범 사례",
};

const DD_TITLES_EN: Record<string, string> = {
  "dd-overview": "DD Overview & Process",
  "dd-domain-guides": "Domain DD Guides",
  "dd-findings": "Finding Record Rules",
  "dd-tailored-checklists": "Tailored Checklists",
  "dd-waiver-kill": "Waivers & Kill Criteria",
  "dd-valuation-bridge": "DD to Valuation Bridge",
  "dd-best-practices": "DD Operating Best Practices",
};

const DD_DOCS: CuratedDoc[] = Object.keys(DD_TITLES).flatMap((slug) => [
  { slug: `${slug}-ko`, title: DD_TITLES[slug]!, file: `docs/dd/${slug}_ko.md`, lang: "ko" as const },
  { slug, title: DD_TITLES_EN[slug]!, file: `docs/dd/${slug}.md`, lang: "en" as const },
]);

function curatedMdDocs(category: LibraryCategory, idPrefix: string, list: CuratedDoc[]): LibraryDocSummary[] {
  return list.map((d) => ({
    id: `${idPrefix}-${d.slug}`,
    category,
    title: d.title,
    file: d.file,
    lang: d.lang,
  }));
}

function procedures(): LibraryDocSummary[] {
  return PROCEDURE_DOCS.map((d) => ({
    id: `proc-${d.slug}`,
    category: "procedure" as const,
    title: d.title,
    file: d.file,
    gate: d.stage,
    lang: "ko" as const,
  }));
}

const CATEGORIES: LibraryCategory[] = ["checklist", "manual", "policy", "procedure", "reference", "template", "design", "dd"];

export function listLibrary(): LibraryDocSummary[] {
  return [
    ...checklists(),
    ...manuals(),
    ...policies(),
    ...procedures(),
    ...curatedMdDocs("reference", "ref", REFERENCE_DOCS), // EN
    ...curatedMdDocs("template", "tpl", TEMPLATE_DOCS),
    ...curatedMdDocs("design", "des", DESIGN_DOCS),
    ...curatedMdDocs("dd", "dd", DD_DOCS),
  ];
}

export function getLibraryDoc(id: string): LibraryDocContent | null {
  const doc = listLibrary().find((d) => d.id === id);
  if (!doc) return null;
  const root = repoRoot();
  return { ...doc, content: readText(path.join(root, doc.file)) };
}

export function isLibraryCategory(value: string): value is LibraryCategory {
  return (CATEGORIES as string[]).includes(value);
}

// ── Checklist item extraction ────────────────────────────────────────────
// The gate checklists are flat `- id:` blocks under a top-level `items:`
// key with per-item `text` / `mandatory` / `waiver_eligible` flags. A line
// scanner covers that structure without a YAML dependency (same rationale
// as the frontmatter parser above).

export interface ChecklistItemDef {
  id: string;
  text: string;
  mandatory: boolean;
  waiver_eligible: boolean;
}

function unquote(v: string): string {
  return v.replace(/^"(.*)"$/, "$1").trim();
}

export function getChecklistItems(checklistDocId: string): ChecklistItemDef[] | null {
  const doc = listLibrary().find((d) => d.id === checklistDocId && d.category === "checklist");
  if (!doc) return null;
  const root = repoRoot();
  const text = readText(path.join(root, doc.file));
  const itemsStart = text.match(/^items:\s*$/m);
  if (!itemsStart) return [];
  const lines = text.slice((itemsStart.index ?? 0) + itemsStart[0].length).split("\n");
  const items: ChecklistItemDef[] = [];
  let current: ChecklistItemDef | null = null;
  for (const line of lines) {
    const idMatch = line.match(/^\s+- id:\s*(\S+)\s*$/);
    if (idMatch) {
      current = { id: idMatch[1], text: "", mandatory: false, waiver_eligible: false };
      items.push(current);
      continue;
    }
    // A non-indented top-level key after the items block ends it.
    if (/^\S/.test(line)) break;
    if (!current) continue;
    const field = line.match(/^\s+(text|mandatory|waiver_eligible):\s*(.*)$/);
    if (!field) continue;
    if (field[1] === "text") current.text = unquote(field[2]);
    else if (field[1] === "mandatory") current.mandatory = field[2].trim() === "true";
    else current.waiver_eligible = field[2].trim() === "true";
  }
  return items.filter((i) => i.id !== "" && i.text !== "");
}

/** DD workspace kinds → their gate-checklist doc ids. */
export const DD_WORKSPACE_CHECKLISTS: Record<string, string> = {
  commercial: "chk-commercial-dd-checklist",
  technical: "chk-technical-dd-checklist",
  legal: "chk-legal-dd-checklist",
  financial: "chk-financial-dd-checklist",
  hr: "chk-hr-dd-checklist",
  market: "chk-market-dd-checklist",
  financing: "chk-financing-plan-checklist",
};
