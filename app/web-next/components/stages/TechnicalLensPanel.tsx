"use client";

// S8 `기술적 타당성` (ADR-0169): the six items as TABS (2026-10-20 decider rounds 4-5c).
// T1 derives from the capability judgement (S9 capability-dd for brownfield) and shows the
// ADR-0168 panel; T2-T5 are DERIVED from the S9 DD structure as it is — each names the
// checklist items that constitute it (기술·인사·법무 실사 tabs), people judge those on their own
// tabs, and the roll-up is the lens value (no separate per-item verdict); T6 shows the S8↔S9
// S9 reflection progress and the shared evidence base. Warning only: nothing here caps a grade or
// blocks a gate.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { LENS_VIEW } from "../../lib/s8-lens-status.ts";
import type { S8LensSummary } from "../../lib/s8-lens-summary.ts";
import type { LensItemView } from "../../lib/technical-lens.ts";
import { ROLLUP_LABEL, TECHNICAL_EVIDENCE_BASE, constituentsOf, ddItemStatusView, indexDdItems, rollupConstituentStatuses, type DdItemLookup, type TechnicalItemKey } from "../../lib/technical-item-constituents.ts";
import { CapabilityAttainabilityPanel } from "./CapabilityAttainabilityPanel.tsx";
import { useTranslations } from "next-intl";

const S9_ITEM_KEYS = new Set<string>(["T2", "T3", "T4", "T5"]);
type DdDomainsPayload = { domains: Array<{ title: string; items: Array<{ id: string; text: string; state: { status: string } | null }> }> };

export function TechnicalLensPanel({ projectId }: { projectId: string }) {const t = useTranslations("stages.s8.technicalLens");
  const [data, setData] = useState<S8LensSummary | null>(null);
  const [ddIndex, setDdIndex] = useState<Map<string, DdItemLookup> | null>(null);
  const [tab, setTab] = useState("T1");
  useEffect(() => {
    let alive = true;
    api.get<S8LensSummary>(`/api/projects/${encodeURIComponent(projectId)}/s8-lens-summary`).then((r) => { if (alive) setData(r.data); }).catch(() => { /* the items list is additive */ });
    // The constituent S9 checks come from the live DD state — read-only here.
    api.get<DdDomainsPayload>(`/api/projects/${encodeURIComponent(projectId)}/dd`)
      .then((r) => { if (alive) setDdIndex(indexDdItems(r.data.domains ?? [])); })
      .catch(() => { if (alive) setDdIndex(new Map()); });
    return () => { alive = false; };
  }, [projectId]);
  const items = data?.technical.items ?? [];
  const active = items.find((i) => i.key === tab) ?? items[0];
  const s9Href = `/projects/${encodeURIComponent(projectId)}/dd`;
  return (
    <section className="market-section sizing-step mb-3" aria-label={t("technicalFeasibilityItems")}>
      <h3 className="sizing-step-title">{t("technicalFeasibilityItems2")} <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("n6Items")}</span></h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {t("aPersonJudgesItemsIn")}
      </p>
      {items.length === 0 ? (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("loading")}</p>
      ) : (
        <>
          <div role="tablist" aria-label={t("technicalFeasibilityItemsTab")} className="flex flex-wrap gap-1 mb-2" data-testid="tech-item-tabs">
            {items.map((it) => {
              const v = LENS_VIEW[it.status];
              const selected = active?.key === it.key;
              return (
                <button key={it.key} type="button" role="tab" id={`tech-tab-${it.key}`} aria-selected={selected} aria-controls={`tech-item-${it.key}`}
                  className={selected ? "btn-primary btn-sm" : "btn-ghost btn-sm"} onClick={() => setTab(it.key)}>
                  <span className="font-bold">{it.key}</span> {it.label} <span className={`status-chip ${v.cls}`}><span aria-hidden="true">{v.icon}</span> {v.label}</span>
                </button>
              );
            })}
          </div>
          {active && (
            <div role="tabpanel" id={`tech-item-${active.key}`} aria-labelledby={`tech-tab-${active.key}`} data-testid="tech-item-panel">
              {active.key === "T1" && (
                // the capability panel carries its own coverage line — no second copy here
                <div id="capability-attainability"><CapabilityAttainabilityPanel projectId={projectId} /></div>
              )}
              {S9_ITEM_KEYS.has(active.key) && <TechItemVerdictView item={active} s9Href={s9Href} ddIndex={ddIndex} />}
              {active.key === "T6" && <PairingView items={items} note={active.note} mismatchCount={data?.technical.mismatchCount ?? 0} s9Href={s9Href} ddIndex={ddIndex} />}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** One S9 checklist item row: live state chip + text + owning DD tab. */
function ConstituentRow({ c }: { c: DdItemLookup | { id: string; missing: true } }) {const t = useTranslations("stages.s8.technicalLens");
  if ("missing" in c) {
    return <li className="text-[color:var(--muted-fg)]"><span className="font-mono text-[length:var(--fs-caption)] mr-1">{c.id}</span>{t("thisItemIsNotIn")}</li>;
  }
  const v = ddItemStatusView(c.status);
  return (
    <li>
      <span className={`status-chip ${v.cls} mr-1`}><span aria-hidden="true">{v.icon}</span> {v.label}</span>
      <span className="font-mono text-[length:var(--fs-caption)] mr-1">{c.id}</span>{c.text}
      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> — {c.domainTitle}</span>
    </li>
  );
}

/** T2-T5: the roll-up of the S9 checklist items that constitute the item, grouped by the S9 tab
 *  that judges them (round 5c: S8 mirrors the S9 DD structure as it is — nothing is judged here). */
function TechItemVerdictView({ item, s9Href, ddIndex }: { item: LensItemView; s9Href: string; ddIndex: Map<string, DdItemLookup> | null }) {const t = useTranslations("stages.s8.technicalLens");
  const v = LENS_VIEW[item.status];
  const rows = ddIndex ? constituentsOf(item.key as TechnicalItemKey, ddIndex) : [];
  // ADR-0160 addendum b: a constituent the workspace scope excludes (N/X) is not rendered
  // by its S9 tab and takes no judgement — the mirror here treats it as absent, never
  // pending (2026-10-22 live-use report: greenfield T3 hung on hdd-03).
  const present = rows.filter((r): r is DdItemLookup => !("missing" in r) && r.judgeable !== false);
  const missing = rows.filter((r) => "missing" in r);
  const rollup = present.length > 0 ? rollupConstituentStatuses(present.map((r) => r.status)) : null;
  const groups = new Map<string, DdItemLookup[]>();
  for (const r of present) groups.set(r.domainTitle, [...(groups.get(r.domainTitle) ?? []), r]);
  return (
    <div className="grid gap-2" data-testid={`tech-item-verdict-${item.key}`}>
      <p className="text-[length:var(--fs-body)] m-0">
        <span className={`status-chip ${v.cls} mr-1`}><span aria-hidden="true">{v.icon}</span> {v.label}</span>
        {item.judged ? item.note : <span className="text-[color:var(--muted-fg)]">{item.note}</span>}
      </p>
      <div>
        <h4 className="text-[length:var(--fs-body)] font-semibold mb-1">
          {t("constituentsJudgementStatusByS9")}
          {rollup && <span className="ml-2 text-[length:var(--fs-caption)] font-normal text-[color:var(--muted-fg)]" data-testid={`tech-item-rollup-${item.key}`}>{t("item")} {ROLLUP_LABEL[rollup.status]} ({rollup.judged}/{rollup.total} {t("judgement")}</span>}
        </h4>
        {ddIndex === null ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("loadingTheS9")}</p>
        ) : (
          <div className="grid gap-2" data-testid={`tech-item-constituents-${item.key}`}>
            {[...groups.entries()].map(([domainTitle, list]) => (
              <section key={domainTitle} aria-label={t("p1Items", { p1: domainTitle })} data-testid={`tech-item-group-${item.key}`}>
                <p className="m-0 mb-1 text-[length:var(--fs-caption)] font-semibold">{domainTitle} <span className="font-normal text-[color:var(--muted-fg)]">({list.filter((r) => r.status === "pass" || r.status === "fail" || r.status === "na").length}/{list.length} {t("judgement2")}</span></p>
                <ul className="sizing-note-list">{list.map((c) => <ConstituentRow key={c.id} c={c} />)}</ul>
              </section>
            ))}
            {missing.length > 0 && (
              <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("constituentItemsNotInThis")} {missing.map((m) => m.id).join(" · ")}</p>
            )}
          </div>
        )}
      </div>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">
        {t("itemJudgementsHappenAsChecklist")}{" "}
        <a href={s9Href} className="text-[color:var(--accent)] font-bold">{t("s9DueDiligence")}</a>
      </p>
    </div>
  );
}

/** T6: how far each S8 item is backed by S9 judgements, plus the shared evidence prerequisites. */
function PairingView({ items, note, mismatchCount, s9Href, ddIndex }: { items: LensItemView[]; note: string; mismatchCount: number; s9Href: string; ddIndex: Map<string, DdItemLookup> | null }) {const t = useTranslations("stages.s8.technicalLens");
  const basis = (it: LensItemView) =>
    it.key === "T1" ? t("fromTheRequiredCapabilityJudgement") : it.judged ? t("s9ChecklistComplete") : t("s9ChecklistJudgementInProgress");
  const evidence = ddIndex ? TECHNICAL_EVIDENCE_BASE.map((id) => ddIndex.get(id) ?? { id, missing: true as const }) : [];
  return (
    <div className="grid gap-2" data-testid="tech-item-pairing">
      <p className="text-[length:var(--fs-body)] m-0">{note}</p>
      <ul className="sizing-note-list" aria-label={t("s9ReflectionEvidence")}>
        {items.filter((it) => it.key !== "T6").map((it) => (
          <li key={it.key}>
            <span className="font-bold mr-1">{it.key}</span>{it.label} — <span className={it.judged ? "" : "text-[color:var(--muted-fg)]"}>{basis(it)}</span>
          </li>
        ))}
      </ul>
      <div>
        <h4 className="text-[length:var(--fs-body)] font-semibold mb-1">{t("commonEvidenceItemsThePremise")}</h4>
        {ddIndex === null
          ? <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("loadingTheS92")}</p>
          : <ul className="sizing-note-list" aria-label={t("commonEvidenceItems")} data-testid="tech-item-evidence-base">{evidence.map((c) => <ConstituentRow key={c.id} c={c} />)}</ul>}
      </div>
      {mismatchCount > 0 && <p className="status-chip status-amber inline-block" role="note">{t("differsFromDd")} {mismatchCount}{t("itemSTheRecordedVerification")}</p>}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">
        {t("theS9DdReflectionFills")} <a href={s9Href} className="text-[color:var(--accent)] font-bold">{t("s9DueDiligence2")}</a>
      </p>
    </div>
  );
}
