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

type Group = StageMetaId | "tools";

const SUB_PAGES: ReadonlyArray<{ seg: string; label: string; group: Group }> = [
  { seg: "", label: "개요", group: "S8" },
  { seg: "/business-case", label: "사업성 분석", group: "S8" },
  { seg: "/wacc", label: "WACC", group: "S8" },
  { seg: "/financial-analysis", label: "재무분석", group: "S8" },
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
  // Wave 2 도구 (round-2/3 리뷰 신설 — data contract B3–B9)
  { seg: "/incentives", label: "인센티브", group: "tools" },
  { seg: "/sites", label: "부지·시설", group: "tools" },
  { seg: "/permits", label: "인허가·인증", group: "tools" },
  { seg: "/interviews", label: "인터뷰", group: "tools" },
  { seg: "/customer-coc", label: "고객 CoC", group: "tools" },
  { seg: "/comp-parity", label: "보상·형평", group: "tools" },
  // Wave 3 투명성·학습 표면 (ADR-0123)
  { seg: "/agent-runs", label: "에이전트 이력", group: "tools" },
  { seg: "/backtest", label: "백테스트", group: "tools" },
  { seg: "/share", label: "외부 공유", group: "tools" },
] as const;

const GROUP_ORDER: Group[] = ["S8", "S9", "S10", "S11", "S12", "tools"];

function groupHeading(g: Group): string {
  if (g === "tools") return "도구";
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
