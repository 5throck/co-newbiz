// @version 1.0.0
/**
 * ADR-0172 amendment 2026-10-14 (2): evidence context for the S3 "보유 판정 확인 (AI)" run, kept pure so it can be
 * tested without a DB. Company profile text (every textual field, capped) and DART/financial facts become labelled
 * lines the LLM may cite as `profile` / `dart`; the opportunity's own S1/S2/S3 context is passed separately and is
 * NEVER evidence that the group holds a capability.
 */
import { hasUsableAnalystEvidence } from "./profile-analyst-sources.ts";
import type { CompanyProfilePayload } from "./company-profile-pipeline.ts";
import { formatInteger, type Locale } from "./format.ts";

const FIELD_CAP = 320;
const COMPANY_CAP = 2600;

const clip = (v: unknown, cap = FIELD_CAP): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, cap);
const list = (v: unknown, n: number, cap = FIELD_CAP): string => (Array.isArray(v) ? v.slice(0, n).map((x) => clip(typeof x === "string" ? x : (x as { name?: string; note?: string })?.name ? `${(x as { name?: string }).name}${(x as { note?: string }).note ? `(${clip((x as { note?: string }).note, 80)})` : ""}` : "", 120)).filter(Boolean).join(" / ").slice(0, cap) : "");

export interface ProfileEvidence {
  lines: string[];
  /** At least one qualitative line may be cited as a profile basis (verified, or backed by search research). */
  citable: boolean;
  /** The profile's qualitative text was generated with search research (webResearchCount > 0 or sources stored). */
  researched: boolean;
}

type LedgerEntry = { item: string; status: string };
const VERIFIED = "[검증됨]";
const BY_RESEARCH = "[검색 근거 기반 — 분석가 미확정]";
const NO_RESEARCH = "[미검증 — 검색 근거 없이 생성]";

/**
 * Verification state of one qualitative profile field. A ledger entry (lib/company-profile-pipeline.ts verificationLedger)
 * wins: confirmed = verified, needs_judgement = LLM guess, could_not_verify = unverifiable. Fields without a ledger
 * entry (assessment, exposure, SWOT) follow how the profile was generated: with search research they are citable,
 * without it they are unverified. Unverified claims are NON-CITABLE as a holding basis.
 */
function fieldState(ledger: LedgerEntry[], keys: string[], researched: boolean): { label: string; citable: boolean } {
  const hits = keys.map((k) => ledger.find((l) => l.item === k)).filter((x): x is LedgerEntry => Boolean(x));
  if (hits.length > 0) {
    if (hits.every((h) => h.status === "confirmed")) return { label: VERIFIED, citable: true };
    return { label: hits.some((h) => h.status === "needs_judgement") ? "[미검증 — LLM 추정]" : "[미검증 — 확인 불가]", citable: false };
  }
  return researched ? { label: BY_RESEARCH, citable: true } : { label: NO_RESEARCH, citable: false };
}

/** Labelled evidence lines of a profile, one per non-empty textual field, capped per field and per company. */
export function profileEvidence(companyName: string, p: CompanyProfilePayload | null): ProfileEvidence {
  if (!p) return { lines: [], citable: false, researched: false };
  // Analyst-provided URLs count only when they carry a readable body; a note counts as analyst evidence (ADR-0172 amendment 4).
  const userBacked = hasUsableAnalystEvidence(p);
  const researched = (p.dataSources?.webResearchCount ?? 0) > 0 || (p.researchSources ?? []).some((x) => !x.provided) || userBacked;
  const ledger = (p.verificationLedger ?? []) as LedgerEntry[];
  const itemKeys = (prefix: string, v: unknown, n: number): string[] => (Array.isArray(v) ? v.slice(0, n).filter((x): x is string => typeof x === "string").map((x) => `${prefix}: ${x.slice(0, 60)}`) : []);
  const fields: Array<[string, string, string[]]> = [
    ["사업 평가", clip(p.businessAssessment, 500), ["사업 평가"]],
    ["강점", list(p.strengths, 6), itemKeys("강점", p.strengths, 6)],
    ["약점", list(p.weaknesses, 5), itemKeys("약점", p.weaknesses, 5)],
    ["산업 노출", list(p.industryExposure, 8), itemKeys("산업 노출", p.industryExposure, 8)],
    ["SWOT 기회", list(p.swot?.opportunities, 4), []],
    ["SWOT 위협", list(p.swot?.threats, 4), []],
    ["경쟁 포지셔닝", clip(p.competitive?.positioning), ["경쟁 포지셔닝 서술"]],
    ["주요 경쟁사", list(p.competitive?.competitors, 6), (p.competitive?.competitors ?? []).slice(0, 6).map((c) => `경쟁사: ${c?.name}`)],
  ];
  const lines: string[] = [];
  let citable = false;
  let total = 0;
  const push = (label: string, text: string, st: { label: string; citable: boolean }) => {
    if (!text) return;
    const line = `- ${companyName} · ${label} ${st.label}: ${text}`;
    if (total + line.length > COMPANY_CAP) return;
    total += line.length;
    lines.push(line);
    if (st.citable) citable = true;
  };
  for (const [label, text, keys] of fields) push(label, text, fieldState(ledger, keys, researched));
  for (const s of (p.stepSummaries ?? []).slice(0, 6)) {
    // Steps 1 (DART intake) and 6 (deterministic synthesis) are facts about stored data, not LLM claims.
    const deterministic = s.step === 1 || s.step === 6;
    push(`분석 단계 ${s.title}`, clip(s.summary, 240), deterministic ? { label: "[검증됨 — 공시·결정론]", citable: false } : fieldState(ledger, [], researched));
  }
  if (lines.length > 0 && !researched) {
    lines.unshift(`- ${companyName} · 안내: 이 프로필의 정성 내용은 외부 검색 근거 없이 생성되어 미검증입니다(웹 리서치 0건) — [미검증] 줄은 보유 근거로 인용하지 않습니다.`);
  }
  return { lines, citable, researched };
}

/** Lines only (see profileEvidence for the verification state). */
export function profileEvidenceLines(companyName: string, p: CompanyProfilePayload | null): string[] {
  return profileEvidence(companyName, p).lines;
}

export interface DisclosureItem { name: string; value: number; year?: string }

const fmtKrw = (v: number, locale: Locale | string = "ko"): string => (Math.abs(v) >= 1e8 ? `${formatInteger(Math.round(v / 1e8), locale)}억원` : `${formatInteger(Math.round(v), locale)}원`);

/** "[공시·재무 근거]" lines: stored DART account values (latest years first, compact). */
export function disclosureEvidenceLines(companyName: string, items: DisclosureItem[], maxItems = 24, locale: Locale | string = "ko"): string[] {
  const rows = items.filter((i) => i && i.name && Number.isFinite(i.value));
  if (rows.length === 0) return [];
  const byYear = new Map<string, DisclosureItem[]>();
  for (const r of rows) {
    const y = r.year ?? "연도 미상";
    byYear.set(y, [...(byYear.get(y) ?? []), r]);
  }
  const years = [...byYear.keys()].sort().reverse().slice(0, 2);
  const lines: string[] = [];
  let left = maxItems;
  for (const y of years) {
    const part = (byYear.get(y) ?? []).slice(0, left);
    left -= part.length;
    lines.push(`- ${companyName} · 공시 ${y}: ${part.map((r) => `${clip(r.name, 30)} ${fmtKrw(r.value, locale)}`).join(", ")}`);
    if (left <= 0) break;
  }
  return lines;
}

/** The opportunity's own context — shown to the LLM as background, explicitly not as holding evidence. */
export function opportunityContextLines(marketScope: string | null, synergyAreasText: string): string[] {
  const out: string[] = [];
  if (marketScope?.trim()) out.push(`- 시장 범위(S1): ${clip(marketScope, 200)}`);
  for (const l of synergyAreasText.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 8)) out.push(`- 시너지 영역(S2/S3): ${clip(l, 240)}`);
  return out;
}

/** Account values for one company: stored fact rows (md_company matched by DART corp code) first, then the profile's own DART snapshot. */
export function loadDisclosureItems(
  db: { query: (sql: string) => { all: (...a: unknown[]) => unknown[]; get: (...a: unknown[]) => unknown } },
  dartCorpCode: string | null,
  profile: CompanyProfilePayload | null,
): DisclosureItem[] {
  if (dartCorpCode) {
    try {
      const company = db.query("SELECT id FROM md_company WHERE dart_corp_code = ? LIMIT 1").get(dartCorpCode) as { id: string } | undefined;
      if (company) {
        const rows = db.query(
          `SELECT a.name_ko AS name, f.value AS value, CAST(per.fiscal_year AS TEXT) AS year
           FROM fact_financial f JOIN md_account a ON a.id = f.account_id JOIN md_period per ON per.id = f.period_id
           WHERE f.company_id = ? AND f.revision_no = (SELECT MAX(f2.revision_no) FROM fact_financial f2 WHERE f2.company_id = f.company_id AND f2.period_id = f.period_id AND f2.account_id = f.account_id)
           ORDER BY per.fiscal_year DESC LIMIT 60`,
        ).all(company.id) as DisclosureItem[];
        if (rows.length > 0) return rows;
      }
    } catch { /* fact tables unavailable — fall back to the profile snapshot */ }
  }
  const d = profile?.dartFinancials;
  return d?.available && Array.isArray(d.items) ? d.items.map((i) => ({ name: i.name, value: i.value, year: d.year })) : [];
}

/** Max other group members added when the user ticks "그룹 내 다른 계열사 프로필도 참고". */
export const GROUP_EXTRA_MEMBER_CAP = 8;

/** The other members of the same group(s) as the scoped member(s), in a stable order, capped. Pure. */
export function selectGroupExtraMembers<M extends { id: string; company_name: string; group_id: string }>(all: M[], scoped: M[], max = GROUP_EXTRA_MEMBER_CAP): M[] {
  const groups = new Set(scoped.map((m) => m.group_id).filter(Boolean));
  const inScope = new Set(scoped.map((m) => m.id));
  return all
    .filter((m) => groups.has(m.group_id) && !inScope.has(m.id))
    .sort((a, b) => a.company_name.localeCompare(b.company_name, "ko"))
    .slice(0, max);
}

/** The note that names which other group companies were used (empty `used` = the option found nothing to add). */
export function groupScopeNote(used: string[], candidates: number): string {
  if (used.length === 0) {
    return candidates === 0
      ? "그룹 내 다른 계열사 근거 포함 요청 — 같은 그룹의 다른 계열사가 없어 추가된 근거가 없습니다."
      : "그룹 내 다른 계열사 근거 포함 요청 — 다른 계열사에 프로필이 없어 추가된 근거가 없습니다.";
  }
  return `그룹 내 다른 계열사 근거 포함: ${used.join(", ")} — 보유 판정은 선택한 회사·그룹 기준이며, 다른 계열사에서 나온 근거는 보유 근거에 회사명이 적혀 있으니 확인 후 수정하세요.`;
}
