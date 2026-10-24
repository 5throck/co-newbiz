"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useChartTheme } from "../../../lib/echarts-theme.ts";
import { EChart } from "../../EChart.tsx";
import { type SizingMatrix, segmentsOf, regionTotal, global2026, projection2030, bandFor } from "../../../lib/market-sizing.ts";
import { SEGMENT_COLORS, r3, fmtBillions } from "./marketFormat.ts";
import type { DriverSensitivity } from "./types.ts";
import { useTranslations } from "next-intl";

/* ── 단계별 차트 ── */

export function StepSensitivityChart({ stepNumber, sensitivities }: { stepNumber?: number; sensitivities: DriverSensitivity[] }) {const t = useTranslations("stages.s1.sizingCharts");
  const ct = useChartTheme();
  const agg = new Map<string, number>();
  for (const ds of sensitivities) {
    if (!agg.has(ds.driver_label)) agg.set(ds.driver_label, 0);
    agg.set(ds.driver_label, Math.max(agg.get(ds.driver_label)!, Math.abs(ds.sensitivity)));
  }
  const labels = [...agg.keys()];
  const values = labels.map((l) => Math.round((agg.get(l) ?? 0) * 100) / 100);
  if (labels.length === 0) return <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-caption)]">{t("noRecordedDriverSensitivities")}</p>;
  const option = {
    grid: { left: 140, right: 40, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: labels, axisLabel: { color: ct.muted, width: 120, overflow: "truncate" as const } },
    series: [{ type: "bar" as const, data: values, itemStyle: { color: ct.color[0], borderRadius: [0, 4, 4, 0] }, barMaxWidth: 22 }],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return (
    <div className="mt-4">
      {stepNumber !== undefined && <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{t("keyDriverSensitivityAbsoluteSensitivity")}</h4>}
      <EChart option={option} ariaLabel={t("keyDriverSensitivity")} height={Math.max(140, labels.length * 40 + 48)} />
    </div>
  );
}

