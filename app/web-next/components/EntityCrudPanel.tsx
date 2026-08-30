"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";

// 범용 엔티티 CRUD 패널 — 목록 조회 + 등록 폼 + 행 삭제. columns는 서버
// allow-list 스펙과 일치해야 한다. 읽기전용이던 섹션(부지·파트너·인센티브·
// 독과점 등)에 "조사를 진행"할 수 있는 쓰기 경로를 제공한다.

export interface CrudColumn {
  key: string;
  label: string;
  type?: "text" | "number";
  required?: boolean;
}

export function EntityCrudPanel({
  projectId,
  endpoint,
  idKey,
  title,
  columns,
  rowLabel,
}: {
  projectId: string;
  endpoint: string; // GET list endpoint (relative)
  idKey: string; // row id field name
  title: string;
  columns: CrudColumn[];
  rowLabel: string;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<Record<string, unknown>[]>(endpoint)
      .then((r) => setRows(r.data))
      .catch(() => setRows([]));
  }, [endpoint]);

  useEffect(load, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      for (const c of columns) {
        const v = form[c.key];
        if (v === undefined || v === "") continue;
        body[c.key] = c.type === "number" ? Number(v) : v;
      }
      await api.post(endpoint, body);
      setForm({});
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setBusy(false);
    }
  }

  async function remove(rowId: string) {
    if (!window.confirm(`이 ${rowLabel} 항목을 삭제할까요? (감사로그에 기록됩니다)`)) return;
    setError(null);
    try {
      const sep = endpoint.includes("?") ? "&" : "?";
      await api.delete(`${endpoint}${sep}row_id=${encodeURIComponent(rowId)}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 실패");
    }
  }

  return (
    <div className="entity-crud-panel">
      <details className="opportunity-create">
        <summary className="btn-ghost">+ {title} 등록</summary>
        <form onSubmit={create} aria-label={`${title} 등록`} className="opportunity-form">
          {columns.map((c) => (
            <input
              key={c.key}
              type={c.type === "number" ? "number" : "text"}
              step={c.type === "number" ? "any" : undefined}
              aria-label={c.label}
              placeholder={c.label + (c.required ? " *" : "")}
              value={form[c.key] ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, [c.key]: e.target.value }))}
              required={c.required}
            />
          ))}
          <button type="submit" className="btn-premium" disabled={busy}>
            등록
          </button>
        </form>
      </details>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {rows === null ? (
        <p>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">등록된 항목이 없습니다.</p>
      ) : (
        <table className="data-table" aria-label={`${title} 목록`}>
          <caption className="sr-only">{title} 목록</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
              <th scope="col">삭제</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r[idKey] ?? i)}>
                {columns.map((c) => (
                  <td key={c.key} className="cell-sub">
                    {r[c.key] === null || r[c.key] === undefined ? "—" : String(r[c.key])}
                  </td>
                ))}
                <td>
                  <button type="button" className="btn-ghost" onClick={() => remove(String(r[idKey]))}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
