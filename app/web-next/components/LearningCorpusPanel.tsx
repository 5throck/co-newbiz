"use client";

// 과거 학습 코퍼스 패널 (2026-10-21, ADR-0150 기준 6) — S1 시장분석·S2 기회 발굴
// 화면에서 kill_with_learning_captured 결정의 학습 내용을 참고로 보여준다.
// 표시 전용: 기본률(base rate) 조정 판단은 risk-officer/사람의 몫이며, 이 패널은
// 그 판단의 재료(코퍼스)를 S1/S2에 가져다 놓는다. 비멤버에게는 프로젝트 식별이
// 가려지고 학습 문장만 보인다.
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";

interface LearningRow { project_id: string | null; project_no: string | null; name: string | null; track: string | null; review_cycle: string; decided_at: string; rationale: string; learning_capture: string }
interface Corpus { rows: LearningRow[]; by_track: Array<{ track: string | null; kills: number }>; total: number }

const TRACK_LABEL: Record<string, string> = { greenfield: "Green Field", brownfield: "Brown Field" };

export function LearningCorpusPanel({ track, limit = 5 }: { track?: string | null; limit?: number }) {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ limit: String(limit) });
    if (track) qs.set("track", track);
    api.get<Corpus>(`/api/portfolio/learnings?${qs.toString()}`)
      .then((r) => { if (alive) setCorpus(r.data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [track, limit]);

  if (failed || !corpus || corpus.total === 0) return null;

  return (
    <details className="card mt-2" data-testid="learning-corpus">
      <summary className="cursor-pointer text-[length:var(--fs-caption)]">
        <span className="status-chip status-not-started mr-1">과거 학습 {corpus.total}건</span>
        중단(kill) 결정에서 포착된 학습 — 기본률 참고 (
        {corpus.by_track.map((t) => `${TRACK_LABEL[t.track ?? ""] ?? t.track ?? "미분류"} ${t.kills}`).join(" · ")})
      </summary>
      <ul className="sizing-note-list mt-1">
        {corpus.rows.map((r, i) => (
          <li key={`${r.project_id ?? "anon"}-${r.review_cycle}-${i}`}>
            <strong>{r.name ?? "(프로젝트 비공개)"}</strong>
            <span className="note ml-1">{TRACK_LABEL[r.track ?? ""] ?? r.track ?? ""} · {r.review_cycle} · {r.decided_at.slice(0, 10)}</span>
            <span className="block text-[length:var(--fs-caption)]">{r.learning_capture}</span>
          </li>
        ))}
      </ul>
      <p className="note" style={{ marginBottom: 0 }}>참고 표시 — S1/S2 기본률에 어떻게 반영할지는 risk-officer·사람이 판단합니다 (ADR-0150 기준 6).</p>
    </details>
  );
}
