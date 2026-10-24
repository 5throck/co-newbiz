// @version 1.0.0
/**
 * Analyst edits of an EXISTING company profile (ADR-0172 amendment 2026-10-15 (4)):
 *   - manual source entries ("출처 추가": optional URL, title, pasted excerpt) stored in dataSources.userSources;
 *   - field overrides of 산업 노출 / 강점 / 약점 / 사업 평가 with a required reason.
 * Every change is a NEW company_profile_version row (append-only; older versions stay) created_by the calling user with
 * source_ref "analyst_source" / "analyst_edit" and an audit entry under that user (no agent identity). Source changes never
 * rewrite profile text; field overrides mark the edited items "confirmed" in the verificationLedger.
 */
import { appendAudit } from "../../../db/lib/access-control.ts";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { deriveIndustryLinkage, loadLatestProfile, type CompanyProfilePayload } from "./company-profile-pipeline.ts";
import { activeUserSources, hasUsableAnalystEvidence } from "./profile-analyst-sources.ts";
import { isNoResearchDegraded } from "./profile-degraded.ts";
import { isAllowedUrlShape, stripControlChars, type UserSourceRecord } from "./safe-fetch-text.ts";

type Db = ReturnType<typeof getDb>;
type Subject = { kind: "member" | "company"; id: string };

export const MAX_EXCERPT_CHARS = 4000;
export const MAX_TITLE_CHARS = 200;
export const MAX_REASON_CHARS = 300;
const LIMITS = {
  industryExposure: { items: 12, chars: 100 },
  strengths: { items: 8, chars: 300 },
  weaknesses: { items: 8, chars: 300 },
  businessAssessment: { chars: 1500 },
} as const;

export class EditError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

const HTML_RE = /<\/?[a-z!][^>]*>/i;
function cleanText(v: unknown, field: string, max: number, required = false): string {
  if (v === undefined || v === null) { if (required) throw new EditError("invalid_field", `${field} is required.`); return ""; }
  if (typeof v !== "string") throw new EditError("invalid_field", `${field} must be a string.`);
  const t = stripControlChars(v).replace(/[ \t]+/g, " ").trim();
  if (required && !t) throw new EditError("invalid_field", `${field} is required.`);
  if (t.length > max) throw new EditError("field_too_long", `${field} must be at most ${max} characters.`);
  if (HTML_RE.test(t)) throw new EditError("html_not_allowed", `${field} must not contain HTML.`);
  return t;
}

const columnOf = (s: Subject) => (s.kind === "member" ? "member_id" : "company_id");

function requireLatest(db: Db, subject: Subject): CompanyProfilePayload {
  const profile = loadLatestProfile(db, subject);
  if (!profile) throw new EditError("no_profile", "No profile yet — run the analysis first.", 404);
  return profile;
}

/** Stores a copy of the payload as the next version and audits the human action. Returns the new version number. */
function saveVersion(db: Db, subject: Subject, userId: string, profile: CompanyProfilePayload, sourceRef: "analyst_edit" | "analyst_source", auditAction: string): number {
  const col = columnOf(subject);
  const now = new Date().toISOString();
  let versionNo = 0;
  db.transaction(() => {
    versionNo = ((db.query(`SELECT MAX(version_no) m FROM company_profile_version WHERE ${col} = ?`).get(subject.id) as { m: number | null }).m ?? 0) + 1;
    db.run(
      `INSERT INTO company_profile_version (id, ${col}, version_no, payload, source_ref, created_by, created_at) VALUES (?,?,?,?,?,?,?)`,
      [ulid(), subject.id, versionNo, JSON.stringify({ methodology: "company-profile v3", schemaVersion: 3, profile }), sourceRef, userId, now],
    );
    // The audit entry names the action and target only — never the reason, excerpt or note text.
    appendAudit(db, { actor: userId, action: auditAction, target: `${subject.kind}:${subject.id}:v${versionNo}`, now });
  })();
  return versionNo;
}

function clone(profile: CompanyProfilePayload): CompanyProfilePayload {
  return JSON.parse(JSON.stringify(profile)) as CompanyProfilePayload;
}

function syncSourceViews(p: CompanyProfilePayload): void {
  const all = p.dataSources.userSources ?? [];
  const active = all.filter((x) => !x.removed);
  p.dataSources.userSourceCount = active.length;
  // researchSources: pipeline/search results stay; analyst entries are rebuilt from the active list.
  const others = p.researchSources.filter((x) => !x.provided);
  p.researchSources = [
    ...active.map((x) => ({
      title: x.title || x.url || "분석가 입력 출처",
      url: x.url,
      snippet: x.manual ? "분석가가 직접 입력한 출처" : x.status === "ok" ? "분석가 제공 출처" : x.status === "thin" ? "분석가 제공 출처(본문 부족 — 주소만 기록)" : `분석가 제공 출처(수집 실패: ${x.reason ?? ""})`,
      provided: true as const,
    })),
    ...others,
  ];
}

