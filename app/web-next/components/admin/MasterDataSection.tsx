"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "../crud.tsx";
import { BusinessTargetsSection } from "./BusinessTargetsSection.tsx";
import { api } from "../../lib/api.ts";

// 관리자 콘솔 — 마스터데이터 관리 섹션. 코드 테이블(허용목록) 조회·추가와
// staging_unmapped 큐(매핑 완료/기각) 처리를 담당한다. 테이블·컬럼명은
// 서버에서 허용목록으로 강제된다.

interface StagingRow {
  id: string;
  raw_value: string;
  attempted_master_table: string;
  first_seen_at: string;
}

interface MdTableData {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

const EDITABLE: Record<string, string[]> = {
  md_industry: ["id", "ksic_code", "naics_code", "name_ko", "name_en"],
  md_currency: ["id", "iso_code"],
  md_country: ["id", "iso_code"],
  md_source: ["id", "code", "reliability_grade"],
  md_unit: ["id", "code", "dimension", "si_coefficient"],
  md_company: ["id", "dart_corp_code", "biz_reg_no", "name_ko", "name_en"],
};

export function MasterDataSection() {

  const { confirm, confirmDialog } = useConfirm();
  const [tables, setTables] = useState<string[] | null>(null);
  const [table, setTable] = useState<string>("md_industry");
  const [data, setData] = useState<MdTableData | null>(null);
  const [staging, setStaging] = useState<StagingRow[] | null>(null);
  const [newId, setNewId] = useState("");
  const [newFields, setNewFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStaging = useCallback(() => {
    api.get<StagingRow[]>("/api/admin/master-data/staging").then((r) => setStaging(r.data)).catch(() => setStaging([]));
  }, []);

  const loadTable = useCallback(() => {
    setData(null);
    api
      .get<MdTableData>(`/api/admin/master-data?table=${encodeURIComponent(table)}`)
      .then((r) => setData(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [table]);

  useEffect(() => {
    api.get<{ tables: string[] }>("/api/admin/master-data").then((r) => setTables(r.data.tables)).catch(() => setTables([]));
    loadStaging();
  }, [loadStaging]);

  useEffect(loadTable, [loadTable]);

  async function addCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api.post("/api/admin/master-data", { table, id: newId.trim(), fields: newFields });
      setNotice(`${table}: ${newId} 추가됨`);
      setNewId("");
      setNewFields({});
      loadTable();
    } catch (err) {
      setError(err instanceof Error ? err.message : "추가 실패");
    }
  }

  async function resolveStaging(id: string, action: "map" | "reject") {
    setError(null);
    try {
      await api.post("/api/admin/master-data/staging", { id, action });
      loadStaging();
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리 실패");
    }
  }

  const editableCols = (EDITABLE[table] ?? []).filter((c) => c !== "id");

  return (
    <>
      {confirmDialog}
    <div>
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

      <h3 className="mb-2">코드 테이블</h3>
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="마스터데이터 테이블">
        {(tables ?? []).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={table === t}
            aria-current={table === t ? "true" : undefined}
            className={table === t ? "chip-selected" : undefined}
            onClick={() => setTable(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {data && (
        <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
          <caption className="sr-only">{data.table} 코드 목록</caption>
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={String(row.id) ?? i}>
                {data.columns.map((c) => (
                  <td key={c} className="cell-sub">
                    {row[c] === null || row[c] === undefined ? "—" : String(row[c])}
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    title="이 행을 삭제합니다"
                    onClick={() => confirm(`이 ${table} 행을 삭제할까요?`, async () => {
                      setError(null);
                      try {
                        await api.delete("/api/admin/master-data", { table, id: String(row.id ?? "") });
                        loadTable();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "삭제 실패");
                      }
                    }, { body: "감사로그에 기록됩니다." })}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={addCode} aria-label="코드 추가" className="my-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label="새 코드 ID"
          placeholder="코드 ID"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          required
        />
        {editableCols.map((c) => (
          <input
            key={c}
            type="text"
            aria-label={`${c} 값`}
            placeholder={c}
            value={newFields[c] ?? ""}
            onChange={(e) => setNewFields((prev) => ({ ...prev, [c]: e.target.value }))}
          />
        ))}
        <button type="submit" className="btn-ghost">
          코드 추가
        </button>
      </form>

      <BusinessTargetsSection />

      <h3 className="mb-2">미매핑 큐 (staging_unmapped)</h3>
      {staging === null ? (
        <p>불러오는 중...</p>
      ) : staging.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">큐가 비어 있습니다.</p>
      ) : (
        <ul className="staging-list">
          {staging.map((r) => (
            <li key={r.id} className="snapshot-row">
              <code>{r.raw_value}</code>
              <span className="cell-sub">
                → {r.attempted_master_table} · {r.first_seen_at.slice(0, 10)}
              </span>
              <button type="button" className="btn-ghost" onClick={() => resolveStaging(r.id, "map")}>
                매핑 완료(코드 추가 후)
              </button>
              <button type="button" className="btn-ghost" onClick={() => resolveStaging(r.id, "reject")}>
                기각
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
    </>
  );
}