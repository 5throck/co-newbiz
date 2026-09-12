// Project sub-navigation (ADR-0105) — the S8~S12 project surfaces are
// sibling detail pages under /projects/[id]; this bar keeps them linked so a
// standard screen is never an orphan (menu 등록 외 상세 화면 연동 규약).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";

const SUB_PAGES = [
  { seg: "", label: "개요" },
  { seg: "/business-case", label: "사업성 분석" },
  { seg: "/wacc", label: "WACC" },
  { seg: "/financial-analysis", label: "재무분석" },
  { seg: "/dd", label: "실사·검증" },
  { seg: "/proxy-chain", label: "프록시 체인" },
  { seg: "/deal-structure", label: "투자구조" },
  { seg: "/ic-review", label: "IC 심의" },
  { seg: "/reports", label: "보고서" },
  { seg: "/portfolio", label: "사후관리" },
  { seg: "/partnership", label: "파트너·JV" },
  { seg: "/pmi", label: "PMI" },
  { seg: "/charter", label: "추진계획" },
  { seg: "/process", label: "프로세스" },
  // Wave 2 도구 (round-2/3 리뷰 신설 — data contract B3–B9)
  { seg: "/incentives", label: "인센티브" },
  { seg: "/sites", label: "부지·시설" },
  { seg: "/permits", label: "인허가·인증" },
  { seg: "/debt", label: "부채" },
  { seg: "/interviews", label: "인터뷰" },
  { seg: "/customer-coc", label: "고객 CoC" },
  { seg: "/comp-parity", label: "보상·형평" },
] as const;

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
    <nav aria-label="프로젝트 화면" className="flex flex-wrap gap-1 mb-3 text-[0.82rem]">
      {SUB_PAGES.map(({ seg, label }) => {
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
    </nav>
  );
}
