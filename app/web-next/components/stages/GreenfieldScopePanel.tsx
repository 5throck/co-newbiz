"use client";

// S9 greenfield scope summary (ADR-0160 + addenda; design 2026-10-12 section 6A). Judging happens only in
// the tabs below; this panel is a compact summary: sub-track, the people/organization plan readiness (what
// matters most for greenfield; the link to its tab is the main navigation), the human-only site_required
// confirmation as a compact secondary row (no primary button here), the workspace-scope opt-in with its
// before/after preview, warnings, and the single "judged X / Y" line for RBD / IV. The server owns the selection
// (GET /api/projects/:id/greenfield-scope); this component only displays it and forwards human acts.

import { useEffect, useId, useState } from "react";
import { api } from "../../lib/api.ts";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import {
  canOfferWorkspaceOptIn,
  countAnnouncement,
  countLocation,
  judgedLine,
  optInPreviewLines,
  outOfScopeSteps,
  peoplePlanView,
  showSubTrackPanel,
  siteDisclosureLabel,
  splitScopeWarnings,
  siteControlState,
  subTrackName,
  validateMigrationNote,
  validateSiteForm,
  workspaceView,
  type GfScope,
  type OptInPreviewLike,
  type WsDomainLike,
  scopeErrorText,
  siteFormMissing,
  REPLACED_JUDGED_HELP,
} from "../../lib/greenfield-dd-view.ts";

