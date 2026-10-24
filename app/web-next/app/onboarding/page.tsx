// 온보딩 마법사 (ADR-0122 #5) — 빈 워크스페이스의 첫 검토 시작 안내.
// ux-designer-agent 온보딩 표준: 빈 상태는 한 문장 + 다음 행동 1개.
import Link from "next/link";
import { getTranslations } from "next-intl/server";

// Label maps stay out of JSX — steps resolve their translation keys at render.
const STEPS = [
  { n: 1, labelKey: "s1Label", href: "/market", descKey: "s1Desc" },
  { n: 2, labelKey: "s2Label", href: "/opportunities", descKey: "s2Desc" },
  { n: 3, labelKey: "s3Label", href: "/synergy", descKey: "s3Desc" },
  { n: 4, labelKey: "s4Label", href: "/route-decision", descKey: "s4Desc" },
];

export default async function OnboardingPage() {
  const t = await getTranslations("pages.onboarding");
  return (
    <main>
      <h1>{t("heading")} <span className="status-chip status-gray">{t("badge")}</span></h1>
      <p className="objective">{t("objective")}</p>
      <section className="market-section" aria-label={t("sectionAria")}>
        {STEPS.map((s) => (
          <div key={s.n} className="market-section" style={{ marginBottom: 10 }}>
            <h2 className="text-[length:var(--fs-body)] mb-1">
              <span className="sizing-step-num">{s.n}</span> {t(s.labelKey)}
            </h2>
            <p className="text-[length:var(--fs-caption)]" style={{ margin: "0 0 6px" /* design-token-exempt: off-scale legacy spacing (visual-preserving) */ }}>{t(s.descKey)}</p>
            <Link className="btn-ghost btn-sm" href={s.href}>{t("go")}</Link>
          </div>
        ))}
        {/* 승격 이후 — 단계 목록과 같은 리스트 스타일의 이어짐 (F11). 이동 링크는
            없다: 승격은 트랙 최종 단계(S5/S7) 화면에서 사람이 실행한다. */}
        <div className="market-section" style={{ marginBottom: 10 }}>
          <h2 className="text-[length:var(--fs-body)] mb-1">{t("promotionHeading")}</h2>
          <p className="text-[length:var(--fs-caption)]" style={{ margin: "0 0 6px" /* design-token-exempt: off-scale legacy spacing (visual-preserving) */ }}>
            {t("promotionDesc")}
          </p>
        </div>
        <div className="market-section" style={{ marginBottom: 10 }}>
          <h2 className="text-[length:var(--fs-body)] mb-1">{t("projectStagesHeading")}</h2>
          <p className="text-[length:var(--fs-caption)]" style={{ margin: "0 0 6px" /* design-token-exempt: off-scale legacy spacing (visual-preserving) */ }}>
            {t("projectStagesDesc")}
          </p>
        </div>
      </section>
      <p className="note">{t("demoNotePre")}<Link href="/deals" className="text-[color:var(--accent)] underline">{t("demoLink")}</Link>{t("demoNotePost")}</p>
    </main>
  );
}
