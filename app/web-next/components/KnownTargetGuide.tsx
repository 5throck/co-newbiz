"use client";

// Wave C-3 (pilot-009 D-5): guidance for a deal started from a named target.
// The target is already pre-filled into S6; this panel walks the user through
// S1–S4 with the target as context. It never skips a stage predicate.
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api.ts";

interface TargetList { targets: Array<{ id: string; company_name: string; universe_note: string | null }> }
interface Process { stages: Array<{ id: string; name: string; status: string }>; currentStage: string | null }

const MARKER = "[알려진 대상]";
const stepHref = (opportunityId: string, stage: string) => `/deals/${encodeURIComponent(opportunityId)}/${stage.toLowerCase()}`;

export function KnownTargetGuide({ opportunityId }: { opportunityId: string }) {
  const [target, setTarget] = useState<string | null>(null);
  const [proc, setProc] = useState<Process | null>(null);

  useEffect(() => {
    api.get<TargetList>(`/api/brownfield/${encodeURIComponent(opportunityId)}/targets`)
      .then((r) => setTarget(r.data.targets.find((t) => (t.universe_note ?? "").startsWith(MARKER))?.company_name ?? null))
      .catch(() => setTarget(null));
    api.get<Process>(`/api/opportunities/${encodeURIComponent(opportunityId)}/process`)
      .then((r) => setProc(r.data))
      .catch(() => setProc(null));
  }, [opportunityId]);

  if (!target) return null;
  const steps = (proc?.stages ?? []).filter((s) => ["S1", "S2", "S3", "S4"].includes(s.id));
  return (
    <section aria-label="알려진 대상 안내" className="market-section" data-testid="known-target-guide">
      <h3 className="sizing-step-title text-[0.95rem]">알려진 대상으로 시작한 검토 — {target}</h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        대상 기업은 S6 대상 후보(후보 전체 목록)에 미리 등록되어 있습니다. S1~S4는 생략되지 않습니다 — 아래 순서대로 대상을 염두에 두고 완료하세요.
        시장 규모·경쟁 구조(S1), 매력도(S2), 시너지(S3), 진출방식 결정(S4)은 사람이 판단해 입력합니다.
      </p>
      <ol className="sizing-note-list mt-2">
        {steps.map((s) => (
          <li key={s.id}>
            <Link href={stepHref(opportunityId, s.id)} className="guide-link">{s.id} {s.name}</Link>
            {" — "}{s.status === "complete" ? "완료" : s.status === "current" ? "지금 진행" : "대기"}
          </li>
        ))}
      </ol>
    </section>
  );
}