export function GreenfieldScopePanel({ projectId, scope, domains, meUserId, canAct, onChanged, onSelectTab }: {
  projectId: string;
  scope: GfScope;
  /** Domain tabs of the S9 payload; the judged line counts from them so numerator and denominator agree. */
  domains: WsDomainLike[];
  meUserId: string | null;
  canAct: boolean;
  onChanged: () => void;
  /** Selects a domain tab of the S9 payload by index (the people/organization link). */
  onSelectTab?: (index: number) => void;
}) {
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [value, setValue] = useState<boolean | null>(null);
  const [rationale, setRationale] = useState("");
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState<OptInPreviewLike | null>(null);
  const [optOpen, setOptOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  const base = `/api/projects/${encodeURIComponent(projectId)}/greenfield-scope`;
  const optBase = `${base}/workspace-opt-in`;
  const named = scope.sub_track_class === "existing_business_rbd" || scope.sub_track_class === "intra_venture";
  const wsActive = !!workspaceView(scope);

  // Read-only preview of the opt-in (nothing is written); only while the new workspace scope is not active.
  useEffect(() => {
    if (!named || wsActive) { setPreview(null); return; }
    let live = true;
    api.get<{ preview: OptInPreviewLike }>(optBase)
      .then((r) => { if (live) setPreview(r.data.preview); })
      .catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [named, wsActive, optBase, scope.opted_in]);

  // The null sub-track keeps the legacy view; only an unknown-value warning would still need to show.
  if (!showSubTrackPanel(scope)) return null;

  const site = siteControlState(scope, meUserId);
  const siteProblem = validateSiteForm({ value, rationale });
  const siteMissing = siteFormMissing({ value, rationale });
  const line = countLocation(scope) === "panel" ? judgedLine(scope, domains) : null;
  const outSteps = outOfScopeSteps(scope);
  const people = named ? peoplePlanView(scope, domains) : null;
  const { notes, warnings } = splitScopeWarnings(scope.warnings);
  // One primary action per view: this panel has none (the tabs own it); the site confirmation is secondary.

  async function act(body: Record<string, unknown>, success: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.post(base, body);
      setNotice(success);
      setTouched(false);
      setSiteOpen(false);
      onChanged();
      return true;
    } catch (e) {
      setError(scopeErrorText((e as { code?: string } | null)?.code, (e as { status?: number } | null)?.status, e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
    }
    return false;
  }

  return (
    <section className="market-section sizing-step mb-3" aria-label="그린필드 세부 트랙 범위 요약" data-testid="gf-scope-panel">
      <h3 className="sizing-step-title text-[0.9rem]">범위 요약 — {subTrackName(scope)}</h3> {/* INTERIM-WORDING */}

      {people && (
        <div role="group" aria-labelledby={`${uid}-people`} className="mb-2" data-testid="gf-people-plan">
          <p id={`${uid}-people`} className="mb-1"><strong>{people.heading}</strong></p> {/* INTERIM-WORDING */}
          <p className="text-[length:var(--fs-body)]">
            {people.tabIndex !== null && onSelectTab ? (
              <a href="#dd-tab-hr" data-testid="gf-people-link" onClick={(e) => { e.preventDefault(); onSelectTab(people.tabIndex!); }}>{people.tabLabel} 탭에서 판정하기</a>
            ) : (
              <strong>{people.tabLabel}</strong>
            )}
            {" "}<span className="tabular-nums" data-testid="gf-people-judged">판정 {people.judged} / {people.judgeable}</span>
            {people.reference && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> (참고값 — 완료 집계에는 포함되지 않습니다)</span>} {/* INTERIM-WORDING */}
          </p>
          {people.steps.length > 0 && (
            <ul className="text-[length:var(--fs-caption)] mt-1" data-testid="gf-people-steps">
              {people.steps.map((st) => (
                <li key={st.step}>
                  {st.step}단계 {st.label}: <span className="status-chip status-not-started"><span aria-hidden="true">{st.icon} </span>{st.text}</span>
                  {st.detail && <span className="text-[color:var(--muted-fg)]"> — {st.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <ul role="status" className="mb-2" data-testid="gf-scope-warnings">
          {warnings.map((w) => (
            <li key={w} className="status-chip status-amber block mb-1"><span aria-hidden="true">⚠ </span>{w}</li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}

      {named && (
        <div role="group" aria-labelledby={`${uid}-site`} className="text-[length:var(--fs-caption)] mt-1" data-testid="gf-site-required">
          <p id={`${uid}-site`} className="mb-1">
            <span className={`status-chip ${site.kind === "confirmed" ? "status-green" : site.kind === "unconfirmed" ? "status-info" : "status-not-started"}`}>
              <span aria-hidden="true">{site.icon} </span>
              {site.kind === "confirmed" || site.kind === "default" ? `부지: ${site.text}` : site.text}
            </span>
          </p>
          {site.kind === "unconfirmed" && notes.length > 0 && (
            <ul role="note" className="mb-1 text-[color:var(--muted-fg)]" data-testid="gf-scope-notes">
              {notes.map((n) => <li key={n}><span aria-hidden="true">ⓘ </span>{n}</li>)}
            </ul>
          )}

          {canAct ? (
            <details open={siteOpen} onToggle={(e) => setSiteOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="gf-site-disclosure">
              <summary className="cursor-pointer" style={{ minHeight: "2.75rem" }}>{siteDisclosureLabel(site.kind)}</summary>
              <form
                aria-label="부지 필요 여부 확인" /* INTERIM-WORDING: success notice says the confirmation applies immediately */
                onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!siteProblem) void act({ action: "confirm_site_required", site_required: value, rationale: rationale.trim() }, "부지 필요 여부 확인을 기록했습니다 — 바로 적용됩니다.").then((ok) => { if (ok) { setValue(null); setRationale(""); } }); }}
              >
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="text-[length:var(--fs-caption)] font-semibold mb-1">이 계획에 새 부지나 부지 확장이 필요한가 (필수)</legend>
                  <div role="radiogroup" className="flex flex-wrap gap-3 text-[length:var(--fs-caption)]">
                    <label className="flex items-center gap-1" style={{ minHeight: "2.75rem" }}>
                      <input type="radio" name={`${uid}-site-value`} checked={value === true} onChange={() => setValue(true)} /> 필요 — 부지 단계 적용
                    </label>
                    <label className="flex items-center gap-1" style={{ minHeight: "2.75rem" }}>
                      <input type="radio" name={`${uid}-site-value`} checked={value === false} onChange={() => setValue(false)} /> 불필요 — 부지 단계 제외
                    </label>
                  </div>
                </fieldset>
                <div className="flex flex-wrap items-end gap-2 mt-1 text-[length:var(--fs-caption)]">
                  <label htmlFor={`${uid}-why`}>확인 근거 (필수)
                    <input id={`${uid}-why`} className="sizing-new-input ml-1" style={{ minWidth: "16rem" }} value={rationale} aria-invalid={touched && !rationale.trim()} onChange={(e) => setRationale(e.target.value)} />
                  </label>
                  <button type="submit" className="btn-ghost btn-sm" disabled={busy || siteMissing.length > 0} aria-describedby={`${uid}-missing`}>부지 필요 여부 확인</button>
                </div>
                <p id={`${uid}-missing`} role="note" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                  사람만 확인할 수 있으며, 확인하면 바로 적용됩니다. 바뀐 경우 새 근거를 적어 다시 확인할 수 있습니다. 에이전트는 제안만 합니다. {/* INTERIM-WORDING */}
                  {siteMissing.length > 0 ? `확인 버튼을 쓰려면 먼저 입력하세요: ${siteMissing.join(", ")}.` : "입력이 끝났습니다 — 확인 버튼을 눌러야 기록됩니다. 선택만으로는 기록되지 않습니다."} {/* INTERIM-WORDING */}
                </p>
                {touched && siteProblem && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1">✕ {siteProblem}</p>}
              </form>
            </details>
          ) : (
            <p className="text-[color:var(--muted-fg)]">확인은 analyst 역할 이상의 사람만 할 수 있습니다.</p>
          )}
        </div>
      )}

      {outSteps.length > 0 && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2" data-testid="gf-out-of-scope">
          <strong>범위 밖 단계:</strong>{" "} {/* INTERIM-WORDING */}
          {outSteps.map((s) => `${s.step}단계 ${s.label}`).join(", ")} — 각 단계가 걸린 탭 머리글에서 이유를 볼 수 있습니다.
        </p>
      )}

      {line && (
        <p className="mt-2 text-[length:var(--fs-body)]" data-testid="gf-judged-line">
          <span role="status" aria-live="polite" aria-atomic="true">
            <strong className="tabular-nums">{line.text}</strong>
            <span className="ml-3">필수 미충족 <span className="tabular-nums">{line.mandatoryUnmet}</span>건</span> {/* INTERIM-WORDING */}
            <span className="ml-3">트랙 규칙으로 제외 <span className="tabular-nums">{line.excluded}</span>건</span> {/* INTERIM-WORDING */}
            <span className="sr-only">{countAnnouncement(line)}</span>
          </span>
          {line.replacedCount > 0 && (
            <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="gf-replaced-help">{REPLACED_JUDGED_HELP}</span>
          )}
          {line.extra && (
            <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              추가 체크리스트(R&BD 기술·법인 설립 등) 판정 {line.extra.judged} / {line.extra.judgeable} — 위 줄과 별도로 센 값입니다. {/* INTERIM-WORDING */}
            </span>
          )}
        </p>
      )}

      {named && !wsActive && canOfferWorkspaceOptIn(preview) && (
        <div className="mt-3" data-testid="gf-optin">
          <p className="text-[length:var(--fs-caption)] mb-1">
            이 프로젝트는 새 작업 범위 규칙 도입 전에 시작되어 기존 범위가 유지됩니다. 사람이 전환 사유를 기록하면 트랙에 맞는 범위로 바뀝니다. 이미 기록된 판정은 지워지지 않습니다. {/* INTERIM-WORDING */}
          </p>
          {canAct ? (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setOptOpen(true)}>새 작업 범위로 전환 미리보기</button>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">전환은 analyst 역할 이상의 사람만 할 수 있습니다.</p>
          )}
        </div>
      )}

      {optOpen && preview && (
        <WorkspaceOptInDialog
          preview={preview}
          optBase={optBase}
          onClose={() => setOptOpen(false)}
          onDone={() => { setOptOpen(false); setNotice("새 작업 범위로 전환했습니다. 기존 판정은 모두 보존됩니다."); onChanged(); }}
        />
      )}
    </section>
  );
}

/** Opt-in dialog: shows the server preview (before / after), then a required migration_note. A person confirms; nothing is written before. */
function WorkspaceOptInDialog({ preview, optBase, onClose, onDone }: {
  preview: OptInPreviewLike;
  optBase: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = validateMigrationNote(note);
  async function submit() {
    setTouched(true);
    if (problem || saving) return;
    setSaving(true); setError(null);
    try {
      await api.post(optBase, { migration_note: note.trim() });
      onDone();
    } catch (e) {
      setError(scopeErrorText((e as { code?: string } | null)?.code, (e as { status?: number } | null)?.status, e instanceof Error ? e.message : ""));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="gf-optin-title" style={{ maxWidth: "40rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="gf-optin-title" className="text-[1rem] font-semibold mb-1">새 작업 범위로 전환</h3> {/* INTERIM-WORDING */}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">아래는 미리보기이며 아직 아무것도 기록되지 않았습니다.</p>
        <ul className="sizing-note-list mb-3" data-testid="gf-optin-preview">
          {optInPreviewLines(preview).map((l) => <li key={l}>{l}</li>)}
        </ul>
        <label className="text-[length:var(--fs-caption)] block" htmlFor="gf-optin-note">전환 사유 (필수)</label>
        <textarea
          id="gf-optin-note"
          className="sizing-new-input mt-1 w-full"
          rows={3}
          value={note}
          maxLength={2000}
          required
          aria-required="true"
          aria-invalid={touched && !!problem}
          aria-describedby="gf-optin-error"
          onChange={(e) => setNote(e.target.value)}
        />
        <p id="gf-optin-error" role="alert" aria-live="assertive" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1 min-h-[1.25rem]">
          {error ? `✕ ${error}` : touched && problem ? `✕ ${problem}` : ""}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-premium btn-sm" disabled={saving} onClick={() => void submit()}>{saving ? "기록 중..." : "전환 기록"}</button>
        </div>
      </div>
    </div>
  );
}