const labelOf = (x: UserSourceRecord) => x.url || x.title || x.id || "";

export interface ManualSourceInput { url?: unknown; title?: unknown; excerpt?: unknown }

function parseManual(input: ManualSourceInput): { url: string; title: string; excerpt: string } {
  const url = cleanText(input.url, "주소", 2000);
  if (url && !isAllowedUrlShape(url)) throw new EditError("invalid_source_urls", `Invalid URL: ${url.slice(0, 200)}`);
  const title = cleanText(input.title, "제목", MAX_TITLE_CHARS, true);
  const excerpt = cleanText(input.excerpt, "발췌/요약", MAX_EXCERPT_CHARS, true);
  return { url, title, excerpt };
}

/** Manual source: no profile text change; the next regeneration uses it as [Un] evidence. */
export function addManualSource(db: Db, subject: Subject, userId: string, input: ManualSourceInput): { versionNo: number; source: UserSourceRecord } {
  const { url, title, excerpt } = parseManual(input);
  const profile = clone(requireLatest(db, subject));
  const list = profile.dataSources.userSources ?? [];
  if (list.filter((x) => !x.removed).length >= 8) throw new EditError("too_many_sources", "At most 8 analyst-supplied sources are allowed.");
  const source: UserSourceRecord = {
    url, title, fetched: true, charCount: excerpt.length, status: "ok",
    provided: true, manual: true, id: ulid(), addedBy: userId, addedAt: new Date().toISOString(), excerpt,
  };
  profile.dataSources.userSources = [...list, source];
  syncSourceViews(profile);
  return { versionNo: saveVersion(db, subject, userId, profile, "analyst_source", "profile.source.add"), source };
}

function findManual(profile: CompanyProfilePayload, sourceId: string): UserSourceRecord {
  const entry = (profile.dataSources.userSources ?? []).find((x) => x.id === sourceId && !x.removed);
  if (!entry) throw new EditError("source_not_found", "Source not found.", 404);
  // Pipeline-collected (fetched or searched) sources are never editable or removable by hand.
  if (!entry.manual) throw new EditError("source_not_editable", "Only directly-entered sources can be edited or deleted.", 403);
  return entry;
}

export function updateManualSource(db: Db, subject: Subject, userId: string, sourceId: string, input: ManualSourceInput): { versionNo: number } {
  const { url, title, excerpt } = parseManual(input);
  const profile = clone(requireLatest(db, subject));
  const entry = findManual(profile, sourceId);
  Object.assign(entry, { url, title, excerpt, charCount: excerpt.length });
  syncSourceViews(profile);
  return { versionNo: saveVersion(db, subject, userId, profile, "analyst_source", "profile.source.update") };
}

/** Soft remove (slot kept so [Un] numbers stay stable); ledger items confirmed by it fall back to needs_judgement. */
export function removeManualSource(db: Db, subject: Subject, userId: string, sourceId: string): { versionNo: number } {
  const profile = clone(requireLatest(db, subject));
  const entry = findManual(profile, sourceId);
  entry.removed = true;
  const label = labelOf(entry);
  profile.verificationLedger = (profile.verificationLedger ?? []).map((l) =>
    label && l.evidence.includes(label) && l.status === "confirmed"
      ? { ...l, status: "needs_judgement" as const, evidence: `출처 제거됨 — 재확인 필요 (이전 근거: ${l.evidence.slice(0, 120)})` }
      : l);
  syncSourceViews(profile);
  return { versionNo: saveVersion(db, subject, userId, profile, "analyst_source", "profile.source.remove") };
}

export interface FieldOverrideInput {
  industryExposure?: unknown;
  strengths?: unknown;
  weaknesses?: unknown;
  businessAssessment?: unknown;
  reason?: unknown;
  /** Optional provided-source number ("U2") or "N" (the note) backing the change. */
  citeSource?: unknown;
}
const LIST_FIELDS = ["industryExposure", "strengths", "weaknesses"] as const;
type ListField = (typeof LIST_FIELDS)[number];
const LEDGER_PREFIX: Record<ListField, string> = { industryExposure: "산업 노출", strengths: "강점", weaknesses: "약점" };

