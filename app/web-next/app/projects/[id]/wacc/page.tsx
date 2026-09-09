"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { api } from "../../../../lib/api.ts";

interface WaccResolution {
  value: number;
  source: "user" | "run_input" | "default";
  run_id: string | null;
  as_of: string | null;
  rationale: string | null;
  anchor_ref: string | null;
}
interface View { wacc: WaccResolution; hurdle_irr: WaccResolution | null }

function pct(n: number | null | undefined) {
  return typeof n === "number" ? `${(n * 100).toFixed(2)}%` : "—";
}

export default function ProjectWaccPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [view, setView] = useState<View | null>(null);
  const [wacc, setWacc] = useState("0.10");
  const [hurdle, setHurdle] = useState("");
  const [rationale, setRationale] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/wacc`)
      .then((r) => {
        setView(r.data);
        setWacc(String(r.data.wacc.value));
        if (r.data.hurdle_irr) setHurdle(String(r.data.hurdle_irr.value));
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "WACC 정보를 불러오지 못했습니다."));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    try {
      const res = await api.post<View & { run_id: string }>(`/api/projects/${encodeURIComponent(projectId)}/wacc`, {
        wacc: Number(wacc),
        hurdle_irr: hurdle.trim() ? Number(hurdle) : undefined,
        mode: "direct",
        rationale,
      });
      setView({ wacc: res.data.wacc, hurdle_irr: res.data.hurdle_irr });
      setMessage(`저장 완료 — run ${res.data.run_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "WACC 입력 세션 저장에 실패했습니다.");
    }
  }

  return (
    <main className="market-page">
      <ProjectSubNav projectId={projectId} />
      <StageFrame stageId="S8" heading="WACC 입력 세션 — FS 게이트 할인율 확정">
        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem]">✕ {error}</p>}
        {message && <p className="text-[color:var(--green-fg)] text-[0.82rem]">✓ {message}</p>}
        <section className="market-section sizing-step">
          <h3 className="sizing-step-title">현재 확정값</h3>
          {!view ? <p>불러오는 중...</p> : <dl className="grid gap-2 md:grid-cols-2 text-sm">
            <div><dt className="text-[color:var(--muted-fg)]">WACC</dt><dd className="font-semibold">{pct(view.wacc.value)} ({view.wacc.source})</dd></div>
            <div><dt className="text-[color:var(--muted-fg)]">Hurdle IRR</dt><dd className="font-semibold">{pct(view.hurdle_irr?.value)}</dd></div>
            <div><dt className="text-[color:var(--muted-fg)]">Run</dt><dd className="font-mono">{view.wacc.run_id ?? "—"}</dd></div>
            <div><dt className="text-[color:var(--muted-fg)]">As of</dt><dd>{view.wacc.as_of ?? "—"}</dd></div>
          </dl>}
        </section>
        <form className="market-section sizing-step mt-3 grid gap-3" onSubmit={submit}>
          <h3 className="sizing-step-title">직접 입력</h3>
          <label className="grid gap-1 text-sm">WACC (비율)<input className="form-input" value={wacc} onChange={(e) => setWacc(e.target.value)} placeholder="0.095" /></label>
          <label className="grid gap-1 text-sm">Hurdle IRR (선택)<input className="form-input" value={hurdle} onChange={(e) => setHurdle(e.target.value)} placeholder="0.15" /></label>
          <label className="grid gap-1 text-sm">근거/승인 메모<textarea className="form-input" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Treasury 확인, IC 가이드라인 등" /></label>
          <button className="primary-button" type="submit">kind='user'로 확정 저장</button>
          <p className="text-[color:var(--muted-fg)] text-[0.78rem]">저장 시 최신 run을 복사한 새 run_input 스냅샷과 assumption(wacc/hurdle_irr) 행이 함께 생성됩니다.</p>
        </form>
      </StageFrame>
    </main>
  );
}
