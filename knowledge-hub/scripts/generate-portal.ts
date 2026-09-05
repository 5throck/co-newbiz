// @version 1.0.0
// knowledge-hub 문서 포털 생성기 (ADR-0107).
//
// 원본 문서(policies/ procedures/ checklists/ docs/ templates/)를 유일한 소스로
// 삼아 정적 HTML 페이지를 파생시킨다. 원본이 권위 원본이며 포털은 2차 산출물 —
// 모든 페이지 푸터 위에 governance_doc_id·원본 상대 링크·버전·소스 SHA-256
// 단축 해시를 기계 생성으로 고정하고(수작업 입력 금지), 빌드 시 해시를
// 재계산해 sources/.hashes.json과 불일치하면 fail 한다(stale 포털 배포 차단,
// 위원회 심의 지적 #2).
//
// 사용법:
//   bun scripts/generate-portal.ts            # 파일럿 (PILOT_DOCS만 생성)
//   bun scripts/generate-portal.ts --all      # 전체 문서 생성
//   bun scripts/generate-portal.ts --check    # 해시 검증만 (생성 없이)
//
// 시각화: 절차서는 yaml steps에서 mermaid flowchart를 자동 생성한다.
// mermaid 블록은 <div class="mermaid">로 출력한다(<pre> 사용 시
// check-structure의 copy-btn 규칙과 충돌 — 위원회 심의 지적 #7) and the
// mermaid <script> tag is injected ONLY into pages that contain diagrams
// (KNOWN_SCRIPTS 오염 금지).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { load as yamlLoad } from "js-yaml";
import { marked } from "marked";

const ROOT = join(import.meta.dirname, "..", "..");
const DOCS = join(import.meta.dirname, "..", "docs");
const HASHES_FILE = join(import.meta.dirname, "..", "sources-hashes.json");

const BASE_HTML = readFileSync(join(ROOT, "skills", "handbook", "templates", "base.html"), "utf-8");

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const CHECK = args.includes("--check");

// ── 포털 문서 레지스트리 ────────────────────────────────────────────────────
// govId: 원본의 governance_doc_id / procedure_id (없으면 ref-* fallback).
// kind: procedure|checklist 는 yaml 파서, md 는 marked. titleKo는 한국어 사전
// (yaml의 영어 title 대응 — 위원회 심의 지적 #5).
type DocKind = "procedure" | "checklist" | "md";
interface DocDef { slug: string; titleKo: string; source: string; kind: DocKind }
interface SectionDef { slug: string; titleKo: string; blurb: string; docs: DocDef[] }

