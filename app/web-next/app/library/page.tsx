"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.ts";
import type { ProjectSummary } from "../../lib/api.ts";

// 규정·체크리스트 — 체크리스트는 원문 보기가 아니라 **진행 관리** 도구:
// 체크리스트 + 딜을 선택해 항목별로 판정(충족/미충족/해당없음/예외)하고
// 진척률·필수 미충족을 추적한다(project_checklist_item_state에 영속).
// 운영 매뉴얼·규정 문서는 문서 열람 탭에서 그대로 본다.

type Category = "checklist" | "manual" | "policy";

interface ChecklistDoc {
  id: string;
  category: Category;
  title: string;
  file: string;
  gate?: string;
  enforceability?: string;
  version?: string;
  owner_agent?: string;
  item_count?: number;
  lang: "en" | "ko";
}

interface DocSummary {
  id: string;
  category: Category;
  title: string;
  file: string;
  gate?: string;
  enforceability?: string;
  version?: string;
  owner_agent?: string;
  item_count?: number;
  lang: "en" | "ko";
}

interface ChecklistItem {
  id: string;
  text: string;
  mandatory: boolean;
  waiver_eligible: boolean;
  status: string;
  note: string | null;
  evidence_ref: string | null;
  waiver_id: string | null;
  assessed_by: string | null;
  assessed_at: string | null;
}

interface ChecklistProgressData {
  checklist_id: string;
  items: ChecklistItem[];
  progress: {
    total: number;
    assessed: number;
    pass: number;
    fail: number;
    na: number;
    waived: number;
    mandatory_total: number;
    mandatory_open: Array<{ id: string; text: string; status: string }>;
  };
}

interface DocContent {
  id: string;
  title: string;
  file: string;
  content: string;
  version?: string;
  enforceability?: string;
  owner_agent?: string;
}

const GATE_LABELS: Record<string, string> = {
  Screening: "스크리닝",
  "Pre-FS": "Pre-FS",
  FS: "FS",
  DD: "DD",
  "Entity IC": "Entity IC",
  "Group IC": "Group IC",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "미판정",
  pass: "충족",
  fail: "미충족",
  na: "해당없음",
  waived: "예외(waiver)",
};

