"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { InlineCreateForm, useConfirm } from "../crud.tsx";
import { SectionToolbar } from "../layout.tsx";
import {
  CUSTOM_METRIC_KEY,
  METRIC_PRESETS,
  formatDirectionSymbol,
  formatTargetValue,
  presetFor,
  unitSpec,
} from "../../lib/business-targets-format.ts";
import type { TargetDirection, TargetUnit } from "../../lib/business-targets-format.ts";

// 관리자 콘솔 — 사업목표 기준 섹션 (md_business_target, ADR-0114).
// 그룹 공통/계열사별 기준을 등록·수정(값·방향)·삭제(툼스톤)한다.
// 입력 단위는 지표 프리셋에 따라 억원/%, 년이며 API에는 저장 단위
// (KRW 백만, 비율, 년)로 환산해 보낸다.

interface GroupRow {
  id: string;
  name: string;
  member_count: number;
}

interface MemberRow {
  id: string;
  company_name: string;
  role: "hq" | "affiliate";
}

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
  group_name: string;
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

export function BusinessTargetsSection() {
  const { confirm, confirmDialog } = useConfirm();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [targets, setTargets] = useState<TargetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 생성 폼 상태
  const [createOpen, setCreateOpen] = useState(false);
  const [formGroupId, setFormGroupId] = useState("");
  const [formMemberId, setFormMemberId] = useState(""); // "" = 그룹 공통
  const [formMetric, setFormMetric] = useState(METRIC_PRESETS[0].key);
  const [formCustomLabel, setFormCustomLabel] = useState("");
  const [formDirection, setFormDirection] = useState<TargetDirection>(METRIC_PRESETS[0].direction);
  const [formValue, setFormValue] = useState("");
  const [saving, setSaving] = useState(false);

  // 행 편집 상태 (값·방향만 수정 가능 — 범위·지표는 삭제 후 재등록)
  const [editing, setEditing] = useState<{ id: string; value: string; direction: TargetDirection } | null>(null);

  const loadTargets = useCallback(() => {
    api
      .get<{ targets: TargetRow[] }>("/api/admin/business-targets")
      .then((r) => setTargets(r.data.targets))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, []);

  useEffect(() => {
    api
      .get<{ groups: GroupRow[] }>("/api/admin/business-targets/groups")
      .then((r) => {
        setGroups(r.data.groups);
        if (r.data.groups[0]) setFormGroupId(r.data.groups[0].id);
      })
      .catch(() => setGroups([]));
    loadTargets();
  }, [loadTargets]);

  const loadMembers = useCallback((groupId: string) => {
    if (!groupId) {
      setMembers([]);
      return;
    }
    api
      .get<{ members: MemberRow[] }>(`/api/admin/business-targets/groups/${encodeURIComponent(groupId)}`)
      .then((r) => setMembers(r.data.members))
      .catch(() => setMembers([]));
  }, []);

  useEffect(() => {
    loadMembers(formGroupId);
    setFormMemberId("");
  }, [formGroupId, loadMembers]);

  const formUnit = displayUnit(formMetric);
  const isCustom = formMetric === CUSTOM_METRIC_KEY;

  async function addTarget(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const parsed = Number(formValue);
    if (!Number.isFinite(parsed)) {
      setError("기준값을 숫자로 입력하세요.");
      return;
    }
    const spec = unitSpec(formUnit);
    setSaving(true);
    try {
      await api.post("/api/admin/business-targets", {
        group_id: formGroupId,
        member_id: formMemberId || null,
        metric_key: formMetric,
        label: isCustom ? formCustomLabel : null,
        direction: formDirection,
        target_value: parsed * spec.factor,
      });
      setNotice("사업목표 기준이 등록되었습니다.");
      setFormValue("");
      setFormCustomLabel("");
      setCreateOpen(false);
      loadTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setError(null);
    const parsed = Number(editing.value);
    if (!Number.isFinite(parsed)) {
      setError("기준값을 숫자로 입력하세요.");
      return;
    }
    const row = targets?.find((t) => t.id === editing.id);
    if (!row) return;
    const factor = unitSpec(displayUnit(row.metric_key)).factor;
    setSaving(true);
    try {
      await api.put("/api/admin/business-targets", {
        id: editing.id,
        direction: editing.direction,
        target_value: parsed * factor,
      });
      setNotice("기준이 수정되었습니다.");
      setEditing(null);
      loadTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정 실패");
    } finally {
      setSaving(false);
    }
  }

  function removeTarget(row: TargetRow) {
    confirm(
      `‘${metricDisplayName(row)}’ 기준을 삭제할까요?`,
      async () => {
        setError(null);
        try {
          await api.delete("/api/admin/business-targets", { id: row.id });
          loadTargets();
        } catch (err) {
          setError(err instanceof Error ? err.message : "삭제 실패");
        }
      },
      { body: "삭제는 기록이 남는 툼스톤 방식이며, fs 진행 근거 표에서 즉시 사라집니다." },
    );
  }

  return (
    <>
      {confirmDialog}
      <section className="market-section" aria-label="사업목표 기준">
        <SectionToolbar
          title="사업목표 기준"
          count={targets?.length ?? 0}
          summary={<span className="section-meta">그룹 공통 · 계열사별 사업목표 — fs 진행 판정기준으로 사용</span>}
          actions={
            <button type="button" className="btn-ghost btn-sm" onClick={() => setCreateOpen((v) => !v)}>
              {createOpen ? "닫기" : "＋ 등록"}
            </button>
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

        {groups !== null && groups.length === 0 ? (
          <p className="text-[color:var(--muted-fg)]">
            등록된 그룹이 없습니다. 먼저 <a href="/our-company" className="underline">우리 회사 분석</a>에서 그룹·계열사를 등록하세요.
          </p>
        ) : (
          <>
            <InlineCreateForm
              open={createOpen}
              onSubmit={addTarget}
              onCancel={() => setCreateOpen(false)}
              disabled={saving || !formGroupId || !formValue}
              ariaLabel="사업목표 기준 추가"
            >
              <select aria-label="그룹" className="sizing-new-input sizing-new-input-sm" style={{ flex: "0 1 11rem" }} value={formGroupId} onChange={(e) => setFormGroupId(e.target.value)}>
                {(groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <select aria-label="적용 범위" className="sizing-new-input sizing-new-input-sm" style={{ flex: "0 1 12rem" }} value={formMemberId} onChange={(e) => setFormMemberId(e.target.value)}>
                <option value="">그룹 공통</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.company_name}
                  </option>
                ))}
              </select>
              <select
                aria-label="지표"
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
                <option value={CUSTOM_METRIC_KEY}>사용자 지정 KPI…</option>
              </select>
              {isCustom && (
                <input
                  aria-label="사용자 지정 지표명"
                  placeholder="지표명 (예: 해외 매출 비중)"
                  className="sizing-new-input sizing-new-input-sm"
                  style={{ flex: "1 1 10rem" }}
                  value={formCustomLabel}
                  onChange={(e) => setFormCustomLabel(e.target.value)}
                />
              )}
              <select aria-label="방향" className="sizing-new-input sizing-new-input-sm" style={{ flex: "0 1 5.5rem" }} value={formDirection} onChange={(e) => setFormDirection(e.target.value as TargetDirection)}>
                <option value="gte">이상 (≥)</option>
                <option value="lte">이하 (≤)</option>
              </select>
              <input
                aria-label="기준값"
                type="number"
                step="any"
                min="0"
                placeholder="기준값"
                className="sizing-new-input sizing-new-input-sm"
                style={{ flex: "0 1 6.5rem" }}
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
              />
              <span className="section-meta" style={{ minWidth: "2.2rem" }}>
                {unitSpec(formUnit).inputLabel || "값"}
              </span>
            </InlineCreateForm>

            {targets === null ? (
              <p>불러오는 중...</p>
            ) : targets.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic">등록된 사업목표 기준이 없습니다.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table list-table" aria-label="사업목표 기준 목록">
                  <thead>
                    <tr>
                      <th scope="col">그룹</th>
                      <th scope="col" className="w-[8rem]">적용 범위</th>
                      <th scope="col" className="w-[8rem]">지표</th>
                      <th scope="col" className="col-num w-[7rem]">기준</th>
                      <th scope="col" className="col-date">등록일</th>
                      <th scope="col" className="w-[10rem]"><span className="sr-only">작업</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((row) => {
                      const unit = displayUnit(row.metric_key);
                      const isEditing = editing?.id === row.id;
                      return (
                        <tr key={row.id}>
                          <td>{row.group_name}</td>
                          <td>
                            {row.member_id ? (
                              <span className="status-chip status-green">{row.member_name}</span>
                            ) : (
                              <span className="status-chip status-not-started">그룹 공통</span>
                            )}
                          </td>
                          <td>
                            {metricDisplayName(row)}
                            {!presetFor(row.metric_key) && <span className="section-meta"> · 사용자 지정</span>}
                          </td>
                          <td className="col-num">
                            {isEditing ? (
                              <span className="row-edit-cell">
                                <select
                                  aria-label="방향 수정"
                                  className="sizing-new-input sizing-new-input-sm"
                                  style={{ width: "4.5rem", minWidth: "4.5rem" }}
                                  value={editing.direction}
                                  onChange={(e) => setEditing({ ...editing, direction: e.target.value as TargetDirection })}
                                >
                                  <option value="gte">≥</option>
                                  <option value="lte">≤</option>
                                </select>
                                <input
                                  aria-label="기준값 수정"
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
                                  저장
                                </button>
                                <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
                                  취소
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
                            <div className="actions-row">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => setEditing({ id: row.id, value: toInputText(row.target_value, unit), direction: row.direction })}
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                className="btn-danger btn-sm"
                                title="이 기준을 삭제합니다"
                                onClick={() => removeTarget(row)}
                              >
                                삭제
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="section-meta">
              같은 범위·같은 지표는 1건만 등록됩니다. 계열사 기준은 그룹 공통 기준보다 우선 적용되며, 사용자 지정 KPI는 fs 화면에서 “수동 확인”으로 표시됩니다.
            </p>
          </>
        )}
      </section>
    </>
  );
}