const SECTIONS: SectionDef[] = [
  {
    slug: "policies", titleKo: "규정집", blurb: "그룹 신규사업 정책과 법인별 추가 규정입니다.",
    docs: [
      { slug: "neb-policy", titleKo: "그룹 신규사업 검토 정책", source: "policies/group/neb-policy.md", kind: "md" },
      { slug: "ent-a-addendum", titleKo: "ent-a 법인 추가 규정", source: "policies/entities/ent-a/addendum.md", kind: "md" },
      { slug: "ent-b-addendum", titleKo: "ent-b 법인 추가 규정", source: "policies/entities/ent-b/addendum.md", kind: "md" },
    ],
  },
  {
    slug: "procedures", titleKo: "업무절차서", blurb: "스테이지별 공유 절차서입니다. procedures/*.yaml이 권위 원본입니다.",
    docs: [
      { slug: "greenfield-screening", titleKo: "그린필드 스크리닝", source: "procedures/_shared/greenfield-screening/schema.yaml", kind: "procedure" },
      { slug: "brownfield-screening", titleKo: "브라운필드 스크리닝", source: "procedures/_shared/brownfield-screening/schema.yaml", kind: "procedure" },
      { slug: "greenfield-pre-fs", titleKo: "그린필드 Pre-FS", source: "procedures/_shared/greenfield-pre-fs/schema.yaml", kind: "procedure" },
      { slug: "brownfield-pre-fs", titleKo: "브라운필드 Pre-FS", source: "procedures/_shared/brownfield-pre-fs/schema.yaml", kind: "procedure" },
      { slug: "deal-shape-chain", titleKo: "딜 셰이프 체인", source: "procedures/_shared/deal-shape-chain/schema.yaml", kind: "procedure" },
      { slug: "company-profile-analysis", titleKo: "기업 프로필 분석", source: "procedures/_shared/company-profile-analysis/schema.yaml", kind: "procedure" },
      { slug: "greenfield-capability-assessment", titleKo: "그린필드 역량 평가", source: "procedures/_shared/greenfield-capability-assessment/schema.yaml", kind: "procedure" },
      { slug: "brownfield-target-identification", titleKo: "브라운필드 대상 후보 발굴", source: "procedures/_shared/brownfield-target-identification/schema.yaml", kind: "procedure" },
      { slug: "brownfield-target-screening", titleKo: "브라운필드 대상 스크리닝", source: "procedures/_shared/brownfield-target-screening/schema.yaml", kind: "procedure" },
      { slug: "greenfield-fs", titleKo: "그린필드 FS", source: "procedures/_shared/greenfield-fs/schema.yaml", kind: "procedure" },
      { slug: "brownfield-fs", titleKo: "브라운필드 FS", source: "procedures/_shared/brownfield-fs/schema.yaml", kind: "procedure" },
      { slug: "greenfield-dd", titleKo: "그린필드 실사", source: "procedures/_shared/greenfield-dd/schema.yaml", kind: "procedure" },
      { slug: "brownfield-dd", titleKo: "브라운필드 실사", source: "procedures/_shared/brownfield-dd/schema.yaml", kind: "procedure" },
      { slug: "deal-structuring", titleKo: "투자구조 설계", source: "procedures/_shared/deal-structuring/schema.yaml", kind: "procedure" },
      { slug: "entity-ic-review", titleKo: "Entity IC 심의", source: "procedures/_shared/entity-ic-review/schema.yaml", kind: "procedure" },
      { slug: "group-investment-review", titleKo: "그룹 투자 심의", source: "procedures/_shared/group-investment-review/schema.yaml", kind: "procedure" },
      { slug: "entity-establishment-execution", titleKo: "법인 설립 실행", source: "procedures/_shared/entity-establishment-execution/schema.yaml", kind: "procedure" },
      { slug: "pmi-integration-execution", titleKo: "PMI 통합 실행", source: "procedures/_shared/pmi-integration-execution/schema.yaml", kind: "procedure" },
      { slug: "jv-lifecycle-governance", titleKo: "JV 라이프사이클 거버넌스", source: "procedures/_shared/jv-lifecycle-governance/schema.yaml", kind: "procedure" },
      { slug: "portfolio-venture-monitoring", titleKo: "포트폴리오 벤처 모니터링", source: "procedures/_shared/portfolio-venture-monitoring/schema.yaml", kind: "procedure" },
    ],
  },
  {
    slug: "checklists", titleKo: "체크리스트", blurb: "게이트 체크리스트입니다. 항목별 mandatory는 waiver 없이는 통과할 수 없습니다.",
    docs: [
      "strategic-fit-screening", "target-screening", "deal-shape-presigning", "site-selection",
      "greenfield-feasibility", "brownfield-feasibility", "commercial-dd", "technical-dd", "legal-dd",
      "financial-dd", "hr-dd", "market-dd", "financing-plan", "legal-regulatory", "ma-special-topics",
      "partnership", "rbd-technology", "entity-formation",
    ].map((n) => ({ slug: n, titleKo: "", source: `checklists/${n}-checklist.yaml`, kind: "checklist" as const })),
  },
  {
    slug: "manuals", titleKo: "업무 매뉴얼", blurb: "역할별 3분립 매뉴얼입니다(한국어판 기준).",
    docs: [
      { slug: "business-manual", titleKo: "비즈니스 매뉴얼 (analyst·IC 심사자)", source: "docs/manuals/business-manual_ko.md", kind: "md" },
      { slug: "admin-manual", titleKo: "관리자 매뉴얼", source: "docs/manuals/admin-manual_ko.md", kind: "md" },
      { slug: "operations-manual", titleKo: "운영 매뉴얼 (운영자)", source: "docs/manuals/operations-manual_ko.md", kind: "md" },
    ],
  },
  {
    slug: "reference", titleKo: "프로세스·거버넌스 참고문서", blurb: "프로세스·거버넌스·보안 운영 참조 문서입니다.",
    docs: [
      { slug: "process-map", titleKo: "프로세스 맵", source: "docs/process-map.md", kind: "md" },
      { slug: "raci", titleKo: "RACI 매트릭스", source: "docs/raci.md", kind: "md" },
      { slug: "governance-operations", titleKo: "거버넌스 운영", source: "docs/governance-operations.md", kind: "md" },
      { slug: "ops-cadence", titleKo: "운영 주기", source: "docs/ops-cadence.md", kind: "md" },
      { slug: "phase-definitions", titleKo: "단계 정의", source: "docs/phase-definitions.md", kind: "md" },
      { slug: "rag-framework", titleKo: "RAG 프레임워크", source: "docs/rag-framework.md", kind: "md" },
      { slug: "security-model", titleKo: "보안 모델", source: "docs/security-model.md", kind: "md" },
      { slug: "security-baseline", titleKo: "보안 베이스라인", source: "docs/security-baseline.md", kind: "md" },
      { slug: "runbook-deployment", titleKo: "런북 — 배포", source: "docs/runbooks/deployment.md", kind: "md" },
      { slug: "runbook-backup-restore", titleKo: "런북 — 백업·복구", source: "docs/runbooks/backup-restore.md", kind: "md" },
      { slug: "guide-expert-interview", titleKo: "가이드 — 전문가 인터뷰 수행", source: "guidelines/expert-interview-conduct.md", kind: "md" },
      { slug: "guide-proxy-chain-hop", titleKo: "가이드 — 프록시 체인 홉 분류", source: "guidelines/proxy-chain-hop-classification.md", kind: "md" },
    ],
  },
  {
    slug: "templates", titleKo: "산출물 템플릿", blurb: "심의·보고 산출물 템플릿입니다.",
    docs: [
      "ic-memo-template", "gate-pass-record-template", "partner-dd-report-template",
      "jv-health-scorecard-template", "portfolio-scorecard-rollup-template",
      "venture-transition-decision-template", "venture-transition-evidence-template",
      "bau-exit-evidence-pack-template",
    ].map((n) => ({ slug: n, titleKo: "", source: `templates/deliverables/${n}.md`, kind: "md" as const })),
  },
  {
    slug: "design", titleKo: "디자인", blurb: "디자인 철학·가이드·컴포넌트·표준 화면 패턴 종합입니다.",
    docs: [],
  },
  {
    slug: "dd", titleKo: "DD 실사", blurb: "7도메인 실사 방법론·발견사항 규칙·waiver 종합입니다.",
    docs: [],
  },
];

