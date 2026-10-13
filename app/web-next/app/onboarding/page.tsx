"use client";

// 온보딩 마법사 (ADR-0122 #5) — 빈 워크스페이스의 첫 검토 시작 안내.
// ux-designer-agent 온보딩 표준: 빈 상태는 한 문장 + 다음 행동 1개.
import Link from "next/link";

const STEPS = [
  { n: 1, label: "시장 선택·분석 (S1)", href: "/market", desc: "분석할 시장(산업)을 검색해 선택하거나 KSIC 코드로 새로 등록해 8단계 분석을 실행합니다." },
  { n: 2, label: "기회 발굴·평가 (S2)", href: "/opportunities", desc: "분석된 시장에서 기회를 발굴하고 기회·위험 요인을 근거로 매력도를 평가합니다." },
  { n: 3, label: "시너지 확인·선별 (S3)", href: "/synergy", desc: "그룹/계열사 역량과의 시너지와 전략적 적합성을 평가해 기회를 선별합니다." },
  { n: 4, label: "진출방식 결정 (S4)", href: "/route-decision", desc: "Greenfield(자체 역량) vs Brownfield(결합·투자)를 결정합니다 — 이후 단계는 화면이 안내합니다." },
];

export default function OnboardingPage() {
  return (
    <main>
      <h1>시작하기 <span className="status-chip status-gray">빈 워크스페이스 가이드</span></h1>
      <p className="objective">첫 신규사업 검토까지 4단계 — AI가 각 단계의 초안을 제안하고, 모든 결정은 사람이 기록합니다 (경계 #2).</p>
      <section className="market-section" aria-label="온보딩 단계">
        {STEPS.map((s) => (
          <div key={s.n} className="market-section" style={{ marginBottom: 10 }}>
            <h2 className="text-[0.9rem] mb-1">
              <span className="sizing-step-num">{s.n}</span> {s.label}
            </h2>
            <p className="text-[length:var(--fs-caption)]" style={{ margin: "0 0 6px" }}>{s.desc}</p>
            <Link className="btn-ghost btn-sm" href={s.href}>이동 →</Link>
          </div>
        ))}
      </section>
      <p className="note">시연 데이터로 먼저 둘러보려면 <Link href="/deals" className="text-[color:var(--accent)] underline">검토/안건 보드</Link>를 참고하세요.</p>
    </main>
  );
}
