"use client";

// S9 실사·검증 — 기술 탭의 "S8 기술 항목 판정 (T2~T5)" 블록 (2026-10-20 decider round 4).
// The S8 technical lens items T2-T5 are JUDGED here by a person (analyst+), citing the
// DD findings above; S8 only reflects them (TechnicalLensPanel tabs). Sidecar storage
// on the opportunity (migration 0157), audited, boundary #2 — agents never record.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { useToast } from "../ui.tsx";
import {
  TECHNICAL_ITEM_KEYS, TECHNICAL_ITEM_LABELS, TECHNICAL_ITEM_VERDICTS, TECHNICAL_ITEM_VERDICT_KO,
  type TechnicalItemKey, type TechnicalItemVerdict, type TechnicalItemVerdictValue,
} from "../../lib/technical-item-verdicts.ts";

const VERDICT_CHIP: Record<TechnicalItemVerdictValue, string> = { met: "status-green", caution: "status-amber", unmet: "status-red" };

export function TechnicalItemsDdBlock({ projectId, canAct }: { projectId: string; canAct: boolean }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Partial<Record<TechnicalItemKey, TechnicalItemVerdict>> | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<TechnicalItemKey, { verdict: TechnicalItemVerdictValue; note: string }>>>({});
  const [busyKey, setBusyKey] = useState<TechnicalItemKey | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/technical-items`;

  useEffect(() => {
    let alive = true;
    api.get<{ items: TechnicalItemVerdict[] }>(base)
      .then((r) => { if (alive) setItems(Object.fromEntries((r.data.items ?? []).map((v) => [v.itemKey, v]))); })
      .catch(() => { if (alive) setItems({}); });
    return () => { alive = false; };
  }, [base]);

  async function save(key: TechnicalItemKey) {
    const d = drafts[key] ?? { verdict: items?.[key]?.verdict ?? "met", note: items?.[key]?.note ?? "" };
    setBusyKey(key);
    try {
      const r = await api.put<{ verdict: TechnicalItemVerdict }>(base, { itemKey: key, verdict: d.verdict, note: d.note });
      setItems((cur) => ({ ...(cur ?? {}), [key]: r.data.verdict }));
      setDrafts((cur) => { const next = { ...cur }; delete next[key]; return next; });
      toast(`${key} ${TECHNICAL_ITEM_LABELS[key]} 판정을 기록했습니다 — S8 기술 탭에 반영됩니다.`);
    } catch (e) {
      toast(e instanceof Error ? `기록 실패: ${e.message}` : "기록 실패");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="market-section sizing-step mt-4 mb-3" aria-label="S8 기술 항목 판정" data-testid="technical-items-dd">
      <h3 className="sizing-step-title text-[0.9rem]">S8 기술 항목 판정 (T2~T5)</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        S8 기술적 타당성 T2~T5의 판정 주전장입니다 — 근거는 위 체크리스트 판정과 조사내역을 인용하세요. 기록은 S8 기술 탭에 읽기 전용으로 반영되며 감사 로그에 남습니다 (사람 전용).
      </p>
      {items === null ? (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">불러오는 중…</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table" aria-label="S8 기술 항목 판정 표">
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">현재 판정</th>
                {canAct && <th scope="col">판정 기록</th>}
              </tr>
            </thead>
            <tbody>
              {TECHNICAL_ITEM_KEYS.map((key) => {
                const cur = items[key];
                const d = drafts[key] ?? { verdict: cur?.verdict ?? "met", note: cur?.note ?? "" };
                return (
                  <tr key={key} data-testid={`technical-item-row-${key}`}>
                    <td className="text-[length:var(--fs-caption)]"><span className="font-bold mr-1">{key}</span>{TECHNICAL_ITEM_LABELS[key]}</td>
                    <td className="text-[length:var(--fs-caption)]">
                      {cur
                        ? <><span className={`status-chip ${VERDICT_CHIP[cur.verdict]}`}>{TECHNICAL_ITEM_VERDICT_KO[cur.verdict]}</span><span className="block text-[color:var(--muted-fg)]">{cur.by} · {cur.at.slice(0, 10)}{cur.note ? ` · ${cur.note}` : ""}</span></>
                        : <span className="text-[color:var(--muted-fg)]">미판정</span>}
                    </td>
                    {canAct && (
                      <td className="text-[length:var(--fs-caption)]">
                        <div className="flex flex-wrap items-center gap-1">
                          <select aria-label={`${key} 판정`} className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }} value={d.verdict}
                            onChange={(e) => setDrafts((c) => ({ ...c, [key]: { ...d, verdict: e.target.value as TechnicalItemVerdictValue } }))}>
                            {TECHNICAL_ITEM_VERDICTS.map((v) => <option key={v} value={v}>{TECHNICAL_ITEM_VERDICT_KO[v]}</option>)}
                          </select>
                          <input aria-label={`${key} 근거`} className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "14rem" }} placeholder="근거 — 조사내역·체크리스트 항목 인용" value={d.note}
                            onChange={(e) => setDrafts((c) => ({ ...c, [key]: { ...d, note: e.target.value } }))} />
                          <button type="button" className="btn-ghost btn-sm" disabled={busyKey === key} onClick={() => void save(key)} data-testid={`technical-item-save-${key}`}>
                            {busyKey === key ? "기록 중…" : cur ? "수정" : "기록"}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