// 내비 그룹 — 웹앱 메뉴(ADR-0105)의 섹션 라벨 패턴을 준용한다:
// 규정·절차(판정 규칙) / 참조·가이드(수행 참조).
const NAV_GROUPS: Array<{ label: string; sections: string[] }> = [
  { label: "규정·절차", sections: ["policies", "procedures", "checklists", "dd"] },
  { label: "참조·가이드", sections: ["manuals", "reference", "templates", "design"] },
];

// 파일럿 (Phase 0 수렴 게이트): 절차서 5건만. --all 시 전체.
const PILOT = new Set(["deal-structuring", "brownfield-dd", "entity-ic-review", "greenfield-dd", "jv-lifecycle-governance"]);

// ── 원본 읽기 + 해시 ────────────────────────────────────────────────────────
function sourceHash(relPath: string): string {
  return createHash("sha256").update(readFileSync(join(ROOT, relPath))).digest("hex").slice(0, 12);
}

function readSource(relPath: string): string {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) throw new Error(`원본 없음: ${relPath}`);
  return readFileSync(abs, "utf-8");
}

function govIdOf(relPath: string, parsed: unknown): string {
  const p = parsed as { governance_doc_id?: string; procedure_id?: string } | null;
  if (p?.governance_doc_id) return p.governance_doc_id;
  if (p?.procedure_id) return p.procedure_id;
  // md frontmatter
  const raw = readSource(relPath);
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (m) {
    try {
      const fm = yamlLoad(m[1]) as { governance_doc_id?: string } | undefined;
      if (fm?.governance_doc_id) return fm.governance_doc_id;
    } catch { /* frontmatter 파싱 실패 시 fallback */ }
  }
  return `ref-${basename(relPath).replace(/\.[a-z.]+$/i, "")}`;
}

