"use client";

// Analyst-provided evidence UI (ADR-0172 amendment 2026-10-15 (4)): generation inputs, 출처 추가, and 분석가 수정.
import { useState } from "react";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import type { Profile } from "./types.ts";
import { EDIT_FIELD_LABELS, EMPTY_EVIDENCE, EVIDENCE_HELP, evidenceFromProfile, overrideBody, sourceStatusChip, versionLabel } from "./profile-evidence.ts";
import { useTranslations } from "next-intl";

type SourceEntry = NonNullable<NonNullable<Profile["dataSources"]>["userSources"]>[number];

export function SourceStatusChip({ source }: { source: SourceEntry }) {
  const tr = useTranslations();
  const c = sourceStatusChip(source, tr);
  return <span className={`status-chip ${c.tone}`}><span aria-hidden="true">{c.icon}</span> {c.text}</span>;
}

export function AnalystEvidenceChip() {const t = useTranslations("components.ourCompany.profileEvidence");
  return <span className="status-chip status-in-progress" title={t("aProfileGeneratedFromSources")}>{t("evidence")}</span>;
}

export function AnalystEditedChip() {const t = useTranslations("components.ourCompany.profileEvidence"); const tc = useTranslations("common");
  return <span className="status-chip status-in-progress ml-1" title={t("anAnalystEditedThisItem")}>{tc("analystRevision")}</span>;
}

/** Per-item grounding chip (design 2026-11-13-profile-headless-fallback §6.5): shown only when the LLM
 * tagged the item "financial" AND DART data was actually available for the run. Text label keeps the
 * state readable without color (same inline precedent as AnalystEditedChip). */
export function FinancialGroundedChip({ profile, field, index }: { profile: Profile; field: keyof NonNullable<Profile["itemBasis"]>; index: number }) {
  const t = useTranslations("components.ourCompany.profileBasicTabs");
  if (profile.itemBasis?.[field]?.[index] !== "financial" || !profile.dartFinancials?.available) return null;
  return <span className="status-chip status-green">{t("financialGroundedChip")}</span>;
}

/** Inputs for (re)generation: note + URL list, prefilled from the last stored version, plus the last per-URL fetch status. */
export function ProfileEvidencePanel({ ctx, memberId, profile }: { ctx: OurCompanyStageState; memberId: string; profile: Profile | "loading" | undefined }) {const tr = useTranslations(); const t = useTranslations("components.ourCompany.profileEvidence");
  const { evidenceDrafts, setEvidenceDraft } = ctx;
  const draft = evidenceDrafts[memberId] ?? evidenceFromProfile(profile) ?? EMPTY_EVIDENCE;
  const last = profile && profile !== "loading" ? (profile.dataSources?.userSources ?? []).filter((s) => !s.manual && !s.removed) : [];
  return (
    <details className="mb-3" open={Boolean(draft.urls || draft.note)}>
      <summary className="cursor-pointer text-[length:var(--fs-body)] text-[color:var(--accent)]">{t("evidenceOptionalWhenExternalSearch")}</summary>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">{tr(EVIDENCE_HELP)}</p>
      <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`company-note-${memberId}`}>{t("companyIntroductionMemoDirectEntry")}</label>
      <textarea
        id={`company-note-${memberId}`}
        className="sizing-new-input w-full"
        rows={4}
        maxLength={2000}
        value={draft.note}
        onChange={(e) => setEvidenceDraft(memberId, { ...draft, note: e.target.value })}
      />
      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{draft.note.length}{t("n2000Chars")}</span>
      <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`source-urls-${memberId}`}>{t("evidenceUrlsOnePerLine")}</label>
      <textarea
        id={`source-urls-${memberId}`}
        className="sizing-new-input w-full"
        rows={4}
        placeholder="https://..."
        value={draft.urls}
        onChange={(e) => setEvidenceDraft(memberId, { ...draft, urls: e.target.value })}
      />
      {last.length > 0 && (
        <ul className="sizing-note-list mt-2" aria-label={t("collectionStatusOfTheLast")}>
          {last.map((s) => (
            <li key={s.url}><SourceStatusChip source={s} /> <span className="text-[length:var(--fs-caption)] break-all">{s.url}</span></li>
          ))}
        </ul>
      )}
    </details>
  );
}

const emptyEntry = { url: "", title: "", excerpt: "" };

/** 출처·데이터 tab: provided sources (links, chips), 출처 추가 form, edit/remove for hand-entered entries only, regenerate, version history. */
export function ProfileProvidedSources({ ctx, memberId, profile }: { ctx: OurCompanyStageState; memberId: string; profile: Profile }) {const tr = useTranslations(); const t = useTranslations("components.ourCompany.profileEvidence"); const tc = useTranslations("common");
  const { canAct, editBusy, addManualSource, updateManualSource, removeManualSource, analyzeMember, profileVersions, profiles } = ctx;
  const [form, setForm] = useState(emptyEntry);
  const [editingId, setEditingId] = useState<string | null>(null);
  const entries = (profile.dataSources?.userSources ?? []).filter((s) => !s.removed);
  const versions = profileVersions[memberId] ?? [];
  const submit = async () => {
    const okay = editingId ? await updateManualSource(memberId, editingId, form) : await addManualSource(memberId, form);
    if (okay) { setForm(emptyEntry); setEditingId(null); }
  };
  return (
    <section aria-label={t("sources")} className="mb-3">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("sources2")} {entries.length > 0 && <AnalystEvidenceChip />}</h3>
      {profile.userNote && <p className="text-[length:var(--fs-body)]"><strong>{t("companyIntroductionMemo")}</strong> {profile.userNote}</p>}
      {entries.length > 0 ? (
        <ul className="sizing-note-list">
          {entries.map((s, i) => (
            <li key={s.id ?? `${s.url}-${i}`}>
              <span className="text-[length:var(--fs-caption)]">[U{(profile.dataSources?.userSources ?? []).indexOf(s) + 1}]</span>{" "}
              <SourceStatusChip source={s} />{" "}
              {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent)] underline break-all">{s.title || s.url}</a> : <span>{s.title}</span>}
              {s.manual && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> {t("directEntry")}{s.addedAt ? ` ${s.addedAt.slice(0, 10)}` : ""}</span>}
              {s.manual && canAct && (
                <span className="ml-2">
                  <button type="button" className="btn-ghost btn-sm" disabled={editBusy} onClick={() => { setEditingId(s.id ?? null); setForm({ url: s.url, title: s.title ?? "", excerpt: s.excerpt ?? "" }); }}>{tc("edit")}</button>
                  <button type="button" className="btn-ghost btn-sm" disabled={editBusy} onClick={() => void removeManualSource(memberId, s.id!)}>{tc("delete")}</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">{t("noSources")}</p>
      )}
      {canAct && (
        <div className="mt-2">
          <h4 className="text-[length:var(--fs-body)]">{editingId ? t("editSource") : t("addSource")}</h4>
          <label className="block text-[length:var(--fs-caption)]" htmlFor="manual-source-url">{t("urlOptional")}</label>
          <input id="manual-source-url" className="sizing-new-input w-full" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." />
          <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor="manual-source-title">{t("title")}</label>
          <input id="manual-source-title" className="sizing-new-input w-full" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor="manual-source-excerpt">{t("excerptOrSummaryPaste4000")}</label>
          <textarea id="manual-source-excerpt" className="sizing-new-input w-full" rows={5} maxLength={4000} value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="note">{t("addingOrRemovingSourcesDoes")}</p>
          <button type="button" className="btn-ghost" disabled={editBusy || !form.title.trim() || !form.excerpt.trim()} onClick={() => void submit()}>{editingId ? t("saveChanges") : t("addSource2")}</button>
          {editingId && <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyEntry); }}>{tc("cancel")}</button>}
          <button type="button" className="btn-ghost ml-2" disabled={profiles[memberId] === "loading"} onClick={() => analyzeMember(memberId)}>{t("regenerateTheProfileFromThese")}</button>
        </div>
      )}
      {versions.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--fs-body)] text-[color:var(--accent)]">{t("versionHistory")}{versions.length}{tc("countSuffixParen")}</summary>
          <ul className="sizing-note-list">
            {versions.map((v) => (
              <li key={v.version_no}>
                v{v.version_no} · {v.created_at.slice(0, 16).replace("T", " ")} · {v.created_by}
                {versionLabel(v.source_ref, tr) && <span className="status-chip status-in-progress ml-1">{versionLabel(v.source_ref, tr)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** 분석가 수정: edit 산업 노출 / 강점 / 약점 / 사업 평가 in place; a reason is required and a new version is saved. */
export function ProfileFieldEditor({ ctx, memberId, profile }: { ctx: OurCompanyStageState; memberId: string; profile: Profile }) {const tr = useTranslations(); const t = useTranslations("components.ourCompany.profileEvidence"); const tc = useTranslations("common");
  const { canAct, editBusy, saveFieldOverrides } = ctx;
  const [open, setOpen] = useState(false);
  const initial = () => ({
    industryExposure: (profile.industryExposure ?? []).join("\n"),
    strengths: (profile.strengths ?? []).join("\n"),
    weaknesses: (profile.weaknesses ?? []).join("\n"),
    businessAssessment: profile.businessAssessment ?? "",
    reason: "",
    citeSource: "",
  });
  const [draft, setDraft] = useState(initial);
  if (!canAct) return null;
  if (!open) {
    return <button type="button" className="btn-ghost mb-2" onClick={() => { setDraft(initial()); setOpen(true); }}>{tc("analystRevision")}</button>;
  }
  const body = overrideBody(profile, draft);
  const changed = Object.keys(body).filter((k) => k in EDIT_FIELD_LABELS);
  const area = (key: "industryExposure" | "strengths" | "weaknesses", rows: number) => (
    <>
      <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor={`edit-${key}`}>{tr(EDIT_FIELD_LABELS[key])} {t("onePerLine")}</label>
      <textarea id={`edit-${key}`} className="sizing-new-input w-full" rows={rows} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </>
  );
  return (
    <section aria-label={tc("analystRevision")} className="sizing-grade-card mb-3">
      <h4 className="text-[length:var(--fs-body)]">{tc("analystRevision")} <AnalystEditedChip /></h4>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="note">{t("editingSavesANewVersion")}</p>
      {area("industryExposure", 3)}
      {area("strengths", 4)}
      {area("weaknesses", 4)}
      <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor="edit-businessAssessment">{tr(EDIT_FIELD_LABELS.businessAssessment)}</label>
      <textarea id="edit-businessAssessment" className="sizing-new-input w-full" rows={4} value={draft.businessAssessment} onChange={(e) => setDraft({ ...draft, businessAssessment: e.target.value })} />
      <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor="edit-reason">{t("editReasonAndSourceMemo")}</label>
      <input id="edit-reason" className="sizing-new-input w-full" maxLength={300} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
      <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor="edit-cite">{t("evidenceSourceNumberOptionalE")}</label>
      <input id="edit-cite" className="sizing-new-input sizing-new-input-sm" maxLength={6} value={draft.citeSource} onChange={(e) => setDraft({ ...draft, citeSource: e.target.value })} />
      <div className="mt-2">
        <button type="button" className="btn-ghost" disabled={editBusy || changed.length === 0 || !draft.reason.trim()} onClick={async () => { if (await saveFieldOverrides(memberId, body)) setOpen(false); }}>
          {editBusy ? tc("saving") : t("saveAsNewVersionP1", { p1: changed.length })}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>{tc("cancel")}</button>
      </div>
    </section>
  );
}

/** Marks an item edited by an analyst. */
export function isEditedItem(profile: Profile, field: "industryExposure" | "strengths" | "weaknesses", item: string): boolean {
  return Boolean(profile.analystEdited?.[field]?.includes(item));
}
