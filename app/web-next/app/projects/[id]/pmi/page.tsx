"use client";

// PMI 사후통합 (deal detail surface) — 핵심인력 잔존(pmi_key_talent)과
// 시너지 인증(pmi_synergy_certification)을 관리한다. /projects/[id] 하위
// 상세 화면으로 메뉴 등록 없이 StageTabs로 진입한다.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useConfirm } from "../../../../components/crud.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";
import { KEY_TALENT_STATUS_LABEL } from "../../../../lib/labels.ts";
import { PMI_HIDDEN_NOTE, pmiErrorText } from "../../../../lib/post-management-view.ts";
import { ColGroup } from "../../../../components/ui.tsx";

// 시너지 인증 6열 — 인증자·관리에 여유, 나머지는 날짜·수치 열로 좁게.
const PMI_CERT_COL_PCT = [20, 12, 18, 17, 17, 16] as const;

interface Talent {
  id: string;
  role_ref: string;
  status: string;
  exit_date: string | null;
  locked_at: string;
  created_at: string;
}
interface Certification {
  id: string;
  run_rate_bp: number;
  sustained_quarters: number;
  certified_by: string;
  baseline_locked_at: string;
  signed_at: string;
  created_at: string;
}

// pmi_key_talent.status allows exactly active | departed_regretted | departed_planned (DB CHECK).
const TALENT_STATUS_CLASS: Record<string, string> = { active: "status-green", departed_regretted: "status-red", departed_planned: "status-amber" };
const TALENT_STATUS_ICON: Record<string, string> = { active: "●", departed_regretted: "✕", departed_planned: "◐" };

