"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";

// 활동·보고서 탭 — 딜의 모든 워크플로우 산출물(런, 시뮬레이션, DD 판정,
// 조사내역, RAG, 검토, 스냅샷)을 시간순 타임라인으로 조회하고, 현재 시점의
// 분석 결과를 보고서 스냅샷으로 저장한다(조사결과 영속화).

interface ActivityEntry {
  ts: string;
  kind: string;
  label: string;
  actor: string | null;
  ref: string;
}

interface SnapshotRow {
  id: string;
  title: string;
  created_by: string;
  created_at: string;
}

interface SnapshotContent {
  id: string;
  title: string;
  content_md: string;
  created_by: string;
  created_at: string;
}

const KIND_LABELS: Record<string, string> = {
  run: "런",
  simulation: "시뮬레이션",
  dd_assessment: "DD 판정",
  dd_finding: "조사내역",
  rag: "RAG",
  review: "검토",
  snapshot: "스냅샷",
};

const KIND_TONES: Record<string, string> = {
  run: "status-in-progress",
  simulation: "status-in-progress",
  dd_assessment: "status-approved",
  dd_finding: "status-unknown",
  rag: "status-in-progress",
  review: "status-approved",
  snapshot: "status-approved",
};

export function ActivityTab({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openSnapshot, setOpenSnapshot] = useState<SnapshotContent | null>(null);

  const load = useCallback(() => {
    api.get<ActivityEntry[]>(`/api/projects/${projectId}/activity`).then((r) => setEntries(r.data)).catch(() => setEntries([]));
    api.get<SnapshotRow[]>(`/api/projects/${projectId}/snapshots`).then((r) => setSnapshots(r.data)).catch(() => setSnapshots([]));
  }, [projectId]);

  useEffect(load, [load]);

  async function createSnapshot() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/snapshots`, {});
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "스냅샷 생성 실패");
    } finally {
      setBusy(false);
    }
  }

  async function viewSnapshot(snapId: string) {
    setError(null);
    try {
      const res = await api.get<SnapshotContent>(`/api/projects/${projectId}/snapshots/${snapId}`);
      setOpenSnapshot(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "스냅샷 조회 실패");
    }
  }

  return (
    <div>
      <div className="activity-head">
        <h2 className="mb-0">보고서 스냅샷</h2>
        <button type="button" className="btn-ghost" disabled={busy} onClick={createSnapshot}>
          {busy ? "생성 중..." : "현재 결과로 스냅샷 생성"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {snapshots === null ? (
        <p>불러오는 중...</p>
      ) : snapshots.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">
          저장된 스냅샷이 없습니다. 스냅샷을 만들면 이 시점의 분석 결과(런·시뮬레이션·RAG·DD 진척·검토)가 기록되어 나중에 조회할 수
          있습니다.
        </p>
      ) : (
        <ul className="snapshot-list">
          {snapshots.map((s) => (
            <li key={s.id} className="snapshot-row">
              <span className="snapshot-title">{s.title}</span>
              <span className="cell-sub">
                {s.created_by} · {s.created_at.slice(0, 16).replace("T", " ")}
              </span>
              <button type="button" className="btn-ghost" onClick={() => viewSnapshot(s.id)}>
                보기
              </button>
            </li>
          ))}
        </ul>
      )}
      {openSnapshot && (
        <div className="snapshot-view">
          <div className="activity-head">
            <h3 className="mb-0">{openSnapshot.title}</h3>
            <button type="button" className="btn-ghost" onClick={() => setOpenSnapshot(null)}>
              닫기
            </button>
          </div>
          <pre className="library-code">
            <code>{openSnapshot.content_md}</code>
          </pre>
        </div>
      )}

      <h2 className="mt-8 mb-2">활동 타임라인</h2>
      {entries === null ? (
        <p>불러오는 중...</p>
      ) : entries.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">기록된 활동이 없습니다.</p>
      ) : (
        <ul className="activity-list">
          {entries.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="activity-row">
              <span className="tabular-nums cell-sub activity-ts">{e.ts.slice(0, 16).replace("T", " ")}</span>
              <span className={`status-chip ${KIND_TONES[e.kind] ?? "status-unknown"}`}>{KIND_LABELS[e.kind] ?? e.kind}</span>
              <span className="activity-label">{e.label}</span>
              {e.actor && <span className="cell-sub">{e.actor}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
