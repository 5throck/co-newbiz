import { useEffect, useState } from "react";
import { api, type DdFindingRow } from "../api.ts";
import { SourceTooltip } from "./SourceTooltip.tsx";
import { GlossaryText } from "../glossary.tsx";

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

export function DdTab({ projectId }: { projectId: string }) {
  const [category, setCategory] = useState<string | null>(null);
  const [findings, setFindings] = useState<DdFindingRow[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

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
        <p className="empty-state">데이터 없음 — 조건에 맞는 실사 항목이 없습니다.</p>
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
    </div>
  );
}