export function AnchorChart({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingCharts");
  const ct = useChartTheme();
  const option = {
    grid: { left: 170, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: {
      type: "category" as const,
      data: matrix.anchor.sources.map((s) => s.label),
      axisLabel: { color: ct.muted, width: 150, overflow: "truncate" as const },
    },
    series: [
      {
        type: "bar" as const,
        data: matrix.anchor.sources.map((s) => ({
          value: s.estimate,
          itemStyle: { color: s.status === "excluded" ? ct.muted : ct.color[0], opacity: s.status === "excluded" ? 0.4 : 1, borderRadius: [0, 4, 4, 0] },
        })),
        barMaxWidth: 24,
        markLine: {
          symbol: "none",
          data: [{ xAxis: matrix.anchor.total, label: { formatter: t("anchorP1B", { p1: fmtBillions(matrix.anchor.total) }), color: ct.muted }, lineStyle: { color: ct.color[3], type: "dashed" as const, width: 2 } }],
        },
      },
    ],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} ariaLabel={t("tamSamSomAnchorSize")} height={170} />;
}

export function RegionWeightDonut({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingCharts");
  const ct = useChartTheme();
  const option: Record<string, unknown> = {
    tooltip: { trigger: "item", formatter: (p: { name?: string; percent?: number }) => `${p.name}: ${p.percent}%` },
    legend: { bottom: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    series: [{
      type: "pie" as const,
      radius: ["42%", "70%"],
      center: ["50%", "44%"],
      label: { color: ct.muted, formatter: "{d}%", fontSize: 10 },
      data: matrix.regions.map((r, i) => ({ name: r.label, value: r.weight, itemStyle: { color: ct.color[i % ct.color.length] } })),
    }],
  };
  return <EChart option={option as never} ariaLabel={t("weightShareByRegion")} height={280} />;
}

export function SegmentMixStack({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingCharts");
  const ct = useChartTheme();
  const segs = segmentsOf(matrix);
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, max: 100, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: segs.map((seg, i) => ({
      name: seg.label,
      type: "bar" as const,
      stack: "mix",
      data: [...matrix.regions].reverse().map((r) => r.mix[seg.code]),
      itemStyle: { color: ct.color[SEGMENT_COLORS[i]] },
      barMaxWidth: 22,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const }, valueFormatter: (v: unknown) => `${Number(v)}%` },
  };
  return <EChart option={option} ariaLabel={t("marketCompositionBySegment")} height={280} />;
}

export function RegionTable({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingCharts"); const tc = useTranslations("common");
  const segs = segmentsOf(matrix);
  return (
    <table className="data-table mt-3" aria-label={t("regionSegmentAllocationTable")}>
      <caption className="sr-only">{t("regionSegmentAllocationAnd2026")}</caption>
      <thead>
        <tr>
          <th scope="col">{tc("region")}</th><th scope="col">{tc("weight")}</th>
          {segs.map((seg) => <th key={seg.code} scope="col">{seg.label}</th>)}
          <th scope="col">2026 ($B)</th><th scope="col">{t("keyAdjustments")}</th>
        </tr>
      </thead>
      <tbody>
        {matrix.regions.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            <td className="tabular-nums">{r.weight}%</td>
            {segs.map((seg) => <td key={seg.code} className="tabular-nums">{r.mix[seg.code] ?? 0}%</td>)}
            <td className="tabular-nums">{regionTotal(matrix, r.code, 0).toFixed(3)}</td>
            <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{r.adjustment}</td>
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">{t("global")}</td>
          <td className="tabular-nums">100%</td>
          {(() => {
            const g = global2026(matrix);
            return (
              <>
                {segs.map((seg) => (
                  <td key={seg.code} className="tabular-nums">{Math.round(((g[seg.code] ?? 0) / g.total) * 1000) / 10}%</td>
                ))}
                <td className="tabular-nums font-semibold">{g.total.toFixed(2)} {t("anchor")}{fmtBillions(matrix.anchor.total)})</td>
              </>
            );
          })()}
          <td />
        </tr>
      </tbody>
    </table>
  );
}

export function CagrGroupedBar({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingCharts");
  const ct = useChartTheme();
  const segs = segmentsOf(matrix);
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: unknown) => `${(Number(v) * 100).toFixed(0)}%`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: segs.map((seg, i) => ({
      name: seg.label,
      type: "bar" as const,
      data: [...matrix.regions].reverse().map((r) => matrix.cagrBase[r.code]?.[seg.code] ?? 0),
      itemStyle: { color: ct.color[SEGMENT_COLORS[i]], borderRadius: [0, 3, 3, 0] },
      barMaxWidth: 12,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const }, valueFormatter: (v: unknown) => `${(Number(v) * 100).toFixed(1)}%` },
  };
  return <EChart option={option} ariaLabel={t("cagrComparisonBySegment")} height={280} />;
}

export function ProjectionChart({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingCharts");
  const ct = useChartTheme();
  const proj = projection2030(matrix);
  const totals2026 = matrix.regions.map((r) => r3(regionTotal(matrix, r.code, 0)));
  const totals2030 = matrix.regions.map((r) => {
    const m = proj[r.code];
    return r3(segmentsOf(matrix).reduce((sum, seg) => sum + (m[seg.code] ?? 0), 0));
  });
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: [
      { name: "2026", type: "bar" as const, data: [...totals2026].reverse(), itemStyle: { color: ct.color[0], opacity: 0.55, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 12 },
      { name: t("n2030Base"), type: "bar" as const, data: [...totals2030].reverse(), itemStyle: { color: ct.color[3], borderRadius: [0, 3, 3, 0] }, barMaxWidth: 12 },
    ],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} ariaLabel={t("marketSizeOutlookByYear")} height={280} />;
}

export function ScenarioBandChart({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingCharts");
  const ct = useChartTheme();
  const rows = matrix.regions.flatMap((r) => segmentsOf(matrix).map((seg) => {
    const b = bandFor(matrix, r.code, seg.code);
    const isOverride = !!matrix.bandOverrides?.[`${r.code}|${seg.code}`];
    return { label: `${r.label} · ${seg.label}`, down: b.down, up: b.up, isOverride };
  }));
  const option = {
    grid: { left: 150, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: unknown) => `${(Number(v) * 100).toFixed(0)}%`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: rows.map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 9.5 } },
    series: [
      { type: "bar" as const, stack: "band", data: rows.map((r) => r.down), itemStyle: { color: "transparent" }, barMaxWidth: 12, silent: true, tooltip: { show: false } },
      {
        type: "bar" as const,
        stack: "band",
        data: rows.map((r) => ({
          value: Math.round((r.up - r.down) * 10000) / 10000,
          itemStyle: { color: r.isOverride ? ct.color[3] : ct.color[1], opacity: r.isOverride ? 1 : 0.65, borderRadius: 3 },
        })),
        barMaxWidth: 12,
        tooltip: { show: true },
      },
    ],
    tooltip: {
      trigger: "item" as const,
      formatter: (p: unknown) => {
        const r = rows[(p as { dataIndex: number }).dataIndex];
        return t("p1P2ToOptimisticP3", { p1: r.label, p2: (r.down * 100).toFixed(1), p3: (r.up * 100).toFixed(1), p4: r.isOverride ? t("sourceMismatchWide") : "" });
      },
    },
  };
  return <EChart option={option} ariaLabel={t("growthRateBandByScenario")} height={Math.max(280, rows.length * 17 + 48)} />;
}