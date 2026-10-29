"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useConfirm } from "../crud.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { browseKsic, formatSiFactor, ksicLevel, MD_TABS, type MdTab } from "../../lib/master-data-view.ts";
import { IdCell, ListSearch, Pager, matchesQuery, useAdminLabel, usePaged } from "./console/admin-ui.tsx";

const MD_PAGE_SIZE = 15;

// 관리자 콘솔 — 마스터데이터 관리 섹션. 코드 테이블(허용목록) 조회·추가·수정·삭제와
// staging_unmapped 큐(매핑 완료/기각) 처리를 담당한다. KSIC 산업분류는 파일로 관리되는
// 읽기 전용 참조 목록이고, 데이터 출처는 /admin/data-sources 와 같은 표기를 읽기 전용으로 보여 준다.
// 내부 ID(ULID)는 서버가 생성하며 입력받지 않는다.

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

type EditableTable = "md_currency" | "md_country" | "md_unit" | "md_company";

const EDITABLE: Record<EditableTable, string[]> = {
  md_currency: ["iso_code"],
  md_country: ["iso_code"],
  md_unit: ["code", "dimension", "si_coefficient"],
  md_company: ["dart_corp_code", "biz_reg_no", "name_ko", "name_en"],
};

// Columns shown per table, in order; the internal id and the timestamp always trail.
const SHOWN: Record<EditableTable | "md_source", string[]> = {
  md_currency: ["_name", "iso_code"],
  md_country: ["_name", "iso_code"],
  md_source: ["_name", "reliability_grade"],
  md_unit: ["_name", "code", "dimension", "si_coefficient"],
  md_company: ["name_ko", "name_en", "dart_corp_code", "biz_reg_no"],
};

const TABLE_KEY: Record<MdTab, string> = {
  ksic: "tableKsic",
  md_currency: "tableCurrency",
  md_country: "tableCountry",
  md_source: "tableSource",
  md_unit: "tableUnit",
  md_company: "tableCompany",
};
const COL_KEY: Record<string, string> = {
  _name: "colDisplayName",
  id: "colInternalId",
  name_ko: "colNameKo",
  name_en: "colNameEn",
  iso_code: "colIso",
  code: "colCode",
  reliability_grade: "colReliability",
  dimension: "colDimension",
  si_coefficient: "colSiFactor",
  dart_corp_code: "colDartCorpCode",
  biz_reg_no: "colBizRegNo",
  created_at: "colCreatedAt",
};

