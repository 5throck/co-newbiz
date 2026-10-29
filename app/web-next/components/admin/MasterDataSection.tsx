"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConfirm } from "../crud.tsx";
import { BusinessTargetsSection } from "./BusinessTargetsSection.tsx";
import { api } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { IdCell, ListSearch, Pager, matchesQuery, usePaged } from "./console/admin-ui.tsx";

const MD_PAGE_SIZE = 15;

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
  created_at: "colCreatedAt",
};

export function MasterDataSection() {
  const t = useTranslations("admin.masterData");
  const tc = useTranslations("common");
  const tl = useTranslations("admin.list");
  const locale = useLocale();

  const { confirm, confirmDialog } = useConfirm();
  const [tables, setTables] = useState<string[] | null>(null);
  const [table, setTable] = useState<string>("md_industry");
  const [data, setData] = useState<MdTableData | null>(null);
  const [staging, setStaging] = useState<StagingRow[] | null>(null);
  const [newId, setNewId] = useState("");
  const [newFields, setNewFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  // Names lead; the long id and the timestamp trail the row.
  const shownCols = useMemo(() => {
    if (!data) return [];
    const body = data.columns.filter((c) => c !== "id" && c !== "created_at");
    const names = body.filter((c) => c.startsWith("name_"));
    return [...names, ...body.filter((c) => !c.startsWith("name_")), "id", "created_at"].filter((c) => data.columns.includes(c));
  }, [data]);
  const filteredRows = useMemo(
    () => (data?.rows ?? []).filter((row) => matchesQuery(query, ...Object.values(row).map((v) => (v === null || v === undefined ? "" : String(v))))),
    [data, query],
  );
  const paged = usePaged(filteredRows, MD_PAGE_SIZE);

  function resetForm() {
    setEditingId(null);
    setNewId("");
    setNewFields({});
  }

  function startEdit(row: Record<string, unknown>) {
    setNotice(null);
    setError(null);
    setEditingId(String(row.id ?? ""));
    setNewId(String(row.id ?? ""));
    const next: Record<string, string> = {};
    for (const c of EDITABLE[table] ?? []) if (c !== "id") next[c] = row[c] === null || row[c] === undefined ? "" : String(row[c]);
    setNewFields(next);
  }

  async function addCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      if (editingId) {
        await api.put("/api/admin/master-data", { table, id: editingId, fields: newFields });
        setNotice(t("codeUpdated", { p1: tableName, p2: editingId }));
      } else {
        await api.post("/api/admin/master-data", { table, id: newId.trim(), fields: newFields });
        setNotice(t("codeAdded", { p1: tableName, p2: newId }));
      }
      resetForm();
      loadTable();
    } catch (err) {
      setError(err instanceof Error ? err.message : editingId ? t("updateFailed") : t("addFailed"));
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
            onClick={() => { setTable(tbl); resetForm(); setQuery(""); }}
          >
            {TABLE_KEY[tbl] ? t(TABLE_KEY[tbl]) : tbl}
          </button>
        ))}
      </div>

      {data && (
        <>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ListSearch value={query} onChange={setQuery} ariaLabel={t("searchAria")} placeholder={t("searchPlaceholder")} />
        </div>
        {filteredRows.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{tl("noMatch")}</p>
        ) : (
        <>
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table list-table list-wide">
          <caption className="sr-only">{t("tableCaption", { p1: tableName })}</caption>
          <thead>
            <tr>
              {shownCols.map((c) => (
                <th key={c} scope="col">
                  {colName(c)}
                </th>
              ))}
              <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {paged.slice.map((row, i) => (
              <tr key={String(row.id ?? i)}>
                {shownCols.map((c) => (
                  <td key={c} className={c === "id" || c === "created_at" ? "cell-sub" : undefined}>
                    {row[c] === null || row[c] === undefined || row[c] === ""
                      ? "—"
                      : c === "id"
                        ? <IdCell id={String(row[c])} />
                        : c === "created_at"
                          ? formatDateTime(String(row[c]), locale)
                          : String(row[c])}
                  </td>
                ))}
                <td className="sizing-actions-cell">
                  <span className="actions-row">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    aria-label={t("editRowAria", { p1: String(row.id ?? "") })}
                    onClick={() => startEdit(row)}
                  >
                    {t("editRowButton")}
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    aria-label={t("deleteAria", { p1: String(row.id ?? "") })}
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
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <Pager page={paged.page} pages={paged.pages} total={paged.total} onPage={paged.setPage} />
        </>
        )}
        </>
      )}

      <form onSubmit={addCode} aria-label={editingId ? t("editFormHeading") : t("addFormAria")} className="my-4 flex flex-wrap items-center gap-2">
        {editingId && <span role="status" className="w-full text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("editingNotice", { p1: editingId })}</span>}
        <input
          type="text"
          aria-label={t("newIdAria")}
          placeholder={t("newIdPlaceholder")}
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          disabled={!!editingId}
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
        <button type="submit" className="btn-primary">
          {editingId ? t("saveEditButton") : t("addCodeButton")}
        </button>
        {editingId && (
          <button type="button" className="btn-ghost" onClick={resetForm}>{t("cancelEdit")}</button>
        )}
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
