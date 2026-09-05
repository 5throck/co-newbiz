// @version 2.0.0
// knowledge-hub 문서 포털 생성기 (ADR-0107).
//
// 원본 문서(policies/ procedures/ checklists/ docs/ templates/)를 유일한 소스로
// 삼아 정적 HTML 페이지를 파생시킨다. 원본이 권위 원본이며 포털은 2차 산출물 —
// 모든 페이지에 governance_doc_id·원본 상대 링크·버전·소스 SHA-256 단축 해시를
// 기계 생성으로 고정하고(수작업 입력 금지), 빌드 시 해시를 재계산해
// sources-hashes.json과 불일치하면 fail 한다(stale 포털 배포 차단).
//
// v2.0.0 — 포털 전용 셸(template.html)로 전환: 색 하드코딩 0(azure 3-layer
// 다크모드 토큰만 사용, .dark 클래스 규약 = dark-mode-toggle.js와 일치).
// UI 크롬 이중화: 모든 페이지를 slug.html(한국어 크롬, 기본) + slug_en.html
// (영어 크롬)로 생성 — lang-switcher의 _en 접미사 규약과 정확히 일치한다.
// 본문은 원본 언어 그대로(스냅샷 특성)이며 크롬에 그 사실을 명시한다.
//
// 사용법:
//   bun scripts/generate-portal.ts            # 파일럿 (PILOT만 생성)
//   bun scripts/generate-portal.ts --all      # 전체 문서 생성
//   bun scripts/generate-portal.ts --check    # 해시 검증만 (생성 없이)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { load as yamlLoad } from "js-yaml";
import { marked } from "marked";

const ROOT = join(import.meta.dirname, "..", "..");
const DOCS = join(import.meta.dirname, "..", "docs");
const HASHES_FILE = join(import.meta.dirname, "..", "sources-hashes.json");
const TEMPLATE_HTML = readFileSync(join(import.meta.dirname, "template.html"), "utf-8");

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const CHECK = args.includes("--check");

// ── UI 크롬 이중 사전 (본문은 원본 언어 그대로 — 크롬만 이중화) ─────────────
type Lang = "" | "en" | "ja" | "es"; // "" = 기본(한국어 크롬). en/ja/es는 크롬만 번역, 본문은 원본 언어.
const EN: Record<string, string> = {
  brand: "Knowledge Hub", home: "Home", searchPlaceholder: "Search documents...", openDoc: "Open document", groupRef: "Reference & Guides", pendingSuffix: "upcoming",
  pilotLabel: "pilot", all: "all", version: "version", source: "source",
  baseline: "baseline", snapshotDate: "snapshot date", bodyInSourceLang: "body in source language",
  authority: 'This page is a <strong>version-pinned snapshot</strong> of the repository original (for onboarding and distribution). In any conflict, <strong>the repository original prevails</strong> — check the web app\'s documents screen or the repository for the latest version. Body text is kept in the source document\'s language.',
};
const JA: Record<string, string> = {
  brand: "ドキュメントハブ", home: "ホーム", searchPlaceholder: "ドキュメント検索...", openDoc: "文書を開く", groupRef: "参照・ガイド", pendingSuffix: "拡張予定",
  pilotLabel: "パイロット", all: "全", version: "バージョン", source: "原文",
  baseline: "基準", snapshotDate: "スナップショット日", bodyInSourceLang: "本文は原文の言語を維持",
  authority: 'このページはリポジトリ原文の<strong>バージョン固定スナップショット</strong>です。矛盾する場合は<strong>リポジトリの原文が優先</strong>されます。本文は原文の言語で維持されます。',
};
const ES: Record<string, string> = {
  brand: "Portal de Documentos", home: "Inicio", searchPlaceholder: "Buscar documentos...", openDoc: "Abrir documento", groupRef: "Referencia y Guías", pendingSuffix: "próximamente",
  pilotLabel: "piloto", all: "total", version: "versión", source: "fuente",
  baseline: "base", snapshotDate: "fecha del snapshot", bodyInSourceLang: "cuerpo en el idioma original",
  authority: 'Esta página es una <strong>instantánea con versión fija</strong> del documento original del repositorio. En caso de conflicto, <strong>prevalece el original</strong>. El cuerpo del texto se mantiene en el idioma del documento fuente.',
};
const UI_STRINGS: Record<string, Record<Lang, string>> = {
  brand: { "": "문서 허브", en: "Knowledge Hub" },
  home: { "": "홈", en: "Home" },
  searchPlaceholder: { "": "문서 검색...", en: "Search documents..." },
  openDoc: { "": "문서 열기", en: "Open document" },
  pendingSuffix: { "": "확장 예정", en: "upcoming" },
  pilotLabel: { "": "파일럿", en: "pilot" },
  all: { "": "전체", en: "all" },
  version: { "": "버전", en: "version" },
  source: { "": "원본", en: "source" },
  authority: {
    "": '이 페이지는 저장소 원본 문서의 <strong>버전 고정 스냅샷</strong>입니다(온보딩·배포용). 분쟁 시 <strong>원본 문서가 우위</strong>입니다 — 최신판은 웹앱의 문서·규정 화면 또는 저장소 원본을 확인하세요. 본문은 원본 문서의 언어로 유지됩니다.',
    en: 'This page is a <strong>version-pinned snapshot</strong> of the repository original (for onboarding and distribution). In any conflict, <strong>the repository original prevails</strong> — check the web app\'s documents screen or the repository for the latest version. Body text is kept in the source document\'s language.',
  },
  baseline: { "": "기준", en: "baseline" },
  snapshotDate: { "": "스냅샷 생성일", en: "snapshot date" },
  bodyInSourceLang: {
    "": "본문은 원본 언어 유지",
    en: "body in source language",
  },
};
const CHROME: Record<Lang, Record<string, string>> = { "": {}, en: EN, ja: JA, es: ES };
const t = (key: string, lang: Lang): string =>
  UI_STRINGS[key]?.[lang] ?? CHROME[lang]?.[key] ?? UI_STRINGS[key]?.[""] ?? CHROME[lang === "ja" || lang === "es" ? "en" : ""]?.[key] ?? key;

