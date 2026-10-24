"use client";

// Goal attainment per scenario (ADR-0159): one row per applicable goal, one
// column per case, each cell icon + text (never colour alone). Reference
// evidence only — a miss does not block, re-rank or recommend anything.
// All Korean strings are INTERIM-WORDING.

import { formatDirectionSymbol, formatTargetValue } from "../../lib/business-targets-format.ts";
import { SOURCE_VIEW, attainmentView, summarizeAttainment, type CaseAttainmentEntry } from "../../lib/business-goals-view.ts";
import { useTranslations } from "next-intl";

export function AttainmentStatus({ status }: { status: CaseAttainmentEntry["status"] | null }) {
  const v = attainmentView(status);
  return (
    <span className={`status-chip ${v.cls} whitespace-nowrap`}>
      <span aria-hidden="true">{v.icon}</span> {v.label}
    </span>
  );
}

export function GoalAttainmentTable({
  cases,
  attainment,
  goalCount,
}: {
  cases: Array<{ id: string; header: string }>;
  attainment: Record<string, CaseAttainmentEntry[]> | undefined;
  goalCount: number;
}) {const t = useTranslations("stages.s8.goalAttainment"); const tc = useTranslations("common");
  if (goalCount === 0) {
    return (
      <section className="mt-4" aria-label={tc("scenarioAttainment")}>
        <h3 className="sizing-step-title text-[length:var(--fs-body)]">{tc("scenarioAttainment")}</h3> {/* INTERIM-WORDING */}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="note">
          <AttainmentStatus status={null} /> {t("onceATargetIsAdded")} {/* INTERIM-WORDING */}
        </p>
      </section>
    );
  }
  if (cases.length === 0) return null;
  // Rows come from the first case that has entries (every case is evaluated against the same goals).
  const rowsSource = cases.map((c) => attainment?.[c.id]).find((e) => e && e.length > 0) ?? [];
  if (rowsSource.length === 0) return null;
  return (
    <section className="mt-4" aria-label={tc("scenarioAttainment")}>
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">{tc("scenarioAttainment")}</h3> {/* INTERIM-WORDING */}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
        {t("referenceEvidenceTheJudgementIs")} {/* INTERIM-WORDING */}
        <span data-testid="attainment-legend"> {(["met", "missed", "indeterminate", "manual"] as const).map((k) => `${attainmentView(k).icon} ${attainmentView(k).label}`).join(" · ")}</span>
      </p>
      <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table" aria-label={t("goalAttainment")}>
          <thead>
            <tr>
              <th scope="col">{tc("target")}</th>
              {cases.map((c) => <th key={c.id} scope="col">{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rowsSource.map((row) => {
              const key = `${row.metric_key}\u0000${row.label}`;
              const src = SOURCE_VIEW[row.source];
              return (
                <tr key={key}>
                  <th scope="row">
                    {row.label}{" "}
                    <span className="section-meta">
                      <span aria-hidden="true">{formatDirectionSymbol(row.direction)}</span> {formatTargetValue(row.target_value, row.unit)} · <span aria-hidden="true">{src.icon}</span> {src.label}
                    </span>
                  </th>
                  {cases.map((c) => {
                    const e = attainment?.[c.id]?.find((x) => `${x.metric_key}\u0000${x.label}` === key);
                    return (
                      <td key={c.id}>
                        <AttainmentStatus status={e?.status ?? null} />
                        {e && e.status !== "manual" && e.actual != null && <span className="section-meta" style={{ display: "block" }}>{formatTargetValue(e.actual, e.unit)}</span>}
                        {e && e.status === "indeterminate" && <span className="section-meta" style={{ display: "block" }}>{e.actual_basis}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="section-meta mt-1">
        {cases.map((c) => {
          const sum = summarizeAttainment(attainment?.[c.id]);
          return t("p1MetP2MissedP3", { p1: c.header, p2: sum.met, p3: sum.missed, p4: sum.indeterminate, p5: sum.manual });
        }).join("  |  ")}
      </p>
    </section>
  );
}
