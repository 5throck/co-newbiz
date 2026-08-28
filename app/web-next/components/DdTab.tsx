"use client";

import { useEffect, useState } from "react";
import { api, type DdFindingRow } from "../lib/api.ts";
import { SourceTooltip } from "./SourceTooltip.tsx";
import { GlossaryText } from "../lib/glossary-provider.tsx";

// 실사 (DD) tab — ui-spec §2: GET /api/projects/:id/dd-findings with a
// category filter, description/value_impact/evidence_ref table; category
// 'rbd' rows additionally show the R&BD sub-panel (rbd_source, trl_grade,
// ip_ownership_status, commercialization_path) as a visually distinct
// sub-section, per the R&BD sub-panel pattern referenced in ui-spec §2.

const RBD_SOURCE_LABELS: Record<string, string> = {
  internal_only: "자체 개발",
  accelerator_partnered: "액셀러레이터 협력",
  external_technology_acquisition: "외부 기술 도입",
};

export function DdTab({
  projectId,
  onOpenAssumption,
}: {
  projectId: string;
  onOpenAssumption?: (assumptionKey: string) => void;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [findings, setFindings] = useState<DdFindingRow[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  const [form, setForm] = useState({
    category: "commercial",
    description: "",
    value_impact: "",
    assumption_key: "",
    evidence_ref: "",
    rbd_source: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  async function submitFinding(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.category.trim() || !form.description.trim()) {
      setFormError("카테고리와 설명은 필수입니다.");
      return;
    }
    if (form.category.trim() === "rbd" && !form.rbd_source.trim()) {
      setFormError("category='rbd'는 rbd_source가 필요합니다.");
      return;
    }
    setFormBusy(true);
    try {
      await api.post<{ id: string }>(`/api/projects/${projectId}/dd-findings`, {
        category: form.category.trim(),
        description: form.description.trim(),
        value_impact: form.value_impact === "" ? undefined : Number(form.value_impact),
        assumption_key: form.assumption_key || undefined,
        evidence_ref: form.evidence_ref || undefined,
        rbd_source: form.category.trim() === "rbd" ? form.rbd_source.trim() : undefined,
      });
      setForm({ category: "commercial", description: "", value_impact: "", assumption_key: "", evidence_ref: "", rbd_source: "" });
      const res = await api.get<DdFindingRow[]>(`/api/projects/${projectId}/dd-findings${category ? `?category=${encodeURIComponent(category)}` : ""}`);
      setFindings(res.data);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "실사 항목 등록에 실패했습니다.");
    } finally {
      setFormBusy(false);
    }
  }

  // Fetch the unfiltered set once to derive the category chip list, then
  // re-fetch filtered whenever the selected chip changes.
  useEffect(() => {
    api
      .get<DdFindingRow[]>(`/api/projects/${projectId}/dd-findings`)
      .then((res) => {
        const seen = new Set(res.data.map((f) => f.category));
        setCategories([...seen].sort());
      })
      .catch(() => setCategories([]));
  }, [projectId]);

  useEffect(() => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    api
      .get<DdFindingRow[]>(`/api/projects/${projectId}/dd-findings${qs}`)
      .then((res) => setFindings(res.data))
      .catch(() => setFindings([]));
  }, [projectId, category]);

  return (
    <div className="dd-tab">
      <div className="filter-chips" role="group" aria-label="카테고리 필터">
        <button type="button" className={category === null ? "chip-selected" : undefined} onClick={() => setCategory(null)}>
          전체
        </button>
        {categories.map((c) => (
          <button
            type="button"
            key={c}
            className={category === c ? "chip-selected" : undefined}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {findings === null ? (
        <p>불러오는 중...</p>
      ) : findings.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 조건에 맞는 실사 항목이 없습니다.</p>
      ) : (
        <ul className="dd-finding-list">
          {findings.map((f) => (
            <li key={f.id} className="dd-finding-card">
              <div className="dd-finding-head">
                <span className="dd-category-badge">{f.category}</span>
                <span className="dd-finding-date">{new Date(f.created_at).toLocaleDateString("ko-KR")}</span>
              </div>
              <p className="dd-finding-desc">
                <GlossaryText text={f.description} />
              </p>
              <dl className="dd-finding-facts">
                <div>
                  <dt>가치 영향</dt>
                  <dd>
                    {f.value_impact === null ? (
                      "—"
                    ) : (
                      <SourceTooltip provenance={{ assumption_key: f.assumption_key ?? undefined }}>
                        {f.value_impact}
                      </SourceTooltip>
                    )}
                    {f.assumption_key?.trim() && onOpenAssumption && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="border-0 bg-transparent p-0 text-[color:var(--accent)] underline cursor-pointer text-[0.85rem]"
                          onClick={() => onOpenAssumption(f.assumption_key!.trim())}
                        >
                          {f.assumption_key} →
                        </button>
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>근거 자료</dt>
                  <dd>{f.evidence_ref?.trim() || "데이터 없음"}</dd>
                </div>
              </dl>

              {f.category === "rbd" && (
                <div className="rbd-subpanel">
                  <h3>R&amp;BD 세부 정보</h3>
                  <dl>
                    <div>
                      <dt>기술 출처</dt>
                      <dd>{f.rbd_source ? (RBD_SOURCE_LABELS[f.rbd_source] ?? f.rbd_source) : "데이터 없음"}</dd>
                    </div>
                    <div>
                      <dt>TRL 등급</dt>
                      <dd>{f.trl_grade?.trim() || "데이터 없음"}</dd>
                    </div>
                    <div>
                      <dt>IP 소유 상태</dt>
                      <dd>{f.ip_ownership_status?.trim() || "데이터 없음"}</dd>
                    </div>
                    <div>
                      <dt>사업화 경로</dt>
                      <dd>{f.commercialization_path?.trim() || "데이터 없음"}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="dd-finding-form mt-6" onSubmit={submitFinding} aria-label="실사 항목 추가">
        <h3>실사 항목 추가</h3>
        <div className="form-grid">
          <label>
            카테고리 *
            <input
              type="text"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              required
            />
          </label>
          <label>
            가치 영향
            <input
              type="number"
              step="any"
              value={form.value_impact}
              onChange={(e) => setForm({ ...form, value_impact: e.target.value })}
            />
          </label>
          <label>
            연결 가정 키
            <input
              type="text"
              value={form.assumption_key}
              onChange={(e) => setForm({ ...form, assumption_key: e.target.value })}
            />
          </label>
          <label>
            근거 자료
            <input
              type="text"
              value={form.evidence_ref}
              onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })}
            />
          </label>
          {form.category.trim() === "rbd" && (
            <label>
              기술 출처 (rbd_source) *
              <select value={form.rbd_source} onChange={(e) => setForm({ ...form, rbd_source: e.target.value })}>
                <option value="">선택</option>
                <option value="internal_only">자체 개발</option>
                <option value="accelerator_partnered">액셀러레이터 협력</option>
                <option value="external_technology_acquisition">외부 기술 도입</option>
              </select>
            </label>
          )}
        </div>
        <label className="block mt-2">
          설명 *
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            required
          />
        </label>
        {formError && <p className="form-error mt-2">{formError}</p>}
        <button type="submit" className="btn-primary mt-2" disabled={formBusy}>
          {formBusy ? "등록 중..." : "실사 항목 등록"}
        </button>
      </form>
    </div>
  );
}
