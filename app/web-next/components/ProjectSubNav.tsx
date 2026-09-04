// Project sub-navigation (ADR-0105) — the S8~S11 project surfaces are
// sibling detail pages under /projects/[id]; this bar keeps them linked so a
// standard screen is never an orphan (menu 등록 외 상세 화면 연동 규약).
import Link from "next/link";
import { usePathname } from "next/navigation";

const SUB_PAGES = [
  { seg: "", label: "개요" },
  { seg: "/business-case", label: "사업성 분석" },
  { seg: "/dd", label: "실사·검증" },
  { seg: "/ic-review", label: "IC 심의" },
  { seg: "/portfolio", label: "사후관리" },
  { seg: "/charter", label: "차터" },
  { seg: "/process", label: "프로세스" },
] as const;

export function ProjectSubNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
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
