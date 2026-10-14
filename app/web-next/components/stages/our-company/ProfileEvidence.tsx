"use client";

// Analyst-provided evidence UI (ADR-0172 amendment 2026-10-15 (4)): generation inputs, 출처 추가, and 분석가 수정.
import { useState } from "react";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import type { Profile } from "./types.ts";
import { EDIT_FIELD_LABELS, EMPTY_EVIDENCE, EVIDENCE_HELP, evidenceFromProfile, overrideBody, sourceStatusChip, versionLabel } from "./profile-evidence.ts";

type SourceEntry = NonNullable<NonNullable<Profile["dataSources"]>["userSources"]>[number];

export function SourceStatusChip({ source }: { source: SourceEntry }) {
  const c = sourceStatusChip(source);
  return <span className={`status-chip ${c.tone}`}><span aria-hidden="true">{c.icon}</span> {c.text}</span>;
}

export function AnalystEvidenceChip() {
  return <span className="status-chip status-in-progress" title="분석가가 제공한 출처·소개 메모를 근거로 생성된 프로파일입니다">분석가 제공 근거</span>;
}

export function AnalystEditedChip() {
  return <span className="status-chip status-in-progress ml-1" title="분석가가 직접 수정한 항목입니다 — 사유는 검증 원장에 기록됩니다">분석가 수정</span>;
}

/** Inputs for (re)generation: note + URL list, prefilled from the last stored version, plus the last per-URL fetch status. */
export function ProfileEvidencePanel({ ctx, memberId, profile }: { ctx: OurCompanyStageState; memberId: string; profile: Profile | "loading" | undefined }) {
  const { evidenceDrafts, setEvidenceDraft } = ctx;
  const draft = evidenceDrafts[memberId] ?? evidenceFromProfile(profile) ?? EMPTY_EVIDENCE;
  const last = profile && profile !== "loading" ? (profile.dataSources?.userSources ?? []).filter((s) => !s.manual && !s.removed) : [];
  return (
    <details className="mb-3" open={Boolean(draft.urls || draft.note)}>
      <summary className="cursor-pointer text-[length:var(--fs-body)] text-[color:var(--accent)]">분석가 제공 근거 (선택) — 외부 검색이 막혔거나 틀릴 때</summary>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">{EVIDENCE_HELP}</p>
      <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`company-note-${memberId}`}>회사 소개 메모(직접 입력)</label>
      <textarea
        id={`company-note-${memberId}`}
        className="sizing-new-input w-full"
        rows={4}
        maxLength={2000}
        value={draft.note}
        onChange={(e) => setEvidenceDraft(memberId, { ...draft, note: e.target.value })}
      />
      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{draft.note.length}/2000자</span>
      <label className="block text-[length:var(--fs-caption)] mt-2" htmlFor={`source-urls-${memberId}`}>근거 주소(URL, 한 줄에 하나)</label>
      <textarea
        id={`source-urls-${memberId}`}
        className="sizing-new-input w-full"
        rows={4}
        placeholder="https://..."
        value={draft.urls}
        onChange={(e) => setEvidenceDraft(memberId, { ...draft, urls: e.target.value })}
      />
      {last.length > 0 && (
        <ul className="sizing-note-list mt-2" aria-label="지난 생성의 주소별 수집 상태">
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
export function ProfileProvidedSources({ ctx, memberId, profile }: { ctx: OurCompanyStageState; memberId: string; profile: Profile }) {
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
    <section aria-label="분석가 제공 출처" className="mb-3">
      <h3 className="sizing-step-title text-[0.95rem]">분석가 제공 출처 {entries.length > 0 && <AnalystEvidenceChip />}</h3>
      {profile.userNote && <p className="text-[length:var(--fs-body)]"><strong>회사 소개 메모:</strong> {profile.userNote}</p>}
      {entries.length > 0 ? (
        <ul className="sizing-note-list">
          {entries.map((s, i) => (
            <li key={s.id ?? `${s.url}-${i}`}>
              <span className="text-[length:var(--fs-caption)]">[U{(profile.dataSources?.userSources ?? []).indexOf(s) + 1}]</span>{" "}
              <SourceStatusChip source={s} />{" "}
              {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[color:var(--accent)] underline break-all">{s.title || s.url}</a> : <span>{s.title}</span>}
              {s.manual && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> · 직접 입력{s.addedAt ? ` ${s.addedAt.slice(0, 10)}` : ""}</span>}
              {s.manual && canAct && (
                <span className="ml-2">
                  <button type="button" className="btn-ghost btn-sm" disabled={editBusy} onClick={() => { setEditingId(s.id ?? null); setForm({ url: s.url, title: s.title ?? "", excerpt: s.excerpt ?? "" }); }}>수정</button>
                  <button type="button" className="btn-ghost btn-sm" disabled={editBusy} onClick={() => void removeManualSource(memberId, s.id!)}>삭제</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">분석가가 제공한 출처가 없습니다.</p>
      )}
      {canAct && (
        <div className="mt-2">
          <h4 className="text-[0.9rem]">{editingId ? "출처 수정" : "출처 추가"}</h4>
          <label className="block text-[length:var(--fs-caption)]" htmlFor="manual-source-url">주소(URL, 선택)</label>
          <input id="manual-source-url" className="sizing-new-input w-full" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." />
          <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor="manual-source-title">제목</label>
          <input id="manual-source-title" className="sizing-new-input w-full" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor="manual-source-excerpt">발췌·요약 (붙여넣기, 4000자 이하)</label>
          <textarea id="manual-source-excerpt" className="sizing-new-input w-full" rows={5} maxLength={4000} value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="note">출처를 추가·삭제해도 프로파일 본문은 바뀌지 않습니다. 아래 &quot;이 출처로 프로필 다시 생성&quot;을 눌러야 반영됩니다.</p>
          <button type="button" className="btn-ghost" disabled={editBusy || !form.title.trim() || !form.excerpt.trim()} onClick={() => void submit()}>{editingId ? "수정 저장" : "출처 추가"}</button>
          {editingId && <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyEntry); }}>취소</button>}
          <button type="button" className="btn-ghost ml-2" disabled={profiles[memberId] === "loading"} onClick={() => analyzeMember(memberId)}>이 출처로 프로필 다시 생성</button>
        </div>
      )}
      {versions.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--fs-body)] text-[color:var(--accent)]">버전 이력 ({versions.length}건)</summary>
          <ul className="sizing-note-list">
            {versions.map((v) => (
              <li key={v.version_no}>
                v{v.version_no} · {v.created_at.slice(0, 16).replace("T", " ")} · {v.created_by}
                {versionLabel(v.source_ref) && <span className="status-chip status-in-progress ml-1">{versionLabel(v.source_ref)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** 분석가 수정: edit 산업 노출 / 강점 / 약점 / 사업 평가 in place; a reason is required and a new version is saved. */
export function ProfileFieldEditor({ ctx, memberId, profile }: { ctx: OurCompanyStageState; memberId: string; profile: Profile }) {
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
    return <button type="button" className="btn-ghost mb-2" onClick={() => { setDraft(initial()); setOpen(true); }}>분석가 수정</button>;
  }
  const body = overrideBody(profile, draft);
  const changed = Object.keys(body).filter((k) => k in EDIT_FIELD_LABELS);
  const area = (key: "industryExposure" | "strengths" | "weaknesses", rows: number) => (
    <>
      <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor={`edit-${key}`}>{EDIT_FIELD_LABELS[key]} (한 줄에 하나)</label>
      <textarea id={`edit-${key}`} className="sizing-new-input w-full" rows={rows} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </>
  );
  return (
    <section aria-label="분석가 수정" className="sizing-grade-card mb-3">
      <h4 className="text-[0.9rem]">분석가 수정 <AnalystEditedChip /></h4>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="note">수정하면 새 버전으로 저장되고(이전 버전은 보존), 수정한 항목은 사유와 함께 검증 원장에 &quot;확인&quot;으로 기록됩니다. 사유는 필수입니다.</p>
      {area("industryExposure", 3)}
      {area("strengths", 4)}
      {area("weaknesses", 4)}
      <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor="edit-businessAssessment">{EDIT_FIELD_LABELS.businessAssessment}</label>
      <textarea id="edit-businessAssessment" className="sizing-new-input w-full" rows={4} value={draft.businessAssessment} onChange={(e) => setDraft({ ...draft, businessAssessment: e.target.value })} />
      <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor="edit-reason">수정 사유·출처 메모 (필수)</label>
      <input id="edit-reason" className="sizing-new-input w-full" maxLength={300} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
      <label className="block text-[length:var(--fs-caption)] mt-1" htmlFor="edit-cite">근거 출처 번호 (선택, 예: U1 또는 N)</label>
      <input id="edit-cite" className="sizing-new-input sizing-new-input-sm" maxLength={6} value={draft.citeSource} onChange={(e) => setDraft({ ...draft, citeSource: e.target.value })} />
      <div className="mt-2">
        <button type="button" className="btn-ghost" disabled={editBusy || changed.length === 0 || !draft.reason.trim()} onClick={async () => { if (await saveFieldOverrides(memberId, body)) setOpen(false); }}>
          {editBusy ? "저장 중..." : `새 버전으로 저장 (${changed.length}개 항목)`}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>취소</button>
      </div>
    </section>
  );
}

/** Marks an item edited by an analyst. */
export function isEditedItem(profile: Profile, field: "industryExposure" | "strengths" | "weaknesses", item: string): boolean {
  return Boolean(profile.analystEdited?.[field]?.includes(item));
}