// ── 포털 문서 레지스트리 (메뉴 SSOT — 사이드바·카드·배지 전부 여기서 생성) ──
type DocKind = "procedure" | "checklist" | "md";
interface DocDef { slug: string; titleKo: string; titleEn: string; source: string; kind: DocKind }
interface SectionDef { slug: string; titleKo: string; titleEn: string; blurbKo: string; blurbEn: string; docs: DocDef[] }

const md = (slug: string, titleKo: string, titleEn: string, source: string): DocDef => ({ slug, titleKo, titleEn, source, kind: "md" });
const proc = (slug: string, titleKo: string, titleEn: string): DocDef => ({ slug, titleKo, titleEn, source: `procedures/_shared/${slug}/schema.yaml`, kind: "procedure" });
const chk = (n: string, titleKo: string, titleEn: string): DocDef => ({ slug: n, titleKo, titleEn, source: `checklists/${n}-checklist.yaml`, kind: "checklist" });

const SECTIONS: SectionDef[] = [
  {
    slug: "policies", titleKo: "규정집", titleEn: "Policies", blurbKo: "그룹 신규사업 정책과 법인별 추가 규정입니다.", blurbEn: "Group new-business policy and per-entity addenda.",
    docs: [
      md("neb-policy", "그룹 신규사업 검토 정책", "Group New-Business Review Policy", "policies/group/neb-policy.md"),
      md("ent-a-addendum", "ent-a 법인 추가 규정", "Entity A Addendum", "policies/entities/ent-a/addendum.md"),
      md("ent-b-addendum", "ent-b 법인 추가 규정", "Entity B Addendum", "policies/entities/ent-b/addendum.md"),
    ],
  },
  {
    slug: "procedures", titleKo: "업무절차서", titleEn: "Procedures", blurbKo: "스테이지별 공유 절차서입니다. procedures/*.yaml이 권위 원본입니다.", blurbEn: "Stage procedures. procedures/*.yaml is the authoritative source.",
    docs: [
      proc("greenfield-screening", "그린필드 스크리닝", "Greenfield Screening"),
      proc("brownfield-screening", "브라운필드 스크리닝", "Brownfield Screening"),
      proc("greenfield-pre-fs", "그린필드 Pre-FS", "Greenfield Pre-FS"),
      proc("brownfield-pre-fs", "브라운필드 Pre-FS", "Brownfield Pre-FS"),
      proc("deal-shape-chain", "딜 셰이프 체인", "Deal Shape Chain"),
      proc("company-profile-analysis", "기업 프로필 분석", "Company Profile Analysis"),
      proc("greenfield-capability-assessment", "그린필드 역량 평가", "Greenfield Capability Assessment"),
      proc("brownfield-target-identification", "브라운필드 대상 후보 발굴", "Brownfield Target Identification"),
      proc("brownfield-target-screening", "브라운필드 대상 스크리닝", "Brownfield Target Screening"),
      proc("greenfield-fs", "그린필드 FS", "Greenfield FS"),
      proc("brownfield-fs", "브라운필드 FS", "Brownfield FS"),
      proc("greenfield-dd", "그린필드 실사", "Greenfield DD"),
      proc("brownfield-dd", "브라운필드 실사", "Brownfield DD"),
      proc("deal-structuring", "투자구조 설계", "Deal Structuring"),
      proc("entity-ic-review", "Entity IC 심의", "Entity IC Review"),
      proc("group-investment-review", "그룹 투자 심의", "Group Investment Review"),
      proc("entity-establishment-execution", "법인 설립 실행", "Entity Establishment Execution"),
      proc("pmi-integration-execution", "PMI 통합 실행", "PMI Integration Execution"),
      proc("jv-lifecycle-governance", "JV 라이프사이클 거버넌스", "JV Lifecycle Governance"),
      proc("portfolio-venture-monitoring", "포트폴리오 벤처 모니터링", "Portfolio Venture Monitoring"),
    ],
  },
  {
    slug: "checklists", titleKo: "체크리스트", titleEn: "Checklists", blurbKo: "게이트 체크리스트입니다. 항목별 mandatory는 waiver 없이는 통과할 수 없습니다.", blurbEn: "Gate checklists. Mandatory items cannot pass without an active waiver.",
    docs: [
      chk("strategic-fit-screening", "전략적 적합성 스크리닝", "Strategic Fit Screening"),
      chk("target-screening", "대상 스크리닝", "Target Screening"),
      chk("deal-shape-presigning", "딜 셰이프 사전서명", "Deal Shape Pre-Signing"),
      chk("site-selection", "입지 선정", "Site Selection"),
      chk("greenfield-feasibility", "그린필드 실현가능성", "Greenfield Feasibility"),
      chk("brownfield-feasibility", "브라운필드 실현가능성", "Brownfield Feasibility"),
      chk("commercial-dd", "상업 실사", "Commercial DD"),
      chk("technical-dd", "기술 실사", "Technical DD"),
      chk("legal-dd", "법무 실사", "Legal DD"),
      chk("financial-dd", "재무 실사", "Financial DD"),
      chk("hr-dd", "인사 실사", "HR DD"),
      chk("market-dd", "시장 실사", "Market DD"),
      chk("financing-plan", "자금조달 계획", "Financing Plan"),
      chk("legal-regulatory", "법규·규제", "Legal & Regulatory"),
      chk("ma-special-topics", "M&A 특수 주제", "M&A Special Topics"),
      chk("partnership", "파트너십", "Partnership"),
      chk("rbd-technology", "R&BD 기술", "R&BD Technology"),
      chk("entity-formation", "법인 설립", "Entity Formation"),
    ],
  },
  {
    slug: "manuals", titleKo: "업무 매뉴얼", titleEn: "Manuals", blurbKo: "역할별 3분립 매뉴얼입니다(한국어판 기준).", blurbEn: "Three role-scoped manuals (Korean editions).",
    docs: [
      md("business-manual", "비즈니스 매뉴얼 (analyst·IC 심사자)", "Business Manual (analyst & IC reviewers)", "docs/manuals/business-manual_ko.md"),
      md("admin-manual", "관리자 매뉴얼", "Admin Manual", "docs/manuals/admin-manual_ko.md"),
      md("operations-manual", "운영 매뉴얼 (운영자)", "Operations Manual", "docs/manuals/operations-manual_ko.md"),
    ],
  },
  {
    slug: "reference", titleKo: "참고문서", titleEn: "Reference", blurbKo: "프로세스·거버넌스·보안 운영 참조 문서입니다.", blurbEn: "Process, governance, and security operations references.",
    docs: [
      md("process-map", "프로세스 맵", "Process Map", "docs/process-map.md"),
      md("raci", "RACI 매트릭스", "RACI Matrix", "docs/raci.md"),
      md("governance-operations", "거버넌스 운영", "Governance Operations", "docs/governance-operations.md"),
      md("ops-cadence", "운영 주기", "Ops Cadence", "docs/ops-cadence.md"),
      md("phase-definitions", "단계 정의", "Phase Definitions", "docs/phase-definitions.md"),
      md("rag-framework", "RAG 프레임워크", "RAG Framework", "docs/rag-framework.md"),
      md("security-model", "보안 모델", "Security Model", "docs/security-model.md"),
      md("security-baseline", "보안 베이스라인", "Security Baseline", "docs/security-baseline.md"),
      md("runbook-deployment", "런북 — 배포", "Runbook — Deployment", "docs/runbooks/deployment.md"),
      md("runbook-backup-restore", "런북 — 백업·복구", "Runbook — Backup & Restore", "docs/runbooks/backup-restore.md"),
      md("guide-expert-interview", "가이드 — 전문가 인터뷰 수행", "Guide — Expert Interview Conduct", "guidelines/expert-interview-conduct.md"),
      md("guide-proxy-chain-hop", "가이드 — 프록시 체인 홉 분류", "Guide — Proxy Chain Hop Classification", "guidelines/proxy-chain-hop-classification.md"),
    ],
  },
  {
    slug: "templates", titleKo: "산출물 템플릿", titleEn: "Templates", blurbKo: "심의·보고 산출물 템플릿입니다.", blurbEn: "Deliverable templates for review and reporting.",
    docs: [
      md("ic-memo-template", "IC 메모", "IC Memo", "templates/deliverables/ic-memo-template.md"),
      md("gate-pass-record-template", "게이트 통과 기록", "Gate Pass Record", "templates/deliverables/gate-pass-record-template.md"),
      md("partner-dd-report-template", "파트너 DD 리포트", "Partner DD Report", "templates/deliverables/partner-dd-report-template.md"),
      md("jv-health-scorecard-template", "JV 헬스 스코어카드", "JV Health Scorecard", "templates/deliverables/jv-health-scorecard-template.md"),
      md("portfolio-scorecard-rollup-template", "포트폴리오 스코어카드 롤업", "Portfolio Scorecard Rollup", "templates/deliverables/portfolio-scorecard-rollup-template.md"),
      md("venture-transition-decision-template", "벤처 전환 결정", "Venture Transition Decision", "templates/deliverables/venture-transition-decision-template.md"),
      md("venture-transition-evidence-template", "벤처 전환 증적", "Venture Transition Evidence", "templates/deliverables/venture-transition-evidence-template.md"),
      md("bau-exit-evidence-pack-template", "BAU exit 증적 팩", "BAU Exit Evidence Pack", "templates/deliverables/bau-exit-evidence-pack-template.md"),
    ],
  },
  {
    slug: "design", titleKo: "디자인", titleEn: "Design", blurbKo: "디자인 철학·가이드·컴포넌트·표준 화면 패턴 종합입니다.", blurbEn: "Design philosophy, guide, components, and standard screen patterns.",
    docs: [],
  },
  {
    slug: "dd", titleKo: "DD 실사", titleEn: "Due Diligence", blurbKo: "7도메인 실사 방법론·발견사항 규칙·waiver 종합입니다.", blurbEn: "Seven-domain DD methodology, finding rules, and waivers.",
    docs: [],
  },
];

