import { useEffect, useState } from "react";
import { api, type DataChangeRow, type ObservationRow, type SeriesRow } from "../api.ts";
import { SourceTooltip } from "./SourceTooltip.tsx";

// 데이터 (Data) tab — ui-spec §2: series browser (search + selected series'
// latest-revision observations, unit/source per row) plus the recent
// data-change log (GET /api/data-changes), each row marked revised/new/
// deleted with icon+label+color (never color-only, ui-spec §1) and its
// old→new values. GET /api/series/:id/observations defaults to the
// latest-revision read path (FR-DATA-05); "all revisions" is out of scope
// for this PR (see the ui-spec §2 delta note added below).

const CHANGE_META: Record<string, { icon: string; label: string; className: string }> = {
  revised: { icon: "↻", label: "수정됨", className: "change-revised" },
  new: { icon: "＋", label: "신규", className: "change-new" },
  deleted: { icon: "－", label: "삭제됨", className: "change-deleted" },
};

function changeMeta(changeType: string) {
  return CHANGE_META[changeType] ?? { icon: "?", label: changeType, className: "change-unknown" };
}

export function DataTab() {
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [observations, setObservations] = useState<ObservationRow[] | null>(null);
  const [changes, setChanges] = useState<DataChangeRow[] | null>(null);

  useEffect(() => {
    api
      .get<SeriesRow[]>(`/api/series?q=${encodeURIComponent(query)}`)
      .then((res) => setSeries(res.data))
      .catch(() => setSeries([]));
  }, [query]);

  useEffect(() => {
    api
      .get<DataChangeRow[]>("/api/data-changes")
      .then((res) => setChanges(res.data))
      .catch(() => setChanges([]));
  }, []);

  useEffect(() => {
    if (!selected) {
      setObservations(null);
      return;
    }
    api
      .get<ObservationRow[]>(`/api/series/${encodeURIComponent(selected)}/observations`)
      .then((res) => setObservations(res.data))
      .catch(() => setObservations([]));
  }, [selected]);

  return (
    <div className="data-tab">
      <section aria-label="시계열 검색">
        <h2>시계열 검색</h2>
        <input
          type="search"
          placeholder="시계열 ID 검색 (예: crankshaft)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="시계열 검색"
        />
        {series === null ? (
          <p>불러오는 중...</p>
        ) : series.length === 0 ? (
          <p className="empty-state">데이터 없음 — 검색어와 일치하는 시계열이 없습니다.</p>
        ) : (
          <table className="data-table">
            <caption className="sr-only">시계열 목록</caption>
            <thead>
              <tr>
                <th scope="col">시계열 ID</th>
                <th scope="col">단위</th>
                <th scope="col">출처</th>
                <th scope="col">관측치 수</th>
                <th scope="col">기간</th>
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.series_id} className={selected === s.series_id ? "row-selected" : undefined}>
                  <td>
                    <button type="button" className="link-button" onClick={() => setSelected(s.series_id)}>
                      {s.series_id}
                    </button>
                  </td>
                  <td>{s.unit_id}</td>
                  <td>{s.source_id}</td>
                  <td>{s.observation_count}</td>
                  <td>
                    {s.min_period_id} ~ {s.max_period_id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selected && (
        <section aria-label="선택한 시계열 관측치">
          <h2>{selected} 관측치 (최신 수정본)</h2>
          {observations === null ? (
            <p>불러오는 중...</p>
          ) : observations.length === 0 ? (
            <p className="empty-state">데이터 없음 — 이 시계열에 관측치가 없습니다.</p>
          ) : (
            <table className="data-table">
              <caption className="sr-only">{selected} 관측치</caption>
              <thead>
                <tr>
                  <th scope="col">기간</th>
                  <th scope="col">값</th>
                  <th scope="col">단위</th>
                  <th scope="col">출처</th>
                  <th scope="col">수정 번호</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((o) => (
                  <tr key={`${o.period_id}-${o.revision_no}`}>
                    <td>{o.period_id}</td>
                    <td>
                      <SourceTooltip provenance={{ source: o.source_id, as_of: o.fetched_at }}>{o.value}</SourceTooltip>
                    </td>
                    <td>{o.unit_id}</td>
                    <td>{o.source_id}</td>
                    <td>{o.revision_no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section aria-label="최근 데이터 변경 로그">
        <h2>최근 데이터 변경 로그</h2>
        {changes === null ? (
          <p>불러오는 중...</p>
        ) : changes.length === 0 ? (
          <p className="empty-state">데이터 없음 — 최근 감지된 데이터 변경이 없습니다.</p>
        ) : (
          <ul className="change-log-list">
            {changes.map((row) => {
              const meta = changeMeta(row.change_type);
              return (
                <li key={row.id} className="change-log-row">
                  <span className={`change-chip ${meta.className}`}>
                    <span aria-hidden="true">{meta.icon}</span> {meta.label}
                  </span>
                  <span className="change-series">{row.series_id}</span>
                  <span className="change-values">
                    {row.old_value ?? "—"} → {row.new_value ?? "—"}
                  </span>
                  <SourceTooltip provenance={{ as_of: row.detected_at }}>
                    <span className="change-detected">{new Date(row.detected_at).toLocaleString("ko-KR")}</span>
                  </SourceTooltip>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