export function MasterDataSection() {
  const t = useTranslations("admin.masterData");
  const tc = useTranslations("common");
  const locale = useLocale();
  const adminLabel = useAdminLabel();

  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState<MdTab>("ksic");
  const [data, setData] = useState<MdTableData | null>(null);
  const [staging, setStaging] = useState<StagingRow[] | null>(null);
  const [newFields, setNewFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const isApiTable = tab !== "ksic";
  const editable = tab in EDITABLE ? (tab as EditableTable) : null;
  const tableName = t(TABLE_KEY[tab]);
  const colName = (c: string): string => (COL_KEY[c] ? t(COL_KEY[c]) : c);

  const loadStaging = useCallback(() => {
    api.get<StagingRow[]>("/api/admin/master-data/staging").then((r) => setStaging(r.data)).catch(() => setStaging([]));
  }, []);

  const loadTable = useCallback(() => {
    if (tab === "ksic") return;
    setData(null);
    api
      .get<MdTableData>(`/api/admin/master-data?table=${encodeURIComponent(tab)}`)
      .then((r) => setData(r.data))
      .catch((err) => { setData({ table: tab, columns: [], rows: [] }); setError(err instanceof Error ? err.message : tc("errors.loadFailed")); });
  }, [tab, tc]);

  useEffect(loadStaging, [loadStaging]);
  useEffect(loadTable, [loadTable]);

  /** Display name of a row: catalog label for ISO currencies/countries/units, registry label for sources. */
  const nameOf = useCallback((row: Record<string, unknown>): string => {
    const key = tab === "md_unit" ? String(row.code ?? "") : String(row.iso_code ?? "");
    const group = tab === "md_currency" ? "currencyNames" : tab === "md_country" ? "countryNames" : tab === "md_unit" ? "unitNames" : null;
    if (tab === "md_source") return adminLabel("source", String(row.code ?? ""));
    if (group && key && t.has(`${group}.${key}` as never)) return t(`${group}.${key}` as never);
    return t("nameUnregistered");
  }, [tab, t, adminLabel]);

  const filteredRows = useMemo(
    () => (data?.rows ?? []).filter((row) => matchesQuery(query, nameOf(row), ...Object.values(row).map((v) => (v === null || v === undefined ? "" : String(v))))),
    [data, query, nameOf],
  );
  const paged = usePaged(filteredRows, MD_PAGE_SIZE);

  const ksicRows = useMemo(() => (tab === "ksic" ? browseKsic(query) : []), [tab, query]);
  const ksicPaged = usePaged(ksicRows, MD_PAGE_SIZE);

  function resetForm() {
    setEditingId(null);
    setNewFields({});
  }

  function startEdit(row: Record<string, unknown>) {
    setNotice(null);
    setError(null);
    setEditingId(String(row.id ?? ""));
    const next: Record<string, string> = {};
    for (const c of editable ? EDITABLE[editable] : []) next[c] = row[c] === null || row[c] === undefined ? "" : String(row[c]);
    setNewFields(next);
  }

  async function saveCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      if (editingId) {
        await api.put("/api/admin/master-data", { table: tab, id: editingId, fields: newFields });
        setNotice(t("codeUpdated", { p1: tableName, p2: newFields.iso_code || newFields.code || newFields.name_ko || "" }));
      } else {
        await api.post("/api/admin/master-data", { table: tab, fields: newFields });
        setNotice(t("codeAdded", { p1: tableName, p2: newFields.iso_code || newFields.code || newFields.name_ko || "" }));
      }
      resetForm();
      loadTable();
    } catch (err) {
      setError(err instanceof Error ? err.message : editingId ? t("updateFailed") : t("addFailed"));
    }
  }

  async function deleteRow(row: Record<string, unknown>) {
    setError(null);
    setNotice(null);
    try {
      await api.delete("/api/admin/master-data", { table: tab, id: String(row.id ?? "") });
      loadTable();
    } catch (err) {
      if (err instanceof ApiError && err.code === "referenced_row") {
        const refs = (err.details?.references as Array<{ table: string; count: number }> | undefined) ?? [];
        const usage = refs.map((r) => `${r.table} (${r.count})`).join(", ");
        setError(t("referencedRow", { p1: usage }));
      } else {
        setError(err instanceof Error ? err.message : tc("errors.deleteFailed"));
      }
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

  function renderCell(row: Record<string, unknown>, c: string) {
    if (c === "_name") return nameOf(row);
    const v = row[c];
    if (v === null || v === undefined || v === "") return "—";
    if (c === "id") return <IdCell id={String(v)} />;
    if (c === "created_at") return formatDateTime(String(v), locale);
    if (c === "dimension" && t.has(`dimensionNames.${String(v)}` as never)) return t(`dimensionNames.${String(v)}` as never);
    if (c === "reliability_grade") return String(v);
    if (c === "si_coefficient") return <span title={String(v)}>{`× ${formatSiFactor(Number(v), locale, { man: t("siMan"), eok: t("siEok"), jo: t("siJo") })}`}</span>;
    return String(v);
  }

  const shownCols = tab !== "ksic" ? [...SHOWN[tab], "id", "created_at"] : [];
  const readOnlySource = tab === "md_source";

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
        {MD_TABS.map((tbl) => (
          <button
            key={tbl}
            type="button"
            role="tab"
            aria-selected={tab === tbl}
            aria-current={tab === tbl ? "true" : undefined}
            className={tab === tbl ? "chip-selected" : undefined}
            onClick={() => { setTab(tbl); resetForm(); setQuery(""); setError(null); setNotice(null); }}
          >
            {t(TABLE_KEY[tbl])}
          </button>
        ))}
      </div>

      {tab === "ksic" && (
        <>
          <p className="text-[color:var(--muted-fg)]">{t("ksicNote")}</p>
          <p className="mb-2">
            <Link href="/market">{t("ksicMarketLink")}</Link>
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ListSearch value={query} onChange={setQuery} ariaLabel={t("ksicSearchAria")} placeholder={t("ksicSearchPlaceholder")} />
          </div>
          {ksicRows.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">{t("ksicNoMatch")}</p>
          ) : (
            <>
              <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                <table className="data-table list-table list-wide">
                  <caption className="sr-only">{t("tableCaption", { p1: tableName })}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("colKsic")}</th>
                      <th scope="col">{t("colIndustryName")}</th>
                      <th scope="col">{t("colLevel")}</th>
                      <th scope="col">{t("colProfile")}</th>
                      <th scope="col">{t("colMatch")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ksicPaged.slice.map((e) => (
                      <tr key={e.code}>
                        <td><code>{e.code}</code></td>
                        <td>
                          {e.name_ko}
                          {e.detail && <span className="cell-sub"> · {e.detail}</span>}
                        </td>
                        <td>{t(`ksicLevel.${ksicLevel(e.code)}` as never)}</td>
                        <td>{e.profile ? t("profileYes") : "—"}</td>
                        <td>{e.matched_by === "alias" ? t("matchAlias", { p1: e.alias ?? "" }) : e.matched_by === "name" ? t("matchName") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={ksicPaged.page} pages={ksicPaged.pages} total={ksicPaged.total} onPage={ksicPaged.setPage} />
            </>
          )}
        </>
      )}

      {readOnlySource && (
        <p className="text-[color:var(--muted-fg)]">
          {t("sourceNote")} <Link href="/admin/data-sources">{t("sourceOpenLink")}</Link>
        </p>
      )}

      {isApiTable && data && (
        <>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ListSearch value={query} onChange={setQuery} ariaLabel={t("searchAria")} placeholder={t("searchPlaceholder")} />
        </div>
        {data.rows.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("emptyTable", { p1: tableName })}</p>
        ) : filteredRows.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("noMatch")}</p>
        ) : (
        <>
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table list-table list-wide">
          <caption className="sr-only">{t("tableCaption", { p1: tableName })}</caption>
          <thead>
            <tr>
              {shownCols.map((c) => (
                <th key={c} scope="col" title={c === "si_coefficient" ? t("siFactorTitle") : undefined}>
                  {colName(c)}
                </th>
              ))}
              {!readOnlySource && <th scope="col"><span className="sr-only">{tc("actions")}</span></th>}
            </tr>
          </thead>
          <tbody>
            {paged.slice.map((row, i) => (
              <tr key={String(row.id ?? i)}>
                {shownCols.map((c) => (
                  <td key={c} className={c === "id" || c === "created_at" ? "cell-sub" : undefined}>
                    {renderCell(row, c)}
                  </td>
                ))}
                {!readOnlySource && (
                <td className="sizing-actions-cell">
                  <span className="actions-row">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    aria-label={t("editRowAria", { p1: nameOf(row) })}
                    onClick={() => startEdit(row)}
                  >
                    {t("editRowButton")}
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    aria-label={t("deleteAria", { p1: nameOf(row) })}
                    title={t("deleteRowTitle")}
                    onClick={() => confirm(t("deleteRowConfirmTitle", { p1: tableName }), () => deleteRow(row), { body: t("deleteRowBody") })}
                  >
                    {tc("delete")}
                  </button>
                  </span>
                </td>
                )}
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

      {editable && (
      <form onSubmit={saveCode} aria-label={editingId ? t("editFormHeading") : t("addFormAria")} className="my-4 flex flex-wrap items-center gap-2">
        {editingId && <span role="status" className="w-full text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("editingNotice")}</span>}
        {EDITABLE[editable].map((c) => (
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
      )}

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
