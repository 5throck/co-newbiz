// Project sub-navigation (ADR-0105) — the S8~S12 project surfaces are
// sibling detail pages under /projects/[id]; this bar keeps them linked so a
// standard screen is never an orphan (menu 등록 외 상세 화면 연동 규약).
//
// `group` clusters the flat link list under its owning stage heading so the
// S8~S12 boundary (invisible before this change — 23 links, no structure) is
// visible here too, not only in StageFrame's S1~S12 rail further down each
// page. This mapping is local to this file, not added to lib/stage-meta.ts's
// StageMeta shape, since that shape is asserted verbatim against flow.spec by
// tests/unit/process-flow.test.ts.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { getStageMeta, type StageMetaId } from "../lib/stage-meta.ts";

type Group = StageMetaId | "site" | "tools";

const SUB_PAGES: ReadonlyArray<{ seg: string; label: string; group: Group }> = [
  { seg: "", label: "개요", group: "S8" },
  // WACC·재무분석은 S8 사업성 분석 화면의 탭으로 통합됐다 (?tab=wacc /
  // ?tab=financial-analysis) — 여기서는 더 이상 별도 항목으로 노출하지
  // 않는다. 기존 URL은 계속 동작한다(business-case로의 얇은 래퍼).
  { seg: "/business-case", label: "사업성 분석", group: "S8" },
  { seg: "/dd", label: "실사·검증", group: "S9" },
  { seg: "/proxy-chain", label: "가치사슬 연계", group: "S9" },
  { seg: "/deal-structure", label: "투자구조", group: "S10" },
  { seg: "/debt", label: "부채", group: "S10" },
  { seg: "/ic-review", label: "IC 심의", group: "S11" },
  { seg: "/reports", label: "보고서", group: "S11" },
  { seg: "/portfolio", label: "사후관리", group: "S12" },
  { seg: "/partnership", label: "파트너·JV", group: "S12" },
  { seg: "/pmi", label: "PMI", group: "S12" },
  { seg: "/charter", label: "추진계획", group: "S12" },
  { seg: "/process", label: "프로세스", group: "S12" },
  // 입지·인허가 — 부지 선정 시 필요한 사안들이 특정 단계에 속하지 않아
  // 이전에는 "도구" 잡동사니 그룹에 섞여 있었다. 별도 그룹으로 분리.
  { seg: "/incentives", label: "인센티브", group: "site" },
  { seg: "/sites", label: "부지·시설", group: "site" },
  { seg: "/permits", label: "인허가·인증", group: "site" },
  // Wave 2 도구 (round-2/3 리뷰 신설 — data contract B3–B9)
  { seg: "/interviews", label: "인터뷰", group: "tools" },
  { seg: "/customer-coc", label: "고객 CoC", group: "tools" },
  { seg: "/comp-parity", label: "보상·형평", group: "tools" },
  // Wave 3 투명성·학습 표면 (ADR-0123)
  { seg: "/agent-runs", label: "에이전트 이력", group: "tools" },
  { seg: "/backtest", label: "백테스트", group: "tools" },
  { seg: "/share", label: "외부 공유", group: "tools" },
  // ADR-0122 — 단계 횡단 리스크/타임라인 표면. 화면은 이미 있었으나 이
  // 목록에 등록되지 않아 직접 링크로만 도달 가능했다.
  { seg: "/timeline", label: "타임라인·SLA", group: "tools" },
  { seg: "/risk-heatmap", label: "리스크 히트맵", group: "tools" },
] as const;

const GROUP_ORDER: Group[] = ["S8", "S9", "S10", "S11", "S12", "site", "tools"];

function groupHeading(g: Group): string {
  if (g === "tools") return "도구";
  if (g === "site") return "입지·인허가";
  const meta = getStageMeta(g);
  return `${meta.id} · ${meta.name}`;
}

export function ProjectSubNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const [track, setTrack] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ process: { track: string | null } | null }>(`/api/projects/${encodeURIComponent(projectId)}/process`)
      .then((r) => setTrack(r.data.process?.track ?? null))
      .catch(() => {});
  }, [projectId]);
  const base = `/projects/${projectId}`;
  return (
    <nav aria-label="프로젝트 화면" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3 text-[0.82rem]">
      {GROUP_ORDER.map((g) => {
        const items = SUB_PAGES.filter((p) => p.group === g);
        if (items.length === 0) return null;
        return (
          <span key={g} className="flex flex-wrap items-baseline gap-1">
            <span className="text-[0.68rem] uppercase tracking-wide text-[color:var(--muted-fg)] opacity-70">{groupHeading(g)}</span>
            {items.map(({ seg, label }) => {
              const href = `${base}${seg}`;
              const active = pathname === href;
              return (
                <Link
                  key={seg || "overview"}
                  href={href}
                  className={`px-2 py-1 rounded ${active ? "font-semibold text-[color:var(--accent)] underline underline-offset-2" : "text-[color:var(--muted-fg)] hover:underline"}`}
                  aria-current={active ? "page" : undefined}
                >
                  {label}
                </Link>
              );
            })}
          </span>
        );
      })}
    </nav>
  );
}