// 정렬: 카테고리 내 문서 순서. 절차서는 S-flow(레지스트리 순서 = 프로세스 흐름)
// 유지가 탐색의 핵심이라 예외(위원회 심의 2026-09-05 — 가나다 정렬 시 Pre-FS가
// 스크리닝보다 앞에 오는 등 흐름 붕괴), 나머지 카테고리는 크롬 언어 제목 기준
// 가나다/알파벳순. 라벨 우선순위 신호로 절차서에 흐름 번호 프리픽스를 붙인다.
const KO_COLLATOR = new Intl.Collator("ko", { sensitivity: "base" });
const EN_COLLATOR = new Intl.Collator("en", { sensitivity: "base" });
function orderedDocs(sec: SectionDef, lang: Lang): DocDef[] {
  if (sec.slug === "procedures") return sec.docs;
  const key = (d: DocDef): string => (lang === "" ? d.titleKo : d.titleEn);
  const collator = lang === "" ? KO_COLLATOR : EN_COLLATOR;
  return [...sec.docs].sort((a, b) => key(a).localeCompare(key(b), lang === "" ? "ko" : "en", { sensitivity: "base" }));
}
function docLabel(sec: SectionDef, doc: DocDef, lang: Lang): string {
  // 절차서는 레지스트리 순서 = S-flow 순서(가나다 대신 흐름 유지, 2026-09-05 회의 합의)
  return lang === "" ? doc.titleKo : doc.titleEn;
}

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
  const m = readSource(relPath).match(/^---\n([\s\S]*?)\n---/);
  if (m) {
    try {
      const fm = yamlLoad(m[1]) as { governance_doc_id?: string } | undefined;
      if (fm?.governance_doc_id) return fm.governance_doc_id;
    } catch { /* ignore */ }
  }
  return `ref-${basename(relPath).replace(/\.[a-z.]+$/i, "")}`;
}
function versionOf(relPath: string, parsed: unknown): string {
  const p = parsed as { version?: string } | null;
  if (p?.version) return String(p.version);
  const m = readSource(relPath).match(/^---\n([\s\S]*?)\n---/);
  if (m) {
    try {
      const fm = yamlLoad(m[1]) as { version?: string } | undefined;
      if (fm?.version) return String(fm.version);
    } catch { /* ignore */ }
  }
  return "—";
}

