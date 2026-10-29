"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../../../lib/api.ts";
import { InlineCreateForm, useConfirm } from "../../crud.tsx";
import { SectionToolbar } from "../../layout.tsx";
import { ColGroup } from "../../ui.tsx";
import type { OurCompanyStageState } from "./useOurGroups.ts";

// 사업목표 기준 목록 5열 — 적용 범위·지표·기준·등록일·작업 고정 비율.
const TARGETS_COL_PCT = [22, 30, 20, 14, 14] as const;
import {
  CUSTOM_METRIC_KEY,
  METRIC_PRESETS,
  formatDirectionSymbol,
  formatTargetValue,
  presetFor,
  unitSpec,
} from "../../../lib/business-targets-format.ts";
import type { TargetDirection, TargetUnit } from "../../../lib/business-targets-format.ts";

// 우리 회사(그룹) 화면 — 선택한 그룹의 사업목표 기준 패널 (md_business_target,
// ADR-0114 / 소유권 이관 ADR-0191). 그룹 공통/계열사별 기준을 등록·수정(값·방향)·
// 삭제(툼스톤)한다. 프로젝트 목표(S8, ADR-0159)는 이 기준보다 우선한다.
// 입력 단위는 지표 프리셋에 따라 억원/%, 년이며 API에는 저장 단위
// (KRW 백만, 비율, 년)로 환산해 보낸다.

interface TargetRow {
  id: string;
  group_id: string;
  member_id: string | null;
  metric_key: string;
  label: string | null;
  direction: TargetDirection;
  target_value: number;
  created_at: string;
  updated_at: string | null;
  member_name: string | null;
}

function displayUnit(metricKey: string): TargetUnit {
  return presetFor(metricKey)?.unit ?? "none";
}

function metricDisplayName(row: { metric_key: string; label: string | null }): string {
  return presetFor(row.metric_key)?.label ?? row.label ?? row.metric_key;
}

/** stored → input-unit text (양방향 편집에 모두 사용) */
function toInputText(stored: number, unit: TargetUnit): string {
  const factor = unitSpec(unit).factor;
  const input = stored / factor;
  return String(Number(input.toFixed(2)));
}