function cleanList(v: unknown, field: ListField): string[] {
  if (!Array.isArray(v)) throw new EditError("invalid_field", `${field} must be an array of strings.`);
  const lim = LIMITS[field];
  const out = v.map((x) => cleanText(x, field, lim.chars)).filter(Boolean);
  if (out.length > lim.items) throw new EditError("too_many_items", `${field} allows at most ${lim.items} items.`);
  return [...new Set(out)];
}

/** Resolves a cited provided-source reference ("U2"/"N") to a ledger evidence label; throws when it does not exist. */
function citedLabel(profile: CompanyProfilePayload, cite: unknown): string | null {
  if (cite === undefined || cite === null || cite === "") return null;
  if (typeof cite !== "string" || !/^(U\d+|N)$/.test(cite)) throw new EditError("invalid_cite", "citeSource must be a U-number or N format.");
  if (cite === "N") {
    if (!profile.dataSources.analystNote) throw new EditError("invalid_cite", "No analyst note exists.");
    return "분석가 소개 메모";
  }
  const src = (profile.dataSources.userSources ?? [])[Number(cite.slice(1)) - 1];
  if (!src || src.removed || src.status !== "ok") throw new EditError("invalid_cite", `${cite} is not an analyst-supplied source usable as evidence.`);
  return labelOf(src);
}

export function applyFieldOverrides(db: Db, subject: Subject, userId: string, input: FieldOverrideInput): { versionNo: number; fields: string[] } {
  const reason = cleanText(input.reason, "사유", MAX_REASON_CHARS, true);
  const profile = clone(requireLatest(db, subject));
  const label = citedLabel(profile, input.citeSource);
  const evidence = `분석가 직접 수정(사유: ${reason})${label ? ` · 근거: ${label}` : ""}`;
  const edited: NonNullable<CompanyProfilePayload["analystEdited"]> = {
    industryExposure: [...(profile.analystEdited?.industryExposure ?? [])],
    strengths: [...(profile.analystEdited?.strengths ?? [])],
    weaknesses: [...(profile.analystEdited?.weaknesses ?? [])],
    businessAssessment: profile.analystEdited?.businessAssessment ?? false,
  };
  let ledger = [...(profile.verificationLedger ?? [])];
  const changed: string[] = [];

  for (const field of LIST_FIELDS) {
    if (input[field] === undefined) continue;
    const next = cleanList(input[field], field);
    const prev = profile[field] ?? [];
    if (next.length === prev.length && next.every((x, i) => x === prev[i])) continue;
    const prefix = LEDGER_PREFIX[field];
    const key = (x: string) => `${prefix}: ${x.slice(0, 60)}`;
    const prevKeys = new Set(prev.map(key));
    const keptLedger = new Map(ledger.filter((l) => prevKeys.has(l.item)).map((l) => [l.item, l]));
    ledger = ledger.filter((l) => !(l.item.startsWith(`${prefix}: `)));
    for (const x of next) {
      const k = key(x);
      if (prev.includes(x) && keptLedger.has(k)) ledger.push(keptLedger.get(k)!);
      else ledger.push({ item: k, status: "confirmed", evidence });
    }
    edited[field] = [...edited[field].filter((x) => next.includes(x)), ...next.filter((x) => !prev.includes(x))];
    profile[field] = next;
    changed.push(field);
  }
  if (input.businessAssessment !== undefined) {
    const text = cleanText(input.businessAssessment, "businessAssessment", LIMITS.businessAssessment.chars);
    if (text !== (profile.businessAssessment ?? "")) {
      profile.businessAssessment = text;
      ledger = ledger.filter((l) => l.item !== "사업 평가");
      if (text) ledger.push({ item: "사업 평가", status: "confirmed", evidence });
      edited.businessAssessment = Boolean(text);
      changed.push("businessAssessment");
    }
  }
  if (changed.length === 0) throw new EditError("no_changes", "Nothing changed.");

  if (changed.includes("industryExposure")) profile.industryLinkage = deriveIndustryLinkage(db, profile.industryExposure);
  profile.analystEdited = edited;
  profile.verificationLedger = ledger;
  profile.analystEditLog = [
    ...(profile.analystEditLog ?? []).slice(-19),
    { fields: changed, reason, source: label ?? undefined, editedBy: userId, editedAt: new Date().toISOString() },
  ];
  // The no-search-evidence flag clears only when analyst-provided evidence exists; an LLM-failure fallback stays.
  if (isNoResearchDegraded(profile.degraded) && hasUsableAnalystEvidence(profile) && activeUserSources(profile).length + (profile.dataSources.analystNote ? 1 : 0) > 0) {
    profile.degraded = null;
  }
  return { versionNo: saveVersion(db, subject, userId, profile, "analyst_edit", `profile.override fields=${changed.join("+")}`), fields: changed };
}