// ── 렌더러 ──────────────────────────────────────────────────────────────────
function stripFrontmatter(src: string): string {
  return src.replace(/^---\n[\s\S]*?\n---\n?/, "");
}
function mdToHtml(src: string): { html: string; hasMermaid: boolean } {
  const body = stripFrontmatter(src);
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

interface Rendered { html: string; hasMermaid: boolean; title: string }
function renderProcedure(doc: DocDef): Rendered {
  const parsed = yamlLoad(readSource(doc.source)) as {
    title?: string; gate?: string; steps?: Array<Record<string, unknown>>; outputs?: string[]; description?: string;
  };
  const steps = parsed.steps ?? [];
  const lines: string[] = ["flowchart TD"];
  steps.forEach((s, i) => {
    const agent = String(s.agent_key ?? "");
    const out = String(s.output_type ?? "");
    lines.push(`  S${i}["${i + 1}. ${agent || "step"}"]`);
    if (i + 1 < steps.length) lines.push(`  S${i} --> S${i + 1}`);
    if (out) lines.push(`  S${i} -.-> O${i}["${out}"]`);
  });
  if (steps.length === 0) lines.push('  S0["no steps"]');
  const stepRows = steps.map((s, i) => `
        <tr>
          <td style="padding:8px;white-space:nowrap;">${esc(String(s.id ?? i + 1))}</td>
          <td style="padding:8px;white-space:nowrap;">${esc(String(s.gate ?? "—"))}</td>
          <td style="padding:8px;">${esc(String(s.agent_key ?? "—"))}</td>
          <td style="padding:8px;">${esc(String(s.skill_key ?? "—"))}</td>
          <td style="padding:8px;">${esc(String(s.output_type ?? "—"))}</td>
          <td class="desc" style="padding:8px;">${marked.parse(String(s.description ?? "")).toString().replace(/\n/g, " ")}</td>
        </tr>`).join("\n");
  const html = `
      <p>${esc(parsed.description ?? "")}</p>
      <div class="mermaid">${lines.join("\n")}</div>
      <h2 id="steps">단계</h2>
      <div class="table-scroll">
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);">
            <th style="text-align:left;padding:8px;white-space:nowrap;width:3%;">#</th>
            <th style="text-align:left;padding:8px;white-space:nowrap;width:7%;">Gate</th>
            <th style="text-align:left;padding:8px;white-space:nowrap;width:11%;">Agent</th>
            <th style="text-align:left;padding:8px;white-space:nowrap;width:14%;">Skill</th>
            <th style="text-align:left;padding:8px;white-space:nowrap;width:15%;">Output</th>
            <th style="text-align:left;padding:8px;width:50%;">Description</th>
          </tr>
        </thead>
        <tbody>${stepRows}
        </tbody>
      </table>
      </div>
      ${(parsed.outputs?.length ?? 0) > 0 ? `<h2 id="outputs">Outputs</h2>\n      <ul>${parsed.outputs!.map((o) => `<li>${esc(String(o))}</li>`).join("")}</ul>` : ""}`;
  return { html, hasMermaid: true, title: parsed.title ?? doc.titleEn };
}
function renderChecklist(doc: DocDef): Rendered {
  const parsed = yamlLoad(readSource(doc.source)) as {
    title?: string; items?: Array<{ id?: string; text?: string; label?: string; mandatory?: boolean }>;
  };
  const items = parsed.items ?? [];
  const rows = items.map((it) => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:8px;white-space:nowrap;">${esc(String(it.id ?? "—"))}</td>
            <td style="padding:8px;">${esc(String(it.text ?? it.label ?? "—"))}</td>
            <td style="padding:8px;">${it.mandatory
              ? '<span class="status-chip status-amber">필수</span>'
              : '<span class="status-chip status-not-started">권장</span>'}</td>
          </tr>`).join("\n");
  const html = `
      <p>필수(mandatory) 항목은 활성 waiver 없이는 게이트를 통과할 수 없습니다. 권장 항목의 부재는 사유 진술로 충분합니다. 권위 원본은 저장소의 YAML입니다.</p>
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
  return { html, hasMermaid: false, title: parsed.title ?? doc.titleEn };
}
function renderMarkdown(doc: DocDef): Rendered {
  const { html, hasMermaid } = mdToHtml(readSource(doc.source));
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return { html, hasMermaid, title: h1 ? h1[1].replace(/<[^>]+>/g, "").trim() : doc.titleEn };
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
    const plain = para.replace(/[*`>\[\]]/g, "").replace(/\s+/g, " ").trim();
    return plain.length > 120 ? plain.slice(0, 117) + "…" : plain || "저장소 원본 문서의 스냅샷";
  } catch {
    return "저장소 원본 문서의 스냅샷";
  }
}

// handbook Chapter 구조 차용 — 본문 h2 목차(TOC) 박스 생성.
// 퀴즈/예제/CourseOverview 등 나머지 handbook 타입은 non-goal (2026-09-05 회의).
function buildToc(html: string): { html: string; toc: string } {
  let n = 0;
  const items: string[] = [];
  const withIds = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (_m, attrs: string, text: string) => {
    const existing = attrs.match(/id="([^"]+)"/);
    const id = existing ? existing[1] : `sec-${++n}`;
    items.push(`<li><a href="#${id}">${text.replace(/<[^>]+>/g, "")}</a></li>`);
    return `<h2 id="${id}">${text}</h2>`;
  });
  const toc = items.length >= 2
    ? `<div class="toc-box"><p class="nav-section">목차</p><ul>${items.join("")}</ul></div>`
    : "";
  return { html: withIds, toc };
}

// ── 셸 조립 (template.html + UI 크롬 lang) ─────────────────────────────────
function titleFor(lang: Lang, doc: DocDef): string {
  return docTitleOf(doc, lang);
}
function secTitleOf(sec: SectionDef, lang: Lang): string {
  return lang === "" ? sec.titleKo : sec.titleEn;
}
function docTitleOf(doc: DocDef, lang: Lang): string {
  return lang === "" ? doc.titleKo : doc.titleEn;
}
function groupLabelOf(g: { labelKo: string; labelEn: string }, lang: Lang): string {
  return lang === "" ? g.labelKo : g.labelEn;
}
function variant(p: string, lang: Lang): string {
  return lang === "" ? p : p.replace(/\.html$/, `_${lang}.html`);
}
function sidebarNav(activePath: string | null, generated: Set<string>, prefix: string, lang: Lang): string {
  const rel = (p: string): string => prefix + variant(p, lang);
  const out: string[] = [
    `<p class="nav-section">${esc(t("brand", lang))}</p>`,
    `<ul style="margin:0 0 12px;">`,
    `<li><a href="${rel("index.html")}"${activePath === null ? ' class="active"' : ""}>${esc(t("home", lang))}</a></li>`,
    `</ul>`,
  ];
  for (const sec of SECTIONS) {
    const secTitle = secTitleOf(sec, lang);
    const all = orderedDocs(sec, lang);
    const docs = all.filter((d) => generated.has(`${sec.slug}/${d.slug}`));
    if (docs.length === 0) {
      out.push(`<ul style="margin:0 0 12px;"><li><span style="color:var(--text-dim);cursor:default;" title="pilot pending">${esc(secTitle)} (${esc(t("pendingSuffix", lang))})</span></li></ul>`);
      continue;
    }
    out.push(`<ul style="margin:0 0 12px;">`);
    out.push(`<li><a href="${rel(`${sec.slug}/index.html`)}"${activePath === `${sec.slug}/index.html` ? ' class="active"' : ""}>${esc(secTitle)}</a></li>`);
    for (const d of docs) {
      const active = activePath === `${sec.slug}/${d.slug}.html` ? ' class="active"' : "";
      out.push(`<li style="padding-left:14px;"><a href="${rel(`${sec.slug}/${d.slug}.html`)}"${active} style="font-size:0.85em;">${esc(docLabel(sec, d, lang))}</a></li>`);
    }
    out.push(`</ul>`);
  }
  return out.join("\n          ");
}

const FOOTER = '<footer><p>© 2026 co-newbiz knowledge hub · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a> · <a href="https://github.com/5throck/ai-workspace-standards">ai-workspace-standards</a></p></footer>';

interface PageInput {
  title: string;
  activePath: string | null;
  breadcrumbs: string;
  content: string;
  govMeta: string | null;
  hasMermaid: boolean;
  prefix: string;
}

function renderPage(input: PageInput, generated: Set<string>, lang: Lang): string {
  const A = (p: string): string => input.prefix + variant(p, lang);
  let html = TEMPLATE_HTML;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(input.title)} | co-newbiz ${esc(t("brand", lang))}</title>`);
  html = html.replace("<!-- HTML_LANG -->", lang === "" ? "ko" : lang);
  html = html.replace("<!-- HTML_LANG -->", lang === "" ? "ko" : lang);
  html = html.replace(/<!-- ASSETS -->/g, input.prefix + "assets");
  html = html.replace("<!-- BRAND_HREF -->", A("index.html"));
  html = html.replace('class="brand">📚 co-newbiz <!-- BRAND -->', `class="brand">📚 co-newbiz ${esc(t("brand", lang))}`);
  html = html.replace('id="site-search" placeholder="<!-- SEARCH_PLACEHOLDER -->"', `id="site-search" placeholder="${esc(t("searchPlaceholder", lang))}"`);
  html = html.replace("<!-- SIDEBAR -->", sidebarNav(input.activePath, generated, input.prefix, lang));
  html = html.replace("<!-- BREADCRUMBS -->", input.breadcrumbs);
  html = html.replace("<!-- CONTENT -->", input.content);
  html = html.replace(/<footer class="portal-footer">[\s\S]*?<\/footer>/, FOOTER);
  const scripts = input.hasMermaid
    ? [`<script src="${A("assets/js/mermaid.min.js")}"></script>`, `<script>mermaid.initialize({ startOnLoad: true, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'neutral', flowchart: { useMaxWidth: true, htmlLabels: true } });</script>`]
    : [];
  html = html.replace("</body>", `  ${scripts.join("\n  ")}\n</body>`);
  return html;
}

function breadcrumbsHtml(sec: SectionDef | null, docTitle: string, prefix: string, lang: Lang): string {
  const home = `<a href="${prefix}${variant("index.html", lang)}">${esc(t("home", lang))}</a>`;
  if (!sec) return home;
  const secLabel = secTitleOf(sec, lang);
  return `${home} &gt; <a href="${prefix}${variant(`${sec.slug}/index.html`, lang)}">${esc(secLabel)}</a> &gt; ${esc(docTitle)}`;
}

// ── 메인 ────────────────────────────────────────────────────────────────────
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

// 1패스: 생성 집합 확정
interface Target { sec: SectionDef; doc: DocDef }
const targets: Target[] = [];
for (const sec of SECTIONS) {
  for (const doc of sec.docs) {
    if (ALL || PILOT.has(doc.slug)) targets.push({ sec, doc });
  }
}
const generated = new Set<string>();
for (const { sec, doc } of targets) generated.add(`${sec.slug}/${doc.slug}`);

// 2패스: 렌더 + ko/en 크롬 변종 생성
interface PageWrite { path: string; html: string }
const pages: PageWrite[] = [];
const hashes: Record<string, string> = {};
mkdirSync(DOCS, { recursive: true });

for (const { sec, doc } of targets) {
  const parsed: unknown = doc.kind === "md" ? null : yamlLoad(readSource(doc.source));
  const govId = govIdOf(doc.source, parsed);
  const version = versionOf(doc.source, parsed);
  const hash = sourceHash(doc.source);
  hashes[doc.source] = hash;
  const rendered = doc.kind === "procedure" ? renderProcedure(doc) : doc.kind === "checklist" ? renderChecklist(doc) : renderMarkdown(doc);

  // 표준 메타 칩 블록 — 기계 판독 가능한 사실만 (게이트·단계/항목 수·버전·원본)
  const chips: string[] = [];
  const p = parsed as { gate?: string; steps?: unknown[] } | null;
  if (p?.gate) chips.push(`게이트: ${esc(String(p.gate))}`);
  if (doc.kind === "procedure" && Array.isArray(p?.steps)) chips.push(`단계: ${p!.steps!.length}`);
  if (doc.kind === "checklist") chips.push(`항목: ${(parsed as { items?: unknown[] })?.items?.length ?? 0}`);
  chips.push(`${t("version", "")}: ${esc(version)}`);
  chips.push(`${t("source", "")}: ${esc(doc.source)}@${hash}`);
  chips.push(esc(t("bodyInSourceLang", "")));
  const metaBlock = `<div class="doc-meta-block">${chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div>`;
  const govMeta = `<div class="gov-meta">문서 식별자 <code>${esc(govId)}</code> · ${esc(t("version", ""))} <code>${esc(version)}</code> · ${esc(t("source", ""))} <code>${esc(doc.source)}</code>@<code>${hash}</code> · <a href="https://github.com/5throck/co-newbiz/blob/main/${esc(doc.source)}">${esc("원본 열기")}</a> — 이 스냅샷이 원본과 다르면 원본이 맞습니다.</div>`;

  for (const lang of ["", "en", "ja", "es"] as Lang[]) {
    const title = titleFor(lang, doc);
    const chapterNav = `<nav class="chapter-nav" style="display:flex;justify-content:space-between;margin-top:40px;padding-top:20px;border-top:1px solid var(--border);">
        <a href="../${variant("index.html", lang)}" class="prev" style="text-decoration:none;color:var(--text);">
          <div style="font-size:12px;color:var(--text-dim);">←</div>
          <div>${esc(secTitleOf(sec, lang))}</div>
        </a>
        <a href="../${variant("index.html", lang)}" class="next" style="text-decoration:none;color:var(--text);text-align:right;">
          <div style="font-size:12px;color:var(--text-dim);">→</div>
          <div>${esc(t("home", lang))}</div>
        </a>
      </nav>`;
    const tocApplied = buildToc(rendered.html);
    const content = `<h1>${esc(title)}</h1>\n${metaBlock}\n<div class="authority-note">${t("authority", lang)}</div>\n${tocApplied.toc}\n${tocApplied.html}${chapterNav}`;
    pages.push({
      path: join(DOCS, sec.slug, variant(`${doc.slug}.html`, lang)),
      html: renderPage(
        { title, activePath: `${sec.slug}/${doc.slug}.html`, breadcrumbs: breadcrumbsHtml(sec, title, "../", lang), content, govMeta, hasMermaid: rendered.hasMermaid, prefix: "../" },
        generated,
        lang,
      ),
    });
  }
}

// 섹션 인덱스 (카드 그리드, ko/en)
for (const sec of SECTIONS) {
  const docs = sec.docs.filter((d) => generated.has(`${sec.slug}/${d.slug}`));
  if (docs.length === 0) continue;
  for (const lang of ["", "en", "ja", "es"] as Lang[]) {
    const secTitle = secTitleOf(sec, lang);
    const blurb = lang === "en" ? sec.blurbEn : sec.blurbKo;
    const cards = docs
      .map((d) => `        <a class="card" href="${variant(`${d.slug}.html`, lang)}">\n          <span class="tag tag-ref">${esc(secTitleOf(sec, lang))}</span>\n          <h2>${esc(docTitleOf(d, lang))}</h2>\n          <p>${esc(docBlurb(d))}</p>\n          <div class="go">${esc(t("openDoc", lang))} →</div>\n        </a>`)
      .join("\n");
    const glyph = `<svg width="72" height="40" viewBox="0 0 72 40" aria-hidden="true" class="section-glyph"><rect x="2" y="6" width="44" height="6" rx="3" fill="var(--border)"/><rect x="2" y="18" width="60" height="6" rx="3" fill="var(--border)"/><rect x="2" y="30" width="34" height="6" rx="3" fill="var(--accent)"/></svg>`;
    const content = `<h1>${esc(secTitle)}</h1>\n      ${glyph}\n      <p>${esc(blurb)}</p>\n      <div class="grid">\n${cards}\n      </div>`;
    pages.push({
      path: join(DOCS, sec.slug, variant("index.html", lang)),
      html: renderPage({ title: secTitle, activePath: `${sec.slug}/index.html`, breadcrumbs: breadcrumbsHtml(null, "", "../", lang), content, govMeta: null, hasMermaid: false, prefix: "../" }, generated, lang),
    });
  }
}

// 홈 (카드 그리드 + 파일럿 진행 표시)
for (const lang of ["", "en", "ja", "es"] as Lang[]) {
  const groups = SECTIONS.filter((sec) => sec.docs.some((d) => generated.has(`${sec.slug}/${d.slug}`)))
    .map((sec) => {
      const docs = sec.docs.filter((d) => generated.has(`${sec.slug}/${d.slug}`));
      const pending = sec.docs.length - docs.length;
      const secLabel = secTitleOf(sec, lang);
      const cards = docs
        .map((d) => `        <a class="card" href="${sec.slug}/${variant(`${d.slug}.html`, lang)}">\n          <span class="tag tag-ref">${esc(secLabel)}</span>\n          <h2>${esc(docTitleOf(d, lang))}</h2>\n          <p>${esc(docBlurb(d))}</p>\n          <div class="go">${esc(t("openDoc", lang))} →</div>\n        </a>`)
        .join("\n");
      const progress = ALL || pending === 0 ? "" : ` — ${esc(t("pilotLabel", lang))} ${docs.length} / ${esc(t("all", lang))} ${sec.docs.length}`;
      return `<p class="section-label">${esc(secLabel)}${progress}</p>\n      <div class="grid">\n${cards}\n      </div>`;
    })
    .join("\n      ");
  const content = `<h1>co-newbiz ${esc(t("brand", lang))}</h1>
      <div class="authority-note">${t("authority", lang)}</div>
      <p>${lang === "en"
        ? "A version-pinned snapshot portal for policies, procedures, checklists, manuals, and reference documents. Derived only from repository originals; in conflicts the original prevails."
        : "규정집·업무절차서·체크리스트·매뉴얼·참고문서의 버전 고정 스냅샷 포털입니다. 모든 페이지는 원본 문서에서 파생되며 분쟁 시 원본이 우위입니다."}</p>
      ${groups}
      <p style="font-size:0.8em;color:var(--text-dim);margin-top:28px;">${esc(t("baseline", lang))}: flow.spec v2.2.0 · ${esc(t("snapshotDate", lang))} ${new Date().toISOString().slice(0, 10)}</p>`;
  pages.push({
    path: join(DOCS, variant("index.html", lang)),
    html: renderPage({ title: `co-newbiz ${t("brand", lang)}`, activePath: null, breadcrumbs: breadcrumbsHtml(null, "", "", lang), content, govMeta: null, hasMermaid: false, prefix: "" }, generated, lang),
  });
}

for (const pg of pages) {
  mkdirSync(dirname(pg.path), { recursive: true });
  writeFileSync(pg.path, pg.html);
}

// 검색 매니페스트 (ko 기본 + en 변종)
const manifest: Array<{ path: string; title: string; lang: string }> = [];
for (const lang of ["ko", "en", "ja", "es"] as const) {
  const L: Lang = lang === "ko" ? "" : (lang as Lang);
  manifest.push({ path: `index${lang === "ko" ? "" : `_${lang}`}.html`, title: `co-newbiz ${t("brand", L)}`, lang });
  for (const sec of SECTIONS) {
    const docs = sec.docs.filter((d) => generated.has(`${sec.slug}/${d.slug}`));
    if (docs.length === 0) continue;
    manifest.push({ path: `${sec.slug}/index${lang === "ko" ? "" : `_${lang}`}.html`, title: secTitleOf(sec, lang), lang });
    for (const d of docs) {
      manifest.push({ path: `${sec.slug}/${d.slug}${lang === "ko" ? "" : `_${lang}`}.html`, title: docTitleOf(d, lang), lang });
    }
  }
}
writeFileSync(join(DOCS, "search-manifest.json"), JSON.stringify({ pages: manifest }, null, 2));
writeFileSync(HASHES_FILE, JSON.stringify(hashes, null, 2));

console.log(`generated ${pages.length} pages (ko+en chrome, ${ALL ? "full" : "pilot"}), manifest ${manifest.length} entries, hashes ${Object.keys(hashes).length}`);