function versionOf(relPath: string, parsed: unknown): string {
  const p = parsed as { version?: string } | null;
  if (p?.version) return String(p.version);
  const raw = readSource(relPath);
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (m) {
    try {
      const fm = yamlLoad(m[1]) as { version?: string } | undefined;
      if (fm?.version) return String(fm.version);
    } catch { /* ignore */ }
  }
  return "—";
}

// ── 렌더러 ──────────────────────────────────────────────────────────────────
function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function mdToHtml(md: string): { html: string; hasMermaid: boolean } {
  const body = stripFrontmatter(md);
  // ```mermaid 블록을 <div class="mermaid">로 변환(<pre> 회피)
  let hasMermaid = false;
  const converted = body.replace(/```mermaid\n([\s\S]*?)```/g, (_m, code: string) => {
    hasMermaid = true;
    return `<div class="mermaid">${code}</div>`;
  });
  return { html: marked.parse(converted) as string, hasMermaid };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderProcedure(doc: DocDef): { html: string; hasMermaid: boolean; title: string } {
  const parsed = yamlLoad(readSource(doc.source)) as {
    title?: string; gate?: string; version?: string; steps?: Array<Record<string, unknown>>;
    outputs?: string[]; kill_criteria?: unknown[]; description?: string;
  };
  const steps = parsed.steps ?? [];
  // mermaid flowchart 자동 생성: 단계 → 게이트/에이전트/산출물
  const lines: string[] = ["flowchart TD"];
  steps.forEach((s, i) => {
    const id = String(s.id ?? i + 1);
    const agent = String(s.agent_key ?? "");
    const out = String(s.output_type ?? "");
    lines.push(`  S${i}["${i + 1}. ${agent || "step"}"]`);
    if (i + 1 < steps.length) lines.push(`  S${i} --> S${i + 1}`);
    if (out) lines.push(`  S${i} -.-> O${i}["${out}"]`);
  });
  if (steps.length === 0) lines.push('  S0["단계 정보 없음"]');
  const mermaid = lines.join("\n");

  const stepRows = steps.map((s, i) => `
      <tr>
        <td>${esc(String(s.id ?? i + 1))}</td>
        <td>${esc(String(s.gate ?? "—"))}</td>
        <td>${esc(String(s.agent_key ?? "—"))}</td>
        <td>${esc(String(s.skill_key ?? "—"))}</td>
        <td>${esc(String(s.output_type ?? "—"))}</td>
        <td>${marked.parse(String(s.description ?? "")).toString().replace(/\n/g, " ")}</td>
      </tr>`).join("\n");

  const html = `
      <p>${esc(parsed.description ?? "")}</p>
      <p>소속 게이트: ${esc(parsed.gate ?? "—")} · 단계 수: ${steps.length}건</p>
      <div class="mermaid">${mermaid}</div>
      <h2 id="steps">단계</h2>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);">
            <th style="text-align:left;padding:8px;white-space:nowrap;">#</th>
            <th style="text-align:left;padding:8px;white-space:nowrap;">게이트</th>
            <th style="text-align:left;padding:8px;white-space:nowrap;">에이전트</th>
            <th style="text-align:left;padding:8px;white-space:nowrap;">스킬</th>
            <th style="text-align:left;padding:8px;white-space:nowrap;">산출물</th>
            <th style="text-align:left;padding:8px;">설명</th>
          </tr>
        </thead>
        <tbody>${stepRows}
        </tbody>
      </table>
      ${(parsed.outputs?.length ?? 0) > 0 ? `<h2 id="outputs">산출물</h2>\n      <ul>${parsed.outputs!.map((o) => `<li>${esc(String(o))}</li>`).join("")}</ul>` : ""}`;
  return { html, hasMermaid: true, title: doc.titleKo || parsed.title || doc.slug };
}

function renderChecklist(doc: DocDef): { html: string; hasMermaid: boolean; title: string } {
  const parsed = yamlLoad(readSource(doc.source)) as {
    title?: string; items?: Array<{ id?: string; text?: string; label?: string; mandatory?: boolean; note?: string }>;
  };
  const items = parsed.items ?? [];
  const rows = items.map((it) => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:8px;">${esc(String(it.id ?? "—"))}</td>
            <td style="padding:8px;">${esc(String(it.text ?? it.label ?? "—"))}</td>
            <td style="padding:8px;">${it.mandatory ? '<span class="status-chip status-amber">필수</span>' : '<span class="status-chip status-not-started">권장</span>'}</td>
          </tr>`).join("\n");
  const html = `
      <p>필수(mandatory) 항목은 활성 waiver 없이는 게이트를 통과할 수 없습니다. 권장 항목의 부재는 사유 진술로 충분합니다. 권위 원본은 저장소의 YAML입니다.</p>
      <p><strong>항목 수</strong>: ${items.length} · 필수 ${items.filter((i) => i.mandatory).length}건</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);">
            <th style="text-align:left;padding:8px;white-space:nowrap;">ID</th>
            <th style="text-align:left;padding:8px;">항목</th>
            <th style="text-align:left;padding:8px;white-space:nowrap;">등급</th>
          </tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>`;
  return { html, hasMermaid: false, title: doc.titleKo || parsed.title || doc.slug };
}

function renderMarkdown(doc: DocDef): { html: string; hasMermaid: boolean; title: string } {
  const { html, hasMermaid } = mdToHtml(readSource(doc.source));
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return { html, hasMermaid, title: doc.titleKo || (h1 ? h1[1].replace(/<[^>]+>/g, "").trim() : doc.slug) };
}

// ── 보일러플레이트 ──────────────────────────────────────────────────────────
const NAV_ORDER = ["policies", "procedures", "checklists", "manuals", "reference", "templates", "design", "dd"];

function sidebarNav(activePath: string | null, generated: Set<string>, prefix: string): string {
  const rel = (p: string): string => prefix + p;
  const out: string[] = [`<p class="nav-section">포털</p>`, `<ul style="margin:0 0 12px;">`, `<li><a href="${rel("index.html")}"${activePath === null ? ' class="active"' : ""}>홈</a></li>`, `</ul>`];
  for (const group of NAV_GROUPS) {
    out.push(`<p class="nav-section">${esc(group.label)}</p>`);
    out.push(`<ul style="margin:0 0 12px;">`);
    for (const slug of group.sections) {
      const sec = SECTIONS.find((x) => x.slug === slug)!;
      const docs = sec.docs.filter((d) => generated.has(`${sec.slug}/${d.slug}`));
      if (docs.length === 0) {
        out.push(`<li><span style="color:var(--text-dim);cursor:default;" title="파일럿 승인 후 확장">${esc(sec.titleKo)} (확장 예정)</span></li>`);
        continue;
      }
      out.push(`<li><a href="${rel(`${sec.slug}/index.html`)}"${activePath === `${sec.slug}/index.html` ? ' class="active"' : ""}>${esc(sec.titleKo)}</a></li>`);
      for (const d of docs) {
        const active = activePath === `${sec.slug}/${d.slug}.html` ? ' class="active"' : "";
        out.push(`<li style="padding-left:14px;"><a href="${rel(`${sec.slug}/${d.slug}.html`)}"${active} style="font-size:0.85em;">${esc(d.titleKo || d.slug)}</a></li>`);
      }
    }
    out.push(`</ul>`);
  }
  return out.join("\n          ");
}

// 문서 카드용 한 줄 설명 — 원본에서 자동 추출 (수작업 입력 금지)
function docBlurb(doc: DocDef): string {
  try {
    const raw = readSource(doc.source);
    if (doc.kind === "procedure") {
      const parsed = yamlLoad(raw) as { description?: string } | null;
      const d = (parsed?.description ?? "").replace(/\s+/g, " ").trim();
      return d.length > 120 ? d.slice(0, 117) + "…" : d || "절차서 단계·게이트·산출물 정의";
    }
    if (doc.kind === "checklist") {
      const parsed = yamlLoad(raw) as { items?: unknown[] } | null;
      const n = parsed?.items?.length ?? 0;
      return `게이트 판정 체크리스트 — ${n}개 항목 (필수 항목은 waiver 없이 통과 불가)`;
    }
    const body = stripFrontmatter(raw);
    const para = body.split(/\n\s*\n/).map((b) => b.trim()).find((b) => b && !b.startsWith("#") && !b.startsWith("|") && !b.startsWith("-")) ?? "";
    const plain = para.replace(/[*\`>\[\]]/g, "").replace(/\s+/g, " ").trim();
    return plain.length > 120 ? plain.slice(0, 117) + "…" : plain || "저장소 원본 문서의 스냅샷";
  } catch {
    return "저장소 원본 문서의 스냅샷";
  }
}

const FOOTER = '<footer><p>© 2026 co-newbiz knowledge hub · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a> · <a href="https://github.com/5throck/ai-workspace-standards">ai-workspace-standards</a></p></footer>';

function pageHtml(title: string, activePath: string | null, content: string, govMeta: string | null, hasMermaid: boolean, generated: Set<string>, prefix = ""): string {
  const A = (p: string): string => prefix + p;
  const nav = sidebarNav(activePath, generated, prefix);
  let html = BASE_HTML;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)} | co-newbiz 문서 허브</title>`);
  html = html.replace(/<!-- SIDEBAR-LINKS -->[\s\S]*?(<\/ul>)/, `${nav}\n        $1`);
  // 본문: 권위 고지 + 콘텐츠(h1 포함 보장) + gov-meta
  const inner = `<div class="authority-note" style="background:var(--bg-note);border-left:3px solid var(--border);padding:10px 14px;margin:0 0 16px;border-radius:4px;font-size:0.82em;color:var(--text-muted);">
        이 페이지는 저장소 원본 문서의 <strong>버전 고정 스냅샷</strong>입니다(온보딩·배포용). 분쟁 시 <strong>원본 문서가 우위</strong>입니다 — 최신판은 웹앱 문서·규정 화면 또는 저장소 원본을 확인하세요.
      </div>
      <h1>${esc(title)}</h1>
${content}
      ${govMeta ? `<div class="gov-meta" style="margin-top:32px;padding-top:16px;border-top:1px solid var(--border);font-size:0.78em;color:var(--text-dim);">${govMeta}</div>` : ""}
      <nav class="chapter-nav" style="display:flex;justify-content:space-between;margin-top:40px;padding-top:20px;border-top:1px solid var(--border);">
        <a href="${A("index.html")}" class="prev" style="text-decoration:none;color:var(--text);">
          <div style="font-size:12px;color:var(--text-dim);">← 이전</div>
          <div>홈</div>
        </a>
        <span></span>
      </nav>`;
  html = html.replace("<!-- MAIN-CONTENT -->", inner);
  // 푸터: 검증기 요건(plain <footer> + CC BY-NC-SA + standards 저장소 링크)
  html = html.replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, FOOTER);
  // 브랜드 치환
  html = html.replace(/co-deck/g, "co-newbiz 문서 허브");
  // 스크립트: base.html 기본 4종 + copy-code + mermaid(조건부)
  const scripts = [
    `<script src="${A("assets/js/copy-code.js")}"></script>`,
    ...(hasMermaid
      ? [`<script src="${A("assets/js/mermaid.min.js")}"></script>`, "<script>mermaid.initialize({ startOnLoad: true, theme: 'neutral' });</script>"]
      : []),
  ].join("\n  ");
  html = html.replace("</body>", `  ${scripts}\n</body>`);
  return html;
}

