"use client";

// Closure modal (ADR-0152 §3.5, Wave F PR F-1). One modal for projects and
// opportunities: pick a closure type, see each type's blocking preconditions
// as text + icon (never color alone), supply the reason and learning capture,
// confirm. Closing is a HUMAN decision — the primary button says "close",
// never "approve", and the server rejects agent identities. Unmet
// preconditions keep submit disabled with the reason stated in text, and link
// to the place where the missing record is created.
import { useTranslations } from "next-intl";
import { CLOSURE_TYPE_KEY, TRANSITION_DECISION_KEY, closureRecordKeyOf } from "../lib/label-keys.ts";
import { localizeMessage } from "../lib/labels.ts";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { api } from "../lib/api.ts";
import { useModalFocus } from "../lib/use-modal-focus.ts";

export type ClosureEntity = "project" | "opportunity";
type ClosureType =
  | "killed_at_gate"
  | "withdrawn"
  | "graduated_to_core"
  | "divested"
  | "killed_with_learning"
  | "dropped";

interface MissingRecord {
  record: string;
  message: string;
}
interface TypePreconditions {
  satisfied: boolean;
  missing: MissingRecord[];
  requires_learning_capture: boolean;
  min_reason_length: number;
}

// i18n (T3-6): the type name resolves through common.closureType.* and the hint through
// common.closureType.hint* at render; hints that quote a transition term take it as {p1}.
const TYPE_HINT_KEY: Record<ClosureType, string> = {
  killed_at_gate: "common.closureType.hintKilledAtGate",
  withdrawn: "common.closureType.hintWithdrawn",
  graduated_to_core: "common.closureType.hintGraduatedToCore",
  divested: "common.closureType.hintDivested",
  killed_with_learning: "common.closureType.hintKilledWithLearning",
  dropped: "common.closureType.hintDropped",
};

function recordLink(entity: ClosureEntity, id: string, record: string): { href: string; label: string } | null {
  if (record.startsWith("gate_decision")) {
    return entity === "project"
      ? { href: `/projects/${id}/process`, label: "게이트 결정 화면에서 기록" }
      : { href: `/opportunities/${id}`, label: "기회 화면에서 게이트 결정 확인" };
  }
  if (record.startsWith("venture_transition_decision"))
    return { href: `/projects/${id}/portfolio`, label: "S12 포트폴리오 화면에서 기록" };
  return null;
}

export function ClosureModal({
  entity,
  entityId,
  entityName,
  onClose,
  onDone,
}: {
  entity: ClosureEntity;
  entityId: string;
  entityName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const tr = useTranslations();
  const uid = useId();
  const base =
    entity === "project"
      ? `/api/projects/${encodeURIComponent(entityId)}/close`
      : `/api/opportunities/${encodeURIComponent(entityId)}/close`;
  const preUrl = entity === "project" ? `${base}/preconditions` : base;
  const noun = entity === "project" ? "프로젝트" : "기회";

  const [pre, setPre] = useState<Record<string, TypePreconditions> | null>(null);
  const [type, setType] = useState<ClosureType | null>(null);
  const [reason, setReason] = useState("");
  const [learning, setLearning] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { panelRef, onKeyDown } = useModalFocus(onClose);

  useEffect(() => {
    let alive = true;
    api
      .get<Record<string, TypePreconditions>>(preUrl)
      .then((r) => alive && setPre(r.data))
      .catch(
        (err) => alive && setLoadError(err instanceof Error ? err.message : "종료 전제조건을 불러오지 못했습니다."),
      );
    return () => {
      alive = false;
    };
  }, [preUrl]);

  const types = pre ? (Object.keys(pre) as ClosureType[]) : [];
  const sel = type && pre ? pre[type] : null;
  const reasonShort = !!sel && reason.trim().length < sel.min_reason_length;
  const learningMissing = !!sel && sel.requires_learning_capture && !learning.trim();
  const blockers: string[] = [];
  if (!type) blockers.push("종료 유형을 선택하세요.");
  if (sel && !sel.satisfied) blockers.push(`전제조건 기록이 없습니다: ${sel.missing.map((m) => { const k = closureRecordKeyOf(m.record); return k ? tr(k.label) : m.record; }).join(", ")}`);
  if (sel && reasonShort)
    blockers.push(
      sel.min_reason_length > 1 ? `사유를 ${sel.min_reason_length}자 이상 입력하세요.` : "사유를 입력하세요.",
    );
  if (learningMissing) blockers.push("학습 포착을 입력하세요.");
  const canSubmit = !!type && blockers.length === 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !type) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(base, {
        closureType: type,
        closureReason: reason.trim(),
        learningCapture: learning.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${noun} 종료 처리 실패`);
    } finally {
      setBusy(false);
    }
  }

  const titleId = `${uid}-title`;
  const blockId = `${uid}-blockers`;
  const errId = `${uid}-error`;

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: modal-backdrop pattern shared with crud.tsx (Esc/Tab handled by useModalFocus)
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: click only stops propagation to the backdrop; keyboard handled on the backdrop */}
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: "34rem", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId} style={{ fontSize: "0.95rem" }}>
            {noun} 종료 — {entityName}
          </h2>
        </div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-2">
          종료는 사람의 결정입니다. 유형별 전제조건 기록이 있어야 하며, 종료 후에는 되돌릴 수 없습니다.
        </p>
        {loadError && (
          <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">
            {loadError}
          </p>
        )}
        {!pre && !loadError && <p aria-live="polite">전제조건을 확인하는 중...</p>}
        {pre && (
          <form onSubmit={submit} aria-label={`${noun} 종료`}>
            <fieldset className="mb-2" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="text-[length:var(--fs-caption)] font-semibold mb-1">종료 유형 (필수)</legend>
              <div role="radiogroup" className="flex flex-col gap-2">
                {types.map((t) => {
                  const p = pre[t];
                  const descId = `${uid}-${t}-desc`;
                  return (
                    <div key={t} className="text-[length:var(--fs-caption)]">
                      <label className="flex items-start gap-2" style={{ minHeight: "2.75rem" }}>
                        <input
                          type="radio"
                          name={`${uid}-type`}
                          value={t}
                          checked={type === t}
                          onChange={() => setType(t)}
                          aria-describedby={descId}
                          style={{ marginTop: "0.2rem" }}
                        />
                        <span>
                          <span className="font-semibold">{tr(CLOSURE_TYPE_KEY[t])}</span>{" "}
                          <span className={`status-chip ${p.satisfied ? "status-green" : "status-amber"}`}>
                            <span aria-hidden="true">{p.satisfied ? "✓" : "!"}</span>{" "}
                            {p.satisfied ? "전제조건 충족" : "전제조건 미충족"}
                          </span>
                        </span>
                      </label>
                      <div id={descId} className="ml-6 text-[color:var(--muted-fg)]">
                        <span>{tr(TYPE_HINT_KEY[t], { p1: tr(TRANSITION_DECISION_KEY[t === "graduated_to_core" ? "graduate_to_core" : t === "divested" ? "reduce_or_divest" : "kill_with_learning_captured"]) })}</span>
                        {!p.satisfied && (
                          <ul className="mt-1 mb-0 pl-4">
                            {p.missing.map((m) => {
                              const link = recordLink(entity, entityId, m.record);
                              return (
                                <li key={m.record}>
                                  <span className="font-semibold">누락: {(() => { const k = closureRecordKeyOf(m.record); return k ? tr(k.label) : m.record; })()}</span> — {(() => { const k = closureRecordKeyOf(m.record); return k ? tr(k.message) : localizeMessage(m.message); })()}{" "}
                                  {link && (
                                    <Link href={link.href} className="text-[color:var(--accent)] underline">
                                      {link.label}
                                    </Link>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <label className="block text-[length:var(--fs-caption)] mb-2">
              <span className="block mb-1">
                사유 (필수){sel && sel.min_reason_length > 1 ? ` — ${sel.min_reason_length}자 이상` : ""}
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                required
                aria-invalid={!!type && reasonShort && reason.length > 0}
                aria-describedby={blockId}
                className="sizing-new-input w-full"
              />
            </label>
            <label className="block text-[length:var(--fs-caption)] mb-2">
              <span className="block mb-1">학습 포착{sel?.requires_learning_capture ? " (필수)" : " (선택)"}</span>
              <textarea
                value={learning}
                onChange={(e) => setLearning(e.target.value)}
                rows={3}
                required={!!sel?.requires_learning_capture}
                aria-invalid={learningMissing && learning.length === 0 && !!type}
                aria-describedby={blockId}
                className="sizing-new-input w-full"
                placeholder="이 결정에서 얻은 교훈 — 이후 기본률(base rate) 검토로 환류됩니다"
              />
            </label>

            <p id={blockId} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" aria-live="polite">
              {blockers.length > 0 ? `제출할 수 없음: ${blockers.join(" / ")}` : "모든 조건이 충족되었습니다."}
            </p>
            {error && (
              <p id={errId} role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">
                오류: {error}
              </p>
            )}
            <div className="flex gap-2 justify-end flex-wrap">
              <button type="button" className="btn-ghost btn-sm" onClick={onClose} style={{ minHeight: "2.75rem" }}>
                취소
              </button>
              <button
                type="submit"
                className="btn-premium btn-sm"
                disabled={!canSubmit}
                style={{ minHeight: "2.75rem" }}
              >
                {entity === "project" ? "프로젝트 종료" : "기회 종료"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
