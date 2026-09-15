"use client";

import { motion } from "framer-motion";
import {
  Layers,
  Scale,
  TrendingUp,
  Code2,
  Building2,
  Lightbulb,
  DollarSign,
  ShieldCheck,
} from "lucide-react";

const MODULES = [
  {
    name: "스테이지 진행 오케스트레이션",
    desc: "Screening → Pre-FS → FS → DD → Entity IC → Group IC 6단계 진행과 Kill Criteria 강제 모델. 타 신규사업 평가 프로세스에 직접 이식 가능.",
    market: "High",
    license: "Platform Core (자체 개발)",
    pricingNote: "SaaS 라이선스 또는 온프레미 임베디드 형태로 외부 계열사/PEF에 제공",
  },
  {
    name: "RAG·컴플라이언스 스코어링 엔진",
    desc: "6차원 RAG 등급(재무·시장·데이터신뢰도·규제·기술·리스크) 우선순위 규칙 + 데이터 신뢰도 캡. 규제 프레임워크 독립적.",
    market: "High",
    license: "API 서비스화 (라이선스 분리)",
    pricingNote: "평가 건수 기반 usage 기반 과금 또는 연간 라이선스",
  },
  {
    name: "M&A 실사 검증 모듈",
    desc: "안티트러스트 HHI, 인증 양도성, 인센티브 클로백, 부채 우발채무 시뮬레이션 — 6개 필수 밸리데이터 패키지.",
    market: "Medium-High",
    license: "전문 도메인 애드온",
    pricingNote: "검토/안건 규모 연동 success-fee 대비 저렴한 flat 모듈 구독",
  },
  {
    name: "가치사슬 연계 산업 추정",
    desc: "직접 시장데이터 부재 산업의 수요 추정 체인 (신뢰등급 A/B/C). 공공 통계·업스트림 연동 자동화.",
    market: "Medium",
    license: "오픈소스 코어 + 엔터프라이즈 확장",
    pricingNote: "코어는 MIT 공개, 데이터 커넥터·캘리브레이션은 유료",
  },
  {
    name: "몬테카를로 시뮬레이션 엔진",
    desc: "시드 고정 재현 가능 NPV/P50/P95, 우발채무 확률 분포 적분. 재무 모델링 툴체인과 독립.",
    market: "Medium",
    license: "Python 라이브러리 라이선스화",
    pricingNote: "PyPI 배포 + 지원 계약(SLA) 판매",
  },
  {
    name: "용어집·거버넌스 레지스트리",
    desc: "why_it_matters_ko 기반 용어 통치, 해석 Q&A 레지스트리, ADR 인덱스. 조직 지식 자산화.",
    market: "Low-Medium",
    license: "내부 자산 (외부 비매각)",
    pricingNote: "플랫폼 로열티에 내재, 별도 판매 지양",
  },
];

const STRATEGY_PILLARS = [
  {
    icon: <Layers size={22} />,
    title: "플랫폼화 아키텍처",
    points: [
      "34개 에이전트 + MCP REST-only 계층을 독립 모듈로 분리",
      "코어(진행·RAG) vs 애드온(산업·리전 프로파일) 이원 구조로 확장성 확보",
      "멀티테넌트 격리: 프로젝트별 멤버십·MNPI·감사로그는 플랫폼 공통 인프라",
      "외부 계열사/PEF 제공 시 화이트라벨 배포 가능한 패키징 경계 설계",
    ],
  },
  {
    icon: <TrendingUp size={22} />,
    title: "모듈별 시장성 분석",
    points: [
      "진행 오케스트레이션·RAG 엔진: 신규사업 평가 수요 최대 (High)",
      "M&A 실사·몬테카를로: 검토/안건 Advisory 시장 타깃 (Medium-High)",
      "프록시 체인·용어집: 생태계 락인 효과 (Medium / Low)",
      "시장성 등급별 우선 투자 순위: 코어 2종 → 애드온 3종 → 자산 1종",
    ],
  },
  {
    icon: <Scale size={22} />,
    title: "라이선스화 정책",
    points: [
      "코어 2종: 상용 SaaS/임베디드 라이선스 (지적재산 방어 최우선)",
      "프록시 체인 코어: MIT 오픈소스로 생태계 선점 → 커넥터 유료화",
      "몬테카를로: PyPI + 엔터프라이즈 SLA 지원 계약",
      "용어집/거버넌스: 비매각 내부 자산, 플랫폼 로열티에 내재",
    ],
  },
  {
    icon: <DollarSign size={22} />,
    title: "Target Pricing 전략",
    points: [
      "자체 개발 원가: 인건비 + 인프라 + 규제 데이터 구독 기준 산정",
      "외주 소싱 기준선: 동등 기능 외주 견적의 70% 미만이면 자체 개발 유지",
      "모듈 단가: 검토/안건 규모/평가 건수 연동 usage 과금 vs 연간 flat 라이선스 혼합",
      "침투 가격: 초기 계열사 무상 → 외부 PEF 유료 전환의 단계적 monetization",
    ],
  },
  {
    icon: <Code2 size={22} />,
    title: "자체개발 vs 외주 소싱",
    points: [
      "핵심 차별화(진행·RAG·M&A 밸리데이터): 자체 개발 고정 (모방 불가 영역)",
      "비차별 UI/차트/리포팅: 조건부 외주 또는 오픈소스 활용",
      "규제 데이터 연동(DART/k-Law): 외부 API 구독이 자체 크롤링 대비 리스크 ↓",
      "QA·보안 스캔: 자동화 도구로 자체 커버, 인력 외주 최소화",
    ],
  },
  {
    icon: <ShieldCheck size={22} />,
    title: "거버넌스·리스크",
    points: [
      "라이선스화 시에도 PM 진행웨이·3단계 리뷰는 플랫폼 invariant 유지",
      "외주 소싱 시 코드 소유권·MNPI 처리책임 명문화 (FR-SEC 계열)",
      "오픈소스 방출 모듈은 내부 기밀(검토/안건 데이터) 누출 차단 경계 검증",
      "상용화 전 ADR 트리거(설계 §7) 재점검: 라이선스 모델 변경은 ADR 대상",
    ],
  },
];

export default function StrategyPage() {
  return (
    <main className="strategy-page">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="text-3xl font-black mb-2">R&BD 플랫폼화 전략</h1>
        <p className="text-[color:var(--muted-fg)] mb-8 max-w-3xl">
          신규사업 검토(CO-NEWBIZ) 자산의 플랫폼화 — 주요 모듈별 시장성 분석,
          라이선스화 정책 검토, Target Pricing 기반 자체개발·외주 소싱 전략.
        </p>
      </motion.div>

      {/* Strategy Pillars */}
      <div className="strategy-grid">
        {STRATEGY_PILLARS.map((pillar, i) => (
          <motion.section
            key={pillar.title}
            className="glass p-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[color:var(--primary)]">{pillar.icon}</span>
              <h3 className="font-bold text-lg">{pillar.title}</h3>
            </div>
            <ul className="space-y-2">
              {pillar.points.map((p, j) => (
                <li key={j} className="flex gap-2 text-sm leading-relaxed">
                  <span className="text-[color:var(--primary)] mt-1">▸</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </motion.section>
        ))}
      </div>

      {/* Module Marketability Table */}
      <motion.section
        className="glass p-6 mt-8"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Building2 size={20} className="text-[color:var(--primary)]" />
          모듈별 시장성 · 라이선스 매트릭스
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-sm">
                <th className="p-3 border-b border-[color:var(--border)]">모듈</th>
                <th className="p-3 border-b border-[color:var(--border)]">설명</th>
                <th className="p-3 border-b border-[color:var(--border)]">시장성</th>
                <th className="p-3 border-b border-[color:var(--border)]">라이선스 정책</th>
                <th className="p-3 border-b border-[color:var(--border)]">가격 전략</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.name} className="text-sm align-top">
                  <td className="p-3 border-b border-[color:var(--border-subtle)] font-semibold">
                    {m.name}
                  </td>
                  <td className="p-3 border-b border-[color:var(--border-subtle)] text-[color:var(--muted-fg)] max-w-xs">
                    {m.desc}
                  </td>
                  <td className="p-3 border-b border-[color:var(--border-subtle)]">
                    <MarketBadge level={m.market} />
                  </td>
                  <td className="p-3 border-b border-[color:var(--border-subtle)] text-[color:var(--muted-fg)]">
                    {m.license}
                  </td>
                  <td className="p-3 border-b border-[color:var(--border-subtle)] text-[color:var(--muted-fg)] max-w-xs">
                    {m.pricingNote}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* Callout */}
      <motion.div
        className="glass-accent p-5 mt-8 flex gap-3 items-start"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <Lightbulb size={20} className="text-[color:var(--primary)] mt-0.5" />
        <p className="text-sm leading-relaxed">
          <strong>핵심 권고:</strong> 진행 오케스트레이션과 RAG 스코어링 엔진을
          플랫폼 코어로 자체 개발 고정하고, 프록시 체인 코어는 오픈소스로 생태계를
          선점하되 데이터 커넥터를 유료화하는 하이브리드 라이선스 전략을 우선한다.
          외주 소싱은 비차별 영역(UI/차트/리포팅)에 한정하고 규제 데이터 연동은
          구독형 외부 API로 리스크를 분리한다.
        </p>
      </motion.div>
    </main>
  );
}

function MarketBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    High: "bg-[color:var(--green-bg)] text-[color:var(--green-fg)] border border-[color:var(--green-border)]",
    "Medium-High": "bg-[color:var(--amber-bg)] text-[color:var(--amber-fg)] border border-[color:var(--amber-border)]",
    Medium: "bg-[color:var(--primary-bg)] text-[color:var(--primary-dim)] border border-[color:var(--primary-border)]",
    "Low-Medium": "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)] border border-[color:var(--border)]",
    Low: "bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)] border border-[color:var(--border)]",
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-bold ${map[level] ?? ""}`}>
      {level}
    </span>
  );
}