function govMetaHtml(doc: DocDef, govId: string, version: string, hash: string): string {
  return `문서 식별자 <code>${esc(govId)}</code> · 버전 <code>${esc(version)}</code> · 원본 <code>${esc(doc.source)}</code>@<code>${hash}</code> · <a href="https://github.com/5throck/co-newbiz/blob/main/${esc(doc.source)}">원본 열기</a> — 이 스냅샷이 원본과 다르면 원본이 맞습니다.`;
}

// ── 메인 ────────────────────────────────────────────────────────────────────
function targetDocs(): Array<{ sec: SectionDef; doc: DocDef }> {
  const out: Array<{ sec: SectionDef; doc: DocDef }> = [];
  for (const sec of SECTIONS) {
    for (const doc of sec.docs) {
      if (ALL || PILOT.has(doc.slug)) out.push({ sec, doc });
    }
  }
  return out;
}

// 해시 검증 (--check): 마지막 생성 당시 해시와 현재 원본 해시 비교
function checkHashes(): number {
  if (!existsSync(HASHES_FILE)) {
    console.error("sources-hashes.json이 없습니다 — 먼저 생성을 실행하세요.");
    return 1;
  }
  const recorded = JSON.parse(readFileSync(HASHES_FILE, "utf-8")) as Record<string, string>;
  let stale = 0;
  for (const [rel, hash] of Object.entries(recorded)) {
    const cur = sourceHash(rel);
    if (cur !== hash) {
      console.error(`STALE: ${rel} — 원본이 변경되었습니다 (${hash} → ${cur}). 재생성이 필요합니다.`);
      stale++;
    }
  }
  if (stale > 0) return 1;
  console.log(`sources-hashes OK — ${Object.keys(recorded).length}개 원본 모두 최신입니다.`);
  return 0;
}