export function BusinessTargetsPanel({ ctx }: { ctx: OurCompanyStageState }) {
  const t = useTranslations("components.ourCompany.businessTargets");
  const tc = useTranslations("common");
  const { selectedGroup, canAct } = ctx;
  const groupId = selectedGroup?.group.id ?? "";
  const members = selectedGroup?.members ?? [];
  const base = `/api/our-company/groups/${encodeURIComponent(groupId)}/business-targets`;
  const { confirm, confirmDialog } = useConfirm();
  const [targets, setTargets] = useState<TargetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 생성 폼 상태
  const [createOpen, setCreateOpen] = useState(false);
  const [formMemberId, setFormMemberId] = useState(""); // "" = 그룹 공통
  const [formMetric, setFormMetric] = useState(METRIC_PRESETS[0].key);
  const [formCustomLabel, setFormCustomLabel] = useState("");
  const [formDirection, setFormDirection] = useState<TargetDirection>(METRIC_PRESETS[0].direction);
  const [formValue, setFormValue] = useState("");
  const [saving, setSaving] = useState(false);

  // 행 편집 상태 (값·방향만 수정 가능 — 범위·지표는 삭제 후 재등록)
  const [editing, setEditing] = useState<{ id: string; value: string; direction: TargetDirection } | null>(null);

  const loadTargets = useCallback(() => {
    if (!groupId) return;
    api
      .get<{ targets: TargetRow[] }>(`/api/our-company/groups/${encodeURIComponent(groupId)}/business-targets`)
      .then((r) => setTargets(r.data.targets))
      .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
  }, [groupId]);

  useEffect(() => {
    setTargets(null);
    setError(null);
    setNotice(null);
    setCreateOpen(false);
    setEditing(null);
    setFormMemberId("");
    loadTargets();
  }, [loadTargets]);

  const formUnit = displayUnit(formMetric);
  const isCustom = formMetric === CUSTOM_METRIC_KEY;

  async function addTarget(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const parsed = Number(formValue);
    if (!Number.isFinite(parsed)) {
      setError(t("errValueNumeric"));
      return;
    }
    const spec = unitSpec(formUnit);
    setSaving(true);
    try {
      await api.post(base, {
        member_id: formMemberId || null,
        metric_key: formMetric,
        label: isCustom ? formCustomLabel : null,
        direction: formDirection,
        target_value: parsed * spec.factor,
      });
      setNotice(t("createdNotice"));
      setFormValue("");
      setFormCustomLabel("");
      setCreateOpen(false);
      loadTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("errors.createFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setError(null);
    const parsed = Number(editing.value);
    if (!Number.isFinite(parsed)) {
      setError(t("errValueNumeric"));
      return;
    }
    const row = targets?.find((t) => t.id === editing.id);
    if (!row) return;
    const factor = unitSpec(displayUnit(row.metric_key)).factor;
    setSaving(true);
    try {
      await api.put(base, {
        id: editing.id,
        direction: editing.direction,
        target_value: parsed * factor,
      });
      setNotice(t("updatedNotice"));
      setEditing(null);
      loadTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("updateFailed"));
    } finally {
      setSaving(false);
    }
  }

  function removeTarget(row: TargetRow) {
    confirm(
      t("deleteConfirmTitle", { p1: metricDisplayName(row) }),
      async () => {
        setError(null);
        try {
          await api.delete(base, { id: row.id });
          loadTargets();
        } catch (err) {
          setError(err instanceof Error ? err.message : tc("errors.deleteFailed"));
        }
      },
      { body: t("deleteBody") },
    );
  }

  if (!selectedGroup) return null;
  return (
    <>
      {confirmDialog}
      <section className="market-section" aria-label={t("sectionTitle")}>
        <SectionToolbar
          title={t("sectionTitle")}
          count={targets?.length ?? 0}
          summary={<span className="section-meta">{t("sectionSummary")}</span>}
          actions={
            canAct ? (
              <button type="button" className="btn-ghost btn-sm" aria-expanded={createOpen} onClick={() => setCreateOpen((v) => !v)}>
                {createOpen ? tc("close") : t("addButton")}
              </button>
            ) : undefined
          }
        />
        {error && (
          <p role="alert" className="text-[color:var(--red-fg)]">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-[color:var(--green-fg)]">
            {notice}
          </p>
        )}

        {(
          <>
            <InlineCreateForm
              open={canAct && createOpen}
              onSubmit={addTarget}
              onCancel={() => setCreateOpen(false)}
              disabled={saving || !formValue}
              ariaLabel={t("formAria")}
            >
              <select aria-label={t("scopeAria")} className="sizing-new-input sizing-new-input-sm" style={{ flex: "0 1 12rem" }} value={formMemberId} onChange={(e) => setFormMemberId(e.target.value)}>
                <option value="">{t("groupCommon")}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.company_name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("metricAria")}
                className="sizing-new-input sizing-new-input-sm"
                style={{ flex: "0 1 15rem" }}
                value={formMetric}
                onChange={(e) => {
                  const key = e.target.value;
                  setFormMetric(key);
                  const preset = presetFor(key);
                  if (preset) setFormDirection(preset.direction);
                }}
              >
                {METRIC_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
                <option value={CUSTOM_METRIC_KEY}>{t("customMetricOption")}</option>
              </select>
              {isCustom && (
                <input
                  aria-label={t("customMetricNameAria")}
                  placeholder={t("customMetricNamePlaceholder")}
                  className="sizing-new-input sizing-new-input-sm"
                  style={{ flex: "1 1 10rem" }}
                  value={formCustomLabel}
                  onChange={(e) => setFormCustomLabel(e.target.value)}
                />
              )}
              <select aria-label={t("directionAria")} className="sizing-new-input sizing-new-input-sm" style={{ flex: "0 1 5.5rem" }} value={formDirection} onChange={(e) => setFormDirection(e.target.value as TargetDirection)}>
                <option value="gte">{t("directionGte")}</option>
                <option value="lte">{t("directionLte")}</option>
              </select>
              <input
                aria-label={t("valueAria")}
                type="number"
                step="any"
                min="0"
                placeholder={t("valueAria")}
                className="sizing-new-input sizing-new-input-sm"
                style={{ flex: "0 1 6.5rem" }}
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
              />
              <span className="section-meta" style={{ minWidth: "2.2rem" }}>
                {unitSpec(formUnit).inputLabel || t("valueFallback")}
              </span>
            </InlineCreateForm>

            {targets === null ? (
              <p>{tc("loading")}</p>
            ) : targets.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic">{t("emptyTargets")}</p>
            ) : (
              <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                <table className="data-table list-table table-fixed-pct tmin-48" aria-label={t("tableAria")}>
                  <ColGroup widths={TARGETS_COL_PCT} />
                  <thead>
                    <tr>
                      <th scope="col">{t("colScope")}</th>
                      <th scope="col">{t("colMetric")}</th>
                      <th scope="col" className="col-num">{t("colTarget")}</th>
                      <th scope="col" className="col-date">{t("colCreatedDate")}</th>
                      <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((row) => {
                      const unit = displayUnit(row.metric_key);
                      const isEditing = editing?.id === row.id;
                      return (
                        <tr key={row.id}>
                          <td>
                            {row.member_id ? (
                              <span className="status-chip status-green">{row.member_name}</span>
                            ) : (
                              <span className="status-chip status-not-started">{t("groupCommon")}</span>
                            )}
                          </td>
                          <td>
                            {metricDisplayName(row)}
                            {!presetFor(row.metric_key) && <span className="section-meta">{t("customMetricSuffix")}</span>}
                          </td>
                          <td className="col-num">
                            {isEditing ? (
                              <span className="row-edit-cell">
                                <select
                                  aria-label={t("directionEditAria")}
                                  className="sizing-new-input sizing-new-input-sm"
                                  style={{ width: "4.5rem", minWidth: "4.5rem" }}
                                  value={editing.direction}
                                  onChange={(e) => setEditing({ ...editing, direction: e.target.value as TargetDirection })}
                                >
                                  <option value="gte">≥</option>
                                  <option value="lte">≤</option>
                                </select>
                                <input
                                  aria-label={t("valueEditAria")}
                                  type="number"
                                  step="any"
                                  min="0"
                                  className="sizing-new-input sizing-new-input-sm"
                                  style={{ width: "4.5rem", minWidth: "4.5rem" }}
                                  value={editing.value}
                                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                />
                                {unitSpec(unit).inputLabel && <strong>{unitSpec(unit).inputLabel}</strong>}
                                <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={saveEdit}>
                                  {tc("save")}
                                </button>
                                <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
                                  {tc("cancel")}
                                </button>
                              </span>
                            ) : (
                              <strong>
                                {formatDirectionSymbol(row.direction)} {formatTargetValue(row.target_value, unit)}
                              </strong>
                            )}
                          </td>
                          <td className="cell-sub col-date">{(row.updated_at ?? row.created_at).slice(0, 10)}</td>
                          <td className="sizing-actions-cell">
                            {canAct && (
                            <div className="actions-row">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => setEditing({ id: row.id, value: toInputText(row.target_value, unit), direction: row.direction })}
                              >
                                {tc("edit")}
                              </button>
                              <button
                                type="button"
                                className="btn-danger btn-sm"
                                title={t("deleteTitle")}
                                onClick={() => removeTarget(row)}
                              >
                                {tc("delete")}
                              </button>
                            </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="section-meta">
              {t("footnote")}
            </p>
          </>
        )}
      </section>
    </>
  );
}