function bpToPercent(bp: number): string {
  return `${(bp / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

export default function PmiPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { me } = useAuth();
  // ADR-0161: PMI writes are refused (403 not_applicable_track) for greenfield and non-PMI sub-tracks.
  const [pmiApplies, setPmiApplies] = useState<boolean | null>(null);
  const canAct = canWriteProject(me?.role) && pmiApplies !== false;
  const { confirm, confirmDialog } = useConfirm();
  const [talents, setTalents] = useState<Talent[] | null>(null);
  const [certs, setCerts] = useState<Certification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTalent, setNewTalent] = useState("");
  const [newCert, setNewCert] = useState({ run_rate_bp: "", sustained_quarters: "", baseline_locked_at: "" });

  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  const load = useCallback(() => {
    Promise.all([
      api.get<{ talents: Talent[] }>(`${base}/pmi/key-talent`),
      api.get<{ certifications: Certification[] }>(`${base}/pmi/synergy-certifications`),
    ])
      .then(([t, c]) => { setTalents(t.data.talents); setCerts(c.data.certifications); })
      .catch((e) => setError(e instanceof Error ? e.message : "PMI 데이터를 불러오지 못했습니다."));
  }, [base]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<{ applicability: { pmi_applies: boolean } }>(`${base}/post-management`)
      .then((r) => setPmiApplies(r.data.applicability.pmi_applies))
      .catch(() => { /* unknown: keep today's behaviour; the server still guards every write */ });
  }, [base]);

  async function send(method: "post" | "put" | "delete", path: string, body?: unknown) {
    setBusy(true); setError(null);
    try {
      await api[method](`${base}${path}`, body);
      load();
    } catch (e) {
      setError(pmiErrorText((e as { code?: string } | null)?.code, e instanceof Error ? e.message : undefined, "저장 실패"));
    } finally {
      setBusy(false);
    }
  }

  function addTalent() {
    if (!newTalent.trim()) { setError("핵심인력 역할/식별자는 필수입니다."); return; }
    void send("post", "/pmi/key-talent", { role_ref: newTalent.trim() });
    setNewTalent("");
  }

  function addCert() {
    const bp = Number(newCert.run_rate_bp);
    const q = Number(newCert.sustained_quarters);
    if (!Number.isInteger(bp) || bp <= 0 || !Number.isInteger(q) || q <= 0) {
      setError("런레이트(bp)와 지속 분기 수는 양의 정수여야 합니다."); return;
    }
    void send("post", "/pmi/synergy-certifications", {
      run_rate_bp: bp,
      sustained_quarters: q,
      baseline_locked_at: newCert.baseline_locked_at.trim() || undefined,
    });
    setNewCert({ run_rate_bp: "", sustained_quarters: "", baseline_locked_at: "" });
  }

  return (
    <main className="market-page">
      <StageTabs projectId={projectId} />
      <header className="mb-3">
        <h1 className="text-[1.05rem] font-semibold">PMI 사후통합</h1>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          핵심 인력의 잔존 상태와 시너지 실현 인증(런레이트·지속 분기)을 관리합니다.
        </p>
      </header>

      {pmiApplies === false && (
        <p role="note" className="text-[length:var(--fs-caption)] mb-2" data-testid="pmi-not-applicable">
          <span className="status-chip status-not-started">○ 이 트랙에는 적용되지 않음</span>
          <span className="block mt-1 text-[color:var(--muted-fg)]">{PMI_HIDDEN_NOTE}</span>
        </p>
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}

      <section className="market-section mb-3" aria-label="핵심인력">
        <h2 className="text-[0.92rem] font-semibold mb-2">핵심인력 잔존 ({talents?.length ?? 0}명)</h2>
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table">
            <caption className="sr-only">PMI 핵심인력 목록</caption>
            <thead>
              <tr>
                <th scope="col">역할/식별자</th><th scope="col">상태</th><th scope="col">퇴사일</th>
                <th scope="col">등록일</th><th scope="col">관리</th>
              </tr>
            </thead>
            <tbody>
              {(talents ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{t.role_ref}</td>
                  <td><span className={`status-chip ${TALENT_STATUS_CLASS[t.status] ?? "status-not-started"}`}>{TALENT_STATUS_ICON[t.status] ?? "?"} {KEY_TALENT_STATUS_LABEL[t.status] ?? t.status}</span></td>
                  <td>{t.exit_date ? t.exit_date.slice(0, 10) : "—"}</td>
                  <td>{t.created_at.slice(0, 10)}</td>
                  <td>
                    {canAct && (
                      <span className="flex gap-1">
                        {t.status !== "active" && (
                          <button type="button" className="btn-ghost btn-sm" disabled={busy}
                            onClick={() => confirm("재직 중으로 되돌림", () => { void send("put", `/pmi/key-talent/${t.id}`, { status: "active" }); }, { body: "이탈 기록을 해제하고 퇴사일을 지웁니다.", tone: "neutral", confirmLabel: "되돌림" })}>재직으로 되돌림</button>
                        )}
                        {t.status !== "departed_regretted" && (
                          <button type="button" className="btn-ghost btn-sm" disabled={busy}
                            onClick={() => confirm("아쉬운 퇴사 처리", () => { void send("put", `/pmi/key-talent/${t.id}`, { status: "departed_regretted" }); }, { body: "남기고 싶었던 핵심인력의 이탈로 기록하며 퇴사일이 오늘로 기록됩니다." })}>아쉬운 퇴사</button>
                        )}
                        {t.status !== "departed_planned" && (
                          <button type="button" className="btn-ghost btn-sm" disabled={busy}
                            onClick={() => confirm("계획된 퇴사·이동 처리", () => { void send("put", `/pmi/key-talent/${t.id}`, { status: "departed_planned" }); }, { body: "예정된 퇴사·이동으로 기록하며 퇴사일이 오늘로 기록됩니다." })}>계획된 퇴사·이동</button>
                        )}
                        <button type="button" className="btn-ghost btn-sm" disabled={busy}
                          onClick={() => confirm("핵심인력 삭제", () => { void send("delete", `/pmi/key-talent/${t.id}`); }, { body: `'${t.role_ref}' 항목이 삭제됩니다.`, confirmLabel: "삭제" })}>삭제</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {talents && talents.length === 0 && (
                <tr><td colSpan={5} className="text-[color:var(--muted-fg)]">등록된 핵심인력이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {canAct && (
          <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
            <input className="sizing-new-input" placeholder="예: CTO / 생산공장장 (핵심인력)" value={newTalent} onChange={(e) => setNewTalent(e.target.value)} />
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={addTalent}>등록</button>
          </div>
        )}
      </section>

      <section className="market-section" aria-label="시너지 인증">
        <h2 className="text-[0.92rem] font-semibold mb-2">시너지 인증 ({certs?.length ?? 0}건)</h2>
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-48">
            <caption className="sr-only">PMI 시너지 인증 목록</caption>
            <ColGroup widths={PMI_CERT_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">런레이트</th><th scope="col">지속 분기</th><th scope="col">인증자</th>
                <th scope="col">베이스라인 확정일</th><th scope="col">서명일</th><th scope="col">관리</th>
              </tr>
            </thead>
            <tbody>
              {(certs ?? []).map((c) => (
                <tr key={c.id}>
                  <td>{bpToPercent(c.run_rate_bp)} ({c.run_rate_bp.toLocaleString("ko-KR")}bp)</td>
                  <td>{c.sustained_quarters}분기</td>
                  <td>{c.certified_by}</td>
                  <td>{c.baseline_locked_at.slice(0, 10)}</td>
                  <td>{c.signed_at.slice(0, 10)}</td>
                  <td>
                    {canAct && (
                      <button type="button" className="btn-ghost btn-sm" disabled={busy}
                        onClick={() => confirm("시너지 인증 해제", () => { void send("delete", `/pmi/synergy-certifications/${c.id}`); }, { body: "이 인증 기록이 삭제(해제)됩니다.", confirmLabel: "해제" })}>해제</button>
                    )}
                  </td>
                </tr>
              ))}
              {certs && certs.length === 0 && (
                <tr><td colSpan={6} className="text-[color:var(--muted-fg)]">인증된 시너지가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {canAct && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">시너지 인증</summary>
            <div className="flex flex-wrap gap-2 mt-2 text-[length:var(--fs-caption)]">
              <label>런레이트 (bp, 연환산)
                <input className="sizing-new-input" type="number" min={1} step={1} value={newCert.run_rate_bp}
                  onChange={(e) => setNewCert({ ...newCert, run_rate_bp: e.target.value })} />
              </label>
              <label>지속 분기 수
                <input className="sizing-new-input" type="number" min={1} step={1} value={newCert.sustained_quarters}
                  onChange={(e) => setNewCert({ ...newCert, sustained_quarters: e.target.value })} />
              </label>
              <label>베이스라인 확정일 (빈칸=오늘)
                <input className="sizing-new-input" type="date" value={newCert.baseline_locked_at}
                  onChange={(e) => setNewCert({ ...newCert, baseline_locked_at: e.target.value })} />
              </label>
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={addCert}>인증</button>
            </div>
          </details>
        )}
      </section>

      {confirmDialog}
    </main>
  );
}