if (CHECK) {
  process.exit(checkHashes());
}

const targets = targetDocs();
const generated = new Set<string>();
const hashes: Record<string, string> = {};
mkdirSync(DOCS, { recursive: true });

for (const { sec, doc } of targets) {
  const parsed: unknown = doc.kind === "md" ? null : yamlLoad(readSource(doc.source));
  const govId = govIdOf(doc.source, parsed);
  const version = versionOf(doc.source, parsed);
  const hash = sourceHash(doc.source);
  hashes[doc.source] = hash;

  const rendered =
    doc.kind === "procedure" ? renderProcedure(doc) : doc.kind === "checklist" ? renderChecklist(doc) : renderMarkdown(doc);

  const dir = join(DOCS, sec.slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${doc.slug}.html`);
  const html = pageHtml(
    rendered.title,
    `${sec.slug}/${doc.slug}.html`,
    rendered.html,
    govMetaHtml(doc, govId, version, hash),
    rendered.hasMermaid,
    generated, // NOTE: 자기 자신은 이후 반영 — 사이드바는 전체 생성 후 2패스에서 갱신
    "../",
  );
  writeFileSync(path, html);
  generated.add(`${sec.slug}/${doc.slug}`);
}

// 2패스: 전체 문서 집합이 확정된 뒤 사이드바를 올바르게 다시 쓴다.
for (const { sec, doc } of targets) {
  const path = join(DOCS, sec.slug, `${doc.slug}.html`);
  const html = readFileSync(path, "utf-8");
  // 이미 렌더된 본문을 유지하려면 렌더를 반복하지 않고, 사이드바 부분만 교체
  const nav = sidebarNav(`${sec.slug}/${doc.slug}.html`, generated, "../");
  writeFileSync(
    path,
    html.replace(/<ul class="sidebar-nav">[\s\S]*?<\/ul>\n    <div class="sidebar-footer">/, `<ul class="sidebar-nav">\n${nav}\n    </ul>\n    <div class="sidebar-footer">`),
  );
}

// 섹션 인덱스 (생성된 문서가 있는 섹션만)
for (const sec of SECTIONS) {
  const docs = sec.docs.filter((d) => generated.has(`${sec.slug}/${d.slug}`));
  if (docs.length === 0) continue;
  const cards = docs
    .map((d) => `        <a class="card" href="${d.slug}.html">\n          <span class="tag tag-ref">${esc(sec.titleKo)}</span>\n          <h2>${esc(d.titleKo || d.slug)}</h2>\n          <p>${esc(docBlurb(d))}</p>\n          <div class="go">문서 열기 →</div>\n        </a>`)
    .join("\n");
  const html = pageHtml(
    sec.titleKo,
    `${sec.slug}/index.html`,
    `<h1>${esc(sec.titleKo)}</h1>\n      <p>${esc(sec.blurb)}</p>\n      <div class="grid">\n${cards}\n      </div>`,
    null,
    false,
    generated,
    "../",
  );
  writeFileSync(join(DOCS, sec.slug, "index.html"), html);
  // 섹션 인덱스도 generated에 포함해 홈 사이드바에 반영
}

// 홈
const sectionCards = SECTIONS.filter((s) => s.docs.some((d) => generated.has(`${s.slug}/${d.slug}`)))
  .map((s) => {
    const docs = s.docs.filter((d) => generated.has(`${s.slug}/${d.slug}`));
    return `          <tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;"><a href="${s.slug}/index.html">${esc(s.titleKo)}</a></td><td style="padding:8px;">${esc(s.blurb)}</td><td style="padding:8px;">${docs.length}건</td></tr>`;
  })
  .join("\n");