// ── 진행 관리 탭 ────────────────────────────────────────────────────────────
function ProgressManager({ checklists }: { checklists: ChecklistDoc[] }) {
  const [deals, setDeals] = useState<ProjectSummary[] | null>(null);
  const [checklistId, setChecklistId] = useState<string | null>(checklists[0]?.id ?? null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [data, setData] = useState<ChecklistProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { status: string; note: string; evidence_ref: string; waiver_id: string }>>({});

  useEffect(() => {
    api.get<ProjectSummary[]>("/api/projects").then((r) => {
      setDeals(r.data);
      if (r.data.length > 0) setDealId((prev) => prev ?? r.data[0].id);
    }).catch(() => setDeals([]));
  }, []);

  const load = useCallback(() => {
    if (!checklistId || !dealId) {
      setData(null);
      return;
    }
    api
      .get<ChecklistProgressData>(`/api/projects/${dealId}/checklists/${checklistId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [checklistId, dealId]);

  useEffect(load, [load]);

  function draftFor(item: ChecklistItem) {
    return (
      draft[item.id] ?? {
        status: item.status === "pending" ? "pass" : item.status,
        note: item.note ?? "",
        evidence_ref: item.evidence_ref ?? "",
        waiver_id: item.waiver_id ?? "",
      }
    );
  }

  function setDraftItem(item: ChecklistItem, patch: Partial<{ status: string; note: string; evidence_ref: string; waiver_id: string }>) {
    setDraft((prev) => ({ ...prev, [item.id]: { ...draftFor(item), ...patch } }));
  }

  async function assess(item: ChecklistItem) {
    const d = draftFor(item);
    setBusyItem(item.id);
    setError(null);
    try {
      await api.post(`/api/projects/${dealId}/checklists/${checklistId}`, {
        item_id: item.id,
        status: d.status,
        note: d.note || undefined,
        evidence_ref: d.evidence_ref || undefined,
        waiver_id: d.status === "waived" ? d.waiver_id || undefined : undefined,
      });
      setDraft((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "판정 기록 실패");
    } finally {
      setBusyItem(null);
    }
  }

  const selected = checklists.find((c) => c.id === checklistId);
  const pct = data && data.progress.total > 0 ? Math.round((data.progress.assessed / data.progress.total) * 100) : 0;

  return (
    <div className="cl-progress">
      <div className="cl-pickers">
        <label>
          체크리스트
          <select aria-label="체크리스트 선택" value={checklistId ?? ""} onChange={(e) => { setChecklistId(e.target.value); setDraft({}); }}>
            {checklists.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.gate ? ` (${GATE_LABELS[c.gate] ?? c.gate})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          딜
          <select aria-label="딜 선택" value={dealId ?? ""} onChange={(e) => { setDealId(e.target.value); setDraft({}); }}>
            {(deals ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.project_no}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!dealId || !checklistId ? (
        <p className="text-[color:var(--muted-fg)] italic">
          진행 관리할 체크리스트와 딜을 선택하세요. {deals !== null && deals.length === 0 && "배정된 딜이 없습니다."}
        </p>
      ) : data === null ? (
        <p>불러오는 중...</p>
      ) : (
        <>
          <div className="dd-progress">
            <div className="dd-progress-head">
              <span>
                {selected?.title} — 진척률 {pct}% ({data.progress.assessed}/{data.progress.total}항목)
              </span>
              <span className="dd-progress-badges">
                <span className="status-chip status-green">충족 {data.progress.pass}</span>
                <span className="status-chip status-red">미충족 {data.progress.fail}</span>
                <span className="status-chip">해당없음 {data.progress.na}</span>
                <span className="status-chip status-amber">예외 {data.progress.waived}</span>
              </span>
            </div>
            <div className="dd-progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="dd-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            {data.progress.mandatory_open.length > 0 && (
              <p className="dd-progress-note">
                필수 미충족 {data.progress.mandatory_open.length}건 — {data.progress.mandatory_open.map((m) => m.id).join(", ")}
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-[color:var(--red-fg)]">
              {error}
            </p>
          )}

          <ul className="dd-checklist">
            {data.items.map((item) => {
              const d = draftFor(item);
              const dirty = draft[item.id] !== undefined;
              return (
                <li key={item.id} className={`dd-checklist-item ${dirty ? "dd-checklist-item-dirty" : ""}`}>
                  <div className="dd-checklist-head">
                    <code className="dd-item-id">{item.id}</code>
                    {item.mandatory && <span className="dd-category-badge">필수</span>}
                    <span className={`status-chip ${item.status === "pass" ? "status-green" : item.status === "fail" ? "status-red" : item.status === "waived" ? "status-amber" : item.status === "pending" ? "status-not-started" : ""}`}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                    {item.assessed_by && (
                      <span className="dd-item-meta">
                        {item.assessed_by} · {item.assessed_at?.slice(0, 10)}
                      </span>
                    )}
                  </div>
                  <p className="dd-item-text">{item.text}</p>
                  <div className="dd-item-form">
                    <select aria-label={`${item.id} 판정`} value={d.status} onChange={(e) => setDraftItem(item, { status: e.target.value })}>
                      <option value="pass">충족</option>
                      <option value="fail">미충족</option>
                      <option value="na">해당없음</option>
                      {item.waiver_eligible && <option value="waived">예외(waiver)</option>}
                    </select>
                    <input type="text" aria-label={`${item.id} 근거`} placeholder="근거 (evidence_ref)" value={d.evidence_ref} onChange={(e) => setDraftItem(item, { evidence_ref: e.target.value })} />
                    <input type="text" aria-label={`${item.id} 메모`} placeholder="메모" value={d.note} onChange={(e) => setDraftItem(item, { note: e.target.value })} />
                    {d.status === "waived" && (
                      <input type="text" aria-label={`${item.id} waiver ID`} placeholder="waiver ID" value={d.waiver_id} onChange={(e) => setDraftItem(item, { waiver_id: e.target.value })} />
                    )}
                    <button type="button" className="btn-ghost" disabled={busyItem === item.id} onClick={() => assess(item)}>
                      {busyItem === item.id ? "저장 중..." : "판정 기록"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// ── 문서 열람 탭 (기존 뷰어) ────────────────────────────────────────────────
function MarkdownView({ text }: { text: string }) {
  const stripped = text.startsWith("---\n") ? text.slice(text.indexOf("\n---", 4) + 4).replace(/^\n+/, "") : text;
  const blocks: React.ReactNode[] = [];
  const lines = stripped.split("\n");
  let list: string[] = [];
  let code: string[] | null = null;
  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {list.map((li, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: inline(li) }} />
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const line of lines) {
    if (code !== null) {
      if (line.startsWith("```")) {
        blocks.push(
          <pre key={`code-${blocks.length}`} className="library-code">
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (line.startsWith("```")) {
      flushList();
      code = [];
    } else if (/^#{1,4}\s/.test(line)) {
      flushList();
      const level = line.match(/^#+/)![0].length;
      const content = line.replace(/^#+\s*/, "");
      blocks.push(
        level <= 2 ? (
          <h2 key={`h-${blocks.length}`}>{content}</h2>
        ) : (
          <h3 key={`h-${blocks.length}`}>{content}</h3>
        ),
      );
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      list.push(line.replace(/^\s*([-*]|\d+\.)\s*/, ""));
    } else if (line.startsWith("> ")) {
      flushList();
      blocks.push(
        <p key={`p-${blocks.length}`} className="library-blockquote" dangerouslySetInnerHTML={{ __html: inline(line.replace(/^>\s*/, "")) }} />,
      );
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={`p-${blocks.length}`} dangerouslySetInnerHTML={{ __html: inline(line) }} />);
    }
  }
  flushList();
  if (code !== null)
    blocks.push(
      <pre key="code-tail" className="library-code">
        <code>{code.join("\n")}</code>
      </pre>,
    );
  return <div className="library-doc-body">{blocks}</div>;
}

function DocViewer({ docs }: { docs: DocSummary[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setError(null);
    api
      .get<DocContent>(`/api/library/${selectedId}`)
      .then((r) => setDetail(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [selectedId]);

  return (
    <div className="library-layout">
      <div className="library-list-pane">
        <ul className="library-doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className={`library-doc-item ${selectedId === d.id ? "library-doc-item-active" : ""}`}
                onClick={() => setSelectedId(d.id)}
              >
                <span className="library-doc-title">{d.title}</span>
                <span className="library-doc-meta">
                  <span className="library-doc-lang">{d.lang.toUpperCase()}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="library-content-pane">
        {!selectedId ? (
          <p className="text-[color:var(--muted-fg)] italic">왼쪽에서 문서를 선택하면 내용이 표시됩니다.</p>
        ) : error ? (
          <p role="alert" className="text-[color:var(--red-fg)]">
            {error}
          </p>
        ) : !detail ? (
          <p>불러오는 중...</p>
        ) : (
          <>
            <div className="library-content-head">
              <h2 className="library-content-title">{detail.title}</h2>
              <code className="library-doc-path">{detail.file}</code>
            </div>
            <MarkdownView text={detail.content} />
          </>
        )}
      </div>
    </div>
  );
}

// ── 페이지 ─────────────────────────────────────────────────────────────────
export function LibraryView() {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"progress" | "docs">("progress");
  const [docCategory, setDocCategory] = useState<"manual" | "policy">("manual");

  useEffect(() => {
    api
      .get<DocSummary[]>("/api/library")
      .then((r) => setDocs(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, []);

  const checklists = useMemo(() => (docs ?? []).filter((d) => d.category === "checklist"), [docs]);
  const docList = useMemo(() => (docs ?? []).filter((d): d is DocSummary => d.category === docCategory), [docs, docCategory]);

  return (
    <main>
      <h1>규정·체크리스트</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        체크리스트는 항목별 판정으로 진척을 관리하고, 운영 매뉴얼·규정은 문서로 열람합니다. 체크리스트 판정은 딜
        단위로 저장되어 워크플로우·실사 진척에 반영됩니다.
      </p>
      <div className="library-tabs" role="tablist" aria-label="보기 방식">
        <button type="button" role="tab" aria-selected={tab === "progress"} className={`library-tab ${tab === "progress" ? "library-tab-active" : ""}`} onClick={() => setTab("progress")}>
          체크리스트 진행 관리
        </button>
        <button type="button" role="tab" aria-selected={tab === "docs"} className={`library-tab ${tab === "docs" ? "library-tab-active" : ""}`} onClick={() => setTab("docs")}>
          문서 열람
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {docs === null ? (
        <p>불러오는 중...</p>
      ) : tab === "progress" ? (
        checklists.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">체크리스트가 없습니다.</p>
        ) : (
          <ProgressManager checklists={checklists} />
        )
      ) : (
        <>
          <div className="library-tabs" role="tablist" aria-label="문서 종류">
            <button type="button" role="tab" aria-selected={docCategory === "manual"} className={`library-tab ${docCategory === "manual" ? "library-tab-active" : ""}`} onClick={() => setDocCategory("manual")}>
              운영 매뉴얼
            </button>
            <button type="button" role="tab" aria-selected={docCategory === "policy"} className={`library-tab ${docCategory === "policy" ? "library-tab-active" : ""}`} onClick={() => setDocCategory("policy")}>
              규정
            </button>
          </div>
          <DocViewer docs={docList} />
        </>
      )}
    </main>
  );
}

export default LibraryView;
