"use client";

import { useCallback, useEffect, useState } from "react";
import { formatBp } from "../lib/format.ts";
import {
  pmiApi,
  type DealShapeEvaluationRow,
  type DimensionInputRow,
  type IncentiveDeadlineRow,
  type KeyTalentRow,
  type SynergyCertificationRow,
} from "../lib/api.ts";

// PMI·증거 팩 (PMI & Evidence) tab — ADR-0063 write surfaces. Four evidence
// tables + the judged-fact assertion/review loop. Money fields are INTEGER
// KRW millions (ADR-0061); run_rate_bp is basis points of committed
// cost-synergy run-rate. Assertions land UNREVIEWED by design — a second
// member reviews cross-domain before any snapshot reads them.

const KEY_TALENT_STATUS_KO: Record<KeyTalentRow["status"], string> = {
  active: "재직",
  departed_regretted: "계획 외 이탈",
  departed_planned: "계획된 이탈",
};

const SHAPE_KO: Record<string, string> = {
  full_acquisition: "전량 인수",
  majority_stake: "과반 지분",
  spv: "SPV",
  holdco_route: "홀딩스 경유",
  joint_venture: "합작(JV)",
  minority_stake: "소수 지분",
  license_in: "라이선스 인",
  co_development: "공동 개발",
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function PmiEvidenceTab({ projectId }: { projectId: string }) {
  const [talent, setTalent] = useState<KeyTalentRow[]>([]);
  const [certs, setCerts] = useState<SynergyCertificationRow[]>([]);
  const [shapes, setShapes] = useState<DealShapeEvaluationRow[]>([]);
  const [deadlines, setDeadlines] = useState<IncentiveDeadlineRow[]>([]);
  const [inputs, setInputs] = useState<DimensionInputRow[]>([]);
  const [inputsMeta, setInputsMeta] = useState<{ count: number; reviewed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [t, c, s, d, i] = await Promise.all([
        pmiApi.keyTalent(projectId),
        pmiApi.synergyCertifications(projectId),
        pmiApi.dealShapeEvaluations(projectId),
        pmiApi.incentiveDeadlines(projectId),
        pmiApi.dimensionInputs(projectId),
      ]);
      setTalent(t.data ?? []);
      setCerts(c.data ?? []);
      setShapes(s.data ?? []);
      setDeadlines(d.data ?? []);
      setInputs(i.data ?? []);
      setInputsMeta((i.meta ?? null) as { count: number; reviewed: number } | null);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── form state ──
  const [talentForm, setTalentForm] = useState({ role_ref: "", status: "active" as KeyTalentRow["status"], locked_at: "", exit_date: "" });
  const [certForm, setCertForm] = useState({ run_rate_bp: "", sustained_quarters: "2", certified_by: "", baseline_locked_at: "", signed_at: "" });
  const [shapeForm, setShapeForm] = useState({ shape: "minority_stake", intent: "capability_access", viable: false });
  const [deadlineForm, setDeadlineForm] = useState({ incentive_ref: "", deadline: "", source: "" });
  const [assertForm, setAssertForm] = useState({ run_id: "", var_key: "", kind: "text", value: "", evidence_ref: "", rationale: "" });

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await reload();
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <section aria-label="PMI 및 증거 팩">
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}

      <h3>핵심인력 명부 (90일 이탈 트립와이어)</h3>
      <table>
        <thead>
          <tr>
            <th>역할 코드</th>
            <th>상태</th>
            <th>퇴사일</th>
            <th>명부 확정 시점</th>
          </tr>
        </thead>
        <tbody>
          {talent.map((row) => (
            <tr key={row.id}>
              <td>{row.role_ref}</td>
              <td>{KEY_TALENT_STATUS_KO[row.status]}</td>
              <td>{row.exit_date ?? "-"}</td>
              <td>{row.locked_at}</td>
            </tr>
          ))}
          {talent.length === 0 && (
            <tr>
              <td colSpan={4}>명부 미확정 — 90일 이탈률은 산출되지 않음(UNASSESSED)</td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await pmiApi.addKeyTalent(projectId, {
              role_ref: talentForm.role_ref,
              status: talentForm.status,
              locked_at: talentForm.locked_at,
              exit_date: talentForm.exit_date || null,
            });
            setTalentForm({ role_ref: "", status: "active", locked_at: "", exit_date: "" });
          });
        }}
      >
        <input placeholder="역할 코드 (C-EO-001)" value={talentForm.role_ref} onInput={(e) => setTalentForm({ ...talentForm, role_ref: (e.target as HTMLInputElement).value })} required />
        <select value={talentForm.status} onInput={(e) => setTalentForm({ ...talentForm, status: (e.target as HTMLSelectElement).value as KeyTalentRow["status"] })}>
          {Object.entries(KEY_TALENT_STATUS_KO).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <input type="date" value={talentForm.locked_at.slice(0, 10)} onInput={(e) => setTalentForm({ ...talentForm, locked_at: (e.target as HTMLInputElement).value })} required />
        {talentForm.status !== "active" && <input type="date" value={talentForm.exit_date} onInput={(e) => setTalentForm({ ...talentForm, exit_date: (e.target as HTMLInputElement).value })} />}
        <button type="submit">명부 추가</button>
      </form>

      <h3>시너지 런레이트 인증 (BAU 인수인계 완결성)</h3>
      <p className="hint">인증 기준: 약정 원가시너지의 90% 이상(9,000bp)을 2분기 연속 유지, CFO 서명 — Class C 결정 (c)</p>
      <table>
        <thead>
          <tr>
            <th>달성률(bp)</th>
            <th>유지 분기</th>
            <th>인증자</th>
            <th>서명일</th>
          </tr>
        </thead>
        <tbody>
          {certs.map((row) => (
            <tr key={row.id}>
              <td>{formatBp(row.run_rate_bp)}</td>
              <td>{row.sustained_quarters}</td>
              <td>{row.certified_by}</td>
              <td>{row.signed_at}</td>
            </tr>
          ))}
          {certs.length === 0 && (
            <tr>
              <td colSpan={4}>인증 기록 없음</td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await pmiApi.addSynergyCertification(projectId, {
              run_rate_bp: Number(certForm.run_rate_bp),
              sustained_quarters: Number(certForm.sustained_quarters),
              certified_by: certForm.certified_by,
              baseline_locked_at: certForm.baseline_locked_at,
              signed_at: certForm.signed_at,
            });
            setCertForm({ run_rate_bp: "", sustained_quarters: "2", certified_by: "", baseline_locked_at: "", signed_at: "" });
          });
        }}
      >
        <input type="number" min={0} max={10000} placeholder="달성률 bp (9000=90%)" value={certForm.run_rate_bp} onInput={(e) => setCertForm({ ...certForm, run_rate_bp: (e.target as HTMLInputElement).value })} required />
        <input type="number" min={1} placeholder="유지 분기" value={certForm.sustained_quarters} onInput={(e) => setCertForm({ ...certForm, sustained_quarters: (e.target as HTMLInputElement).value })} required />
        <input placeholder="인증자 (C-CFO-001)" value={certForm.certified_by} onInput={(e) => setCertForm({ ...certForm, certified_by: (e.target as HTMLInputElement).value })} required />
        <input type="date" placeholder="베이스라인 잠금일" value={certForm.baseline_locked_at} onInput={(e) => setCertForm({ ...certForm, baseline_locked_at: (e.target as HTMLInputElement).value })} required />
        <input type="date" placeholder="서명일" value={certForm.signed_at} onInput={(e) => setCertForm({ ...certForm, signed_at: (e.target as HTMLInputElement).value })} required />
        <button type="submit">인증 기록</button>
      </form>

      <h3>딜 쉐이프 평가 (P3 — 생존 쉐이프 카운트)</h3>
      <table>
        <thead>
          <tr>
            <th>쉐이프</th>
            <th>의도</th>
            <th>생존</th>
            <th>평가자</th>
          </tr>
        </thead>
        <tbody>
          {shapes.map((row) => (
            <tr key={row.id}>
              <td>{SHAPE_KO[row.shape] ?? row.shape}</td>
              <td>{row.intent === "integration" ? "통합" : "역량 접근"}</td>
              <td>{row.viable === 1 ? "생존" : "탈락"}</td>
              <td>{row.evaluated_by}</td>
            </tr>
          ))}
          {shapes.length === 0 && (
            <tr>
              <td colSpan={4}>평가 기록 없음 — P3 미도달</td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await pmiApi.addDealShapeEvaluation(projectId, { shape: shapeForm.shape, intent: shapeForm.intent as "integration" | "capability_access", viable: shapeForm.viable });
          });
        }}
      >
        <select value={shapeForm.shape} onInput={(e) => setShapeForm({ ...shapeForm, shape: (e.target as HTMLSelectElement).value })}>
          {Object.entries(SHAPE_KO).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select value={shapeForm.intent} onInput={(e) => setShapeForm({ ...shapeForm, intent: (e.target as HTMLSelectElement).value as "integration" | "capability_access" })}>
          <option value="integration">통합 의도</option>
          <option value="capability_access">역량 접근 의도</option>
        </select>
        <label>
          <input type="checkbox" checked={shapeForm.viable} onInput={(e) => setShapeForm({ ...shapeForm, viable: (e.target as HTMLInputElement).checked })} /> 생존
        </label>
        <button type="submit">평가 기록</button>
      </form>

      <h3>인센티브 마감일 (최조 마감이 바인드)</h3>
      <table>
        <thead>
          <tr>
            <th>인센티브</th>
            <th>마감</th>
            <th>출처</th>
          </tr>
        </thead>
        <tbody>
          {deadlines.map((row) => (
            <tr key={row.id}>
              <td>{row.incentive_ref}</td>
              <td>{row.deadline}</td>
              <td>{row.source ?? "-"}</td>
            </tr>
          ))}
          {deadlines.length === 0 && (
            <tr>
              <td colSpan={3}>기록 없음</td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await pmiApi.addIncentiveDeadline(projectId, { incentive_ref: deadlineForm.incentive_ref, deadline: deadlineForm.deadline, source: deadlineForm.source || undefined });
            setDeadlineForm({ incentive_ref: "", deadline: "", source: "" });
          });
        }}
      >
        <input placeholder="인센티브 식별자" value={deadlineForm.incentive_ref} onInput={(e) => setDeadlineForm({ ...deadlineForm, incentive_ref: (e.target as HTMLInputElement).value })} required />
        <input type="datetime-local" value={deadlineForm.deadline} onInput={(e) => setDeadlineForm({ ...deadlineForm, deadline: (e.target as HTMLInputElement).value })} required />
        <input placeholder="출처 (선택)" value={deadlineForm.source} onInput={(e) => setDeadlineForm({ ...deadlineForm, source: (e.target as HTMLInputElement).value })} />
        <button type="submit">마감 기록</button>
      </form>

      <h3>판단 변수 어설션 (dimension_input)</h3>
      <p className="hint">
        라이브 {inputsMeta?.count ?? inputs.length}건 · 검토 완료 {inputsMeta?.reviewed ?? 0}건. 어설션은 검토 전 상태로 착지하며,
        다른 구성원의 교차 검토를 거쳐야 스냅샷이 읽습니다.
      </p>
      <table>
        <thead>
          <tr>
            <th>변수</th>
            <th>값</th>
            <th>어설션/검토</th>
            <th>근거</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {inputs.map((row) => (
            <tr key={row.id}>
              <td>{row.var_key}</td>
              <td>{row.value_kind === "num" ? row.value_num : (row.value_text ?? "-")}</td>
              <td>
                {row.asserted_by} → {row.reviewed_by ?? "검토 대기"}
              </td>
              <td>{row.rationale}</td>
              <td>
                {!row.reviewed_by && (
                  <button type="button" onClick={() => void run(() => pmiApi.reviewDimensionInput(projectId, row.id))}>
                    검토 승인
                  </button>
                )}
              </td>
            </tr>
          ))}
          {inputs.length === 0 && (
            <tr>
              <td colSpan={5}>라이브 어설션 없음</td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const kind = assertForm.kind as "num" | "text" | "bool";
          const value = kind === "num" ? Number(assertForm.value) : kind === "bool" ? assertForm.value === "true" : assertForm.value;
          void run(async () => {
            await pmiApi.assertDimensionInput(projectId, {
              run_id: assertForm.run_id,
              var_key: assertForm.var_key,
              value: { kind, value },
              evidence_ref: assertForm.evidence_ref,
              rationale: assertForm.rationale,
            });
            setAssertForm({ run_id: "", var_key: "", kind: "text", value: "", evidence_ref: "", rationale: "" });
          });
        }}
      >
        <input placeholder="run_id" value={assertForm.run_id} onInput={(e) => setAssertForm({ ...assertForm, run_id: (e.target as HTMLInputElement).value })} required />
        <input placeholder="var_key (예: legal.ip_assignment_chain_complete)" value={assertForm.var_key} onInput={(e) => setAssertForm({ ...assertForm, var_key: (e.target as HTMLInputElement).value })} required />
        <select value={assertForm.kind} onInput={(e) => setAssertForm({ ...assertForm, kind: (e.target as HTMLSelectElement).value })}>
          <option value="text">텍스트</option>
          <option value="num">숫자</option>
          <option value="bool">참/거짓</option>
        </select>
        {assertForm.kind === "bool" ? (
          <select value={assertForm.value} onInput={(e) => setAssertForm({ ...assertForm, value: (e.target as HTMLSelectElement).value })}>
            <option value="true">참</option>
            <option value="false">거짓</option>
          </select>
        ) : (
          <input placeholder="값" value={assertForm.value} onInput={(e) => setAssertForm({ ...assertForm, value: (e.target as HTMLInputElement).value })} required />
        )}
        <input placeholder="근거 참조 (doc:/src:/https:)" value={assertForm.evidence_ref} onInput={(e) => setAssertForm({ ...assertForm, evidence_ref: (e.target as HTMLInputElement).value })} required />
        <input placeholder="근거 설명" value={assertForm.rationale} onInput={(e) => setAssertForm({ ...assertForm, rationale: (e.target as HTMLInputElement).value })} required />
        <button type="submit">어설션 제출</button>
      </form>
    </section>
  );
}