const home = pageHtml(
  "co-newbiz 문서 허브",
  null,
  `<p>규정집·업무절차서·체크리스트·매뉴얼·참고문서의 <strong>버전 고정 스냅샷</strong> 포털입니다. 모든 페이지는 원본 문서(저장소 YAML/MD)에서 파생되며 <strong>분쟁 시 원본이 우위</strong>입니다. 최신 열람은 웹앱의 문서·규정 화면을 사용하세요.</p>
      <div class="callout callout--info" style="background:var(--bg-info);border-left:3px solid var(--accent);padding:16px 20px;margin:20px 0;border-radius:4px;">
        <strong>역할 분리 (ADR-0107):</strong> 웹앱 문서·규정 화면 = 운영 중 최신 열람 · 이 포털 = 온보딩·배포용 고정 스냅샷 (각 페이지 푸터의 소스 해시로 원본 대조 가능)
      </div>
      ${SECTIONS.filter((sec) => sec.docs.some((d) => generated.has(`${sec.slug}/${d.slug}`)))
        .map((sec) => {
          const docs = sec.docs.filter((d) => generated.has(`${sec.slug}/${d.slug}`));
          const cards = docs
            .map((d) => `        <a class="card" href="${sec.slug}/${d.slug}.html">\n          <span class="tag tag-ref">${esc(sec.titleKo)}</span>\n          <h2>${esc(d.titleKo || d.slug)}</h2>\n          <p>${esc(docBlurb(d))}</p>\n          <div class="go">문서 열기 →</div>\n        </a>`)
            .join("\n");
          const pending = sec.docs.length - docs.length;
          return `<p class="section-label">${esc(sec.titleKo)}${ALL || pending === 0 ? "" : ` — 파일럿 ${docs.length}건 / 전체 ${sec.docs.length}건`}</p>\n      <div class="grid">\n${cards}\n      </div>`;
        })
        .join("\n      ")}
      <p style="font-size:0.8em;color:var(--text-dim);margin-top:28px;">기준: flow.spec v2.2.0 · 스냅샷 생성일 ${new Date().toISOString().slice(0, 10)}</p>`,
  null,
  false,
  generated,
);
writeFileSync(join(DOCS, "index.html"), home);

// 검색 매니페스트
const manifest: Array<{ path: string; title: string; lang: string }> = [{ path: "index.html", title: "co-newbiz 문서 허브", lang: "ko" }];
for (const sec of SECTIONS) {
  if (sec.docs.some((d) => generated.has(`${sec.slug}/${d.slug}`))) {
    manifest.push({ path: `${sec.slug}/index.html`, title: sec.titleKo, lang: "ko" });
  }
  for (const d of sec.docs) {
    if (generated.has(`${sec.slug}/${d.slug}`)) {
      manifest.push({ path: `${sec.slug}/${d.slug}.html`, title: d.titleKo || d.slug, lang: "ko" });
    }
  }
}
writeFileSync(join(DOCS, "search-manifest.json"), JSON.stringify({ pages: manifest }, null, 2));
writeFileSync(HASHES_FILE, JSON.stringify(hashes, null, 2));

console.log(`generated ${generated.size} pages (${ALL ? "full" : "pilot"}), manifest ${manifest.length} entries, hashes ${Object.keys(hashes).length}`);
