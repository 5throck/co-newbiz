// @version 1.0.0
/**
 * ADR-0172 amendment 2026-10-14 (2): evidence context for the S3 "보유 판정 확인 (AI)" run, kept pure so it can be
 * tested without a DB. Company profile text (every textual field, capped) and DART/financial facts become labelled
 * lines the LLM may cite as `profile` / `dart`; the opportunity's own S1/S2/S3 context is passed separately and is
 * NEVER evidence that the group holds a capability.
 */
import type { CompanyProfilePayload } from "./company-profile-pipeline.ts";

const FIELD_CAP = 320;
const COMPANY_CAP = 2600;

const clip = (v: unknown, cap = FIELD_CAP): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, cap);
const list = (v: unknown, n: number, cap = FIELD_CAP): string => (Array.isArray(v) ? v.slice(0, n).map((x) => clip(typeof x === "string" ? x : (x as { name?: string; note?: string })?.name ? `${(x as { name?: string }).name}${(x as { note?: string }).note ? `(${clip((x as { note?: string }).note, 80)})` : ""}` : "", 120)).filter(Boolean).join(" / ").slice(0, cap) : "");

/** One labelled line per non-empty textual profile field, e.g. "- A사 · 강점: …". Capped per field and per company. */
export function profileEvidenceLines(companyName: string, p: CompanyProfilePayload | null): string[] {
  if (!p) return [];
  const fields: Array<[string, string]> = [
    ["사업 평가", clip(p.businessAssessment, 500)],
    ["강점", list(p.strengths, 6)],
    ["약점", list(p.weaknesses, 5)],
    ["산업 노출", list(p.industryExposure, 8)],
    ["SWOT 기회", list(p.swot?.opportunities, 4)],
    ["SWOT 위협", list(p.swot?.threats, 4)],
    ["경쟁 포지셔닝", clip(p.competitive?.positioning)],
    ["주요 경쟁사", list(p.competitive?.competitors, 6)],
    ...((p.stepSummaries ?? []).slice(0, 6).map((s) => [`분석 단계 ${s.title}`, clip(s.summary, 240)] as [string, string])),
  ];
  const lines: string[] = [];
  let total = 0;
  for (const [label, text] of fields) {
    if (!text) continue;
    const line = `- ${companyName} · ${label}: ${text}`;
    if (total + line.length > COMPANY_CAP) break;
    total += line.length;
    lines.push(line);
  }
  return lines;
}

export interface DisclosureItem { name: string; value: number; year?: string }

const fmtKrw = (v: number): string => (Math.abs(v) >= 1e8 ? `${Math.round(v / 1e8).toLocaleString("en-US")}억원` : `${Math.round(v).toLocaleString("en-US")}원`);

/** "[공시·재무 근거]" lines: stored DART account values (latest years first, compact). */
export function disclosureEvidenceLines(companyName: string, items: DisclosureItem[], maxItems = 24): string[] {
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
    lines.push(`- ${companyName} · 공시 ${y}: ${part.map((r) => `${clip(r.name, 30)} ${fmtKrw(r.value)}`).join(", ")}`);
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
