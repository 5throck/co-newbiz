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
import { useTranslations } from "next-intl";
import { ColGroup } from "../../components/ui.tsx";

// 모듈별 시장성 매트릭스 열 비율 — 모듈명·설명·라이선스·가격 전략이 긴 문단이므로
// 설명·가격에 넉넉한 몫을 주고 나머지는 균등 배분한다.
const MODULES_COL_PCT = [14, 34, 12, 20, 20] as const;

// 문안은 pages.strategy 카탈로그 키 — 렌더 시점에 해석한다.
const MODULES = [
  {
    name: "mod1Name",
    desc: "mod1Desc",
    market: "High",
    license: "mod1License",
    pricingNote: "mod1Pricing",
  },
  {
    name: "mod2Name",
    desc: "mod2Desc",
    market: "High",
    license: "mod2License",
    pricingNote: "mod2Pricing",
  },
  {
    name: "mod3Name",
    desc: "mod3Desc",
    market: "Medium-High",
    license: "mod3License",
    pricingNote: "mod3Pricing",
  },
  {
    name: "mod4Name",
    desc: "mod4Desc",
    market: "Medium",
    license: "mod4License",
    pricingNote: "mod4Pricing",
  },
  {
    name: "mod5Name",
    desc: "mod5Desc",
    market: "Medium",
    license: "mod5License",
    pricingNote: "mod5Pricing",
  },
  {
    name: "mod6Name",
    desc: "mod6Desc",
    market: "Low-Medium",
    license: "mod6License",
    pricingNote: "mod6Pricing",
  },
];

const STRATEGY_PILLARS = [
  {
    icon: <Layers size={22} />,
    title: "pillarPlatform",
    points: ["pillarPlatformPt1", "pillarPlatformPt2", "pillarPlatformPt3", "pillarPlatformPt4"],
  },
  {
    icon: <TrendingUp size={22} />,
    title: "pillarMarketability",
    points: ["pillarMarketabilityPt1", "pillarMarketabilityPt2", "pillarMarketabilityPt3", "pillarMarketabilityPt4"],
  },
  {
    icon: <Scale size={22} />,
    title: "pillarLicensing",
    points: ["pillarLicensingPt1", "pillarLicensingPt2", "pillarLicensingPt3", "pillarLicensingPt4"],
  },
  {
    icon: <DollarSign size={22} />,
    title: "pillarPricing",
    points: ["pillarPricingPt1", "pillarPricingPt2", "pillarPricingPt3", "pillarPricingPt4"],
  },
  {
    icon: <Code2 size={22} />,
    title: "pillarSourcing",
    points: ["pillarSourcingPt1", "pillarSourcingPt2", "pillarSourcingPt3", "pillarSourcingPt4"],
  },
  {
    icon: <ShieldCheck size={22} />,
    title: "pillarGovernance",
    points: ["pillarGovernancePt1", "pillarGovernancePt2", "pillarGovernancePt3", "pillarGovernancePt4"],
  },
];

export default function StrategyPage() {
  const t = useTranslations("pages.strategy");
  return (
    <main className="strategy-page">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="text-3xl font-black mb-2">{t("h1")}</h1>
        <p className="text-[color:var(--muted-fg)] mb-8 max-w-3xl">
          {t("intro")}
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
              <h3 className="font-bold text-lg">{t(pillar.title)}</h3>
            </div>
            <ul className="space-y-2">
              {pillar.points.map((p, j) => (
                <li key={j} className="flex gap-2 text-sm leading-relaxed">
                  <span className="text-[color:var(--primary)] mt-1">▸</span>
                  <span>{t(p)}</span>
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
          {t("modulesHeading")}
        </h2>
        <div className="table-scroll" role="region" aria-label={t("tableScrollAria")} tabIndex={0}>
          <table className="w-full border-collapse table-fixed-pct tmin-56">
            <ColGroup widths={MODULES_COL_PCT} />
            <caption className="sr-only">{t("modulesHeading")}</caption>
            <thead>
              <tr className="text-left text-sm">
                <th className="p-3 border-b border-[color:var(--border)]">{t("colModule")}</th>
                <th className="p-3 border-b border-[color:var(--border)]">{t("colDesc")}</th>
                <th className="p-3 border-b border-[color:var(--border)]">{t("colMarket")}</th>
                <th className="p-3 border-b border-[color:var(--border)]">{t("colLicense")}</th>
                <th className="p-3 border-b border-[color:var(--border)]">{t("colPricing")}</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.name} className="text-sm align-top">
                  <td className="p-3 border-b border-[color:var(--border-subtle)] font-semibold">
                    {t(m.name)}
                  </td>
                  <td className="p-3 border-b border-[color:var(--border-subtle)] text-[color:var(--muted-fg)] cell-clamp-3">
                    {t(m.desc)}
                  </td>
                  <td className="p-3 border-b border-[color:var(--border-subtle)]">
                    <MarketBadge level={m.market} />
                  </td>
                  <td className="p-3 border-b border-[color:var(--border-subtle)] text-[color:var(--muted-fg)]">
                    {t(m.license)}
                  </td>
                  <td className="p-3 border-b border-[color:var(--border-subtle)] text-[color:var(--muted-fg)] cell-clamp-3">
                    {t(m.pricingNote)}
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
          <strong>{t("recommendationLead")}</strong> {t("recommendationBody")}
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
