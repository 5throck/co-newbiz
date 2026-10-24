"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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

// 화면 표시용 이름은 카탈로그 키로 해석 (데이터 식별자는 그대로 유지)
const TABLE_KEY: Record<string, string> = {
  md_industry: "tableIndustry",
  md_currency: "tableCurrency",
  md_country: "tableCountry",
  md_source: "tableSource",
  md_unit: "tableUnit",
  md_company: "tableCompany",
};
const COL_KEY: Record<string, string> = {
  id: "colId",
  ksic_code: "colKsic",
  naics_code: "colNaics",
  name_ko: "colNameKo",
  name_en: "colNameEn",
  iso_code: "colIso",
  code: "colCode",
  reliability_grade: "colReliability",
  dimension: "colDimension",
  si_coefficient: "colSiCoefficient",
  dart_corp_code: "colDartCorpCode",
  biz_reg_no: "colBizRegNo",
};

export function MasterDataSection() {
  const t = useTranslations("admin.masterData");
  const tc = useTranslations("common");

  const { confirm, confirmDialog } = useConfirm();
  const [tables, setTables] = useState<string[] | null>(null);
  const [table, setTable] = useState<string>("md_industry");
  const [data, setData] = useState<MdTableData | null>(null);
  const [staging, setStaging] = useState<StagingRow[] | null>(null);
  const [newId, setNewId] = useState("");
  const [newFields, setNewFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tableName = TABLE_KEY[table] ? t(TABLE_KEY[table]) : table;
  const colName = (c: string): string => (COL_KEY[c] ? t(COL_KEY[c]) : c);

  const loadStaging = useCallback(() => {
    api.get<StagingRow[]>("/api/admin/master-data/staging").then((r) => setStaging(r.data)).catch(() => setStaging([]));
  }, []);

  const loadTable = useCallback(() => {
    setData(null);
    api
      .get<MdTableData>(`/api/admin/master-data?table=${encodeURIComponent(table)}`)
      .then((r) => setData(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
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
      setNotice(t("codeAdded", { p1: tableName, p2: newId }));
      setNewId("");
      setNewFields({});
      loadTable();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("addFailed"));
    }
  }

  async function resolveStaging(id: string, action: "map" | "reject") {
    setError(null);
    try {
      await api.post("/api/admin/master-data/staging", { id, action });
      loadStaging();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("resolveFailed"));
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

      <h3 className="mb-2">{t("codeTablesHeading")}</h3>
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label={t("tablesTablistAria")}>
        {(tables ?? []).map((tbl) => (
          <button
            key={tbl}
            type="button"
            role="tab"
            aria-selected={table === tbl}
            aria-current={table === tbl ? "true" : undefined}
            className={table === tbl ? "chip-selected" : undefined}
            onClick={() => setTable(tbl)}
          >
            {TABLE_KEY[tbl] ? t(TABLE_KEY[tbl]) : tbl}
          </button>
        ))}
      </div>

      {data && (
        <table className="data-table">
          <caption className="sr-only">{t("tableCaption", { p1: data.table })}</caption>
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th key={c} scope="col">
                  {colName(c)}
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
                    title={t("deleteRowTitle")}
                    onClick={() => confirm(t("deleteRowConfirmTitle", { p1: tableName }), async () => {
                      setError(null);
                      try {
                        await api.delete("/api/admin/master-data", { table, id: String(row.id ?? "") });
                        loadTable();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : tc("errors.deleteFailed"));
                      }
                    }, { body: t("deleteRowBody") })}
                  >
                    {tc("delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={addCode} aria-label={t("addFormAria")} className="my-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label={t("newIdAria")}
          placeholder={t("newIdPlaceholder")}
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          required
        />
        {editableCols.map((c) => (
          <input
            key={c}
            type="text"
            aria-label={t("fieldValueAria", { p1: colName(c) })}
            placeholder={colName(c)}
            value={newFields[c] ?? ""}
            onChange={(e) => setNewFields((prev) => ({ ...prev, [c]: e.target.value }))}
          />
        ))}
        <button type="submit" className="btn-ghost">
          {t("addCodeButton")}
        </button>
      </form>

      <BusinessTargetsSection />

      <h3 className="mb-2">{t("stagingHeading")}</h3>
      {staging === null ? (
        <p>{tc("loading")}</p>
      ) : staging.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">{t("stagingEmpty")}</p>
      ) : (
        <ul className="staging-list">
          {staging.map((r) => (
            <li key={r.id} className="snapshot-row">
              <code>{r.raw_value}</code>
              <span className="cell-sub">
                → {r.attempted_master_table} · {r.first_seen_at.slice(0, 10)}
              </span>
              <button type="button" className="btn-ghost" onClick={() => resolveStaging(r.id, "map")}>
                {t("mapButton")}
              </button>
              <button type="button" className="btn-ghost" onClick={() => resolveStaging(r.id, "reject")}>
                {t("rejectButton")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
    </>
  );
}
