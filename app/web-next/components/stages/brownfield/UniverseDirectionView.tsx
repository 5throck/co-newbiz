"use client";

// Conclusion-first read-only view of the S6 evaluation-target direction
// (design 2026-11-17-s6-universe-direction-review §7.1). Shared by the card and the
// modal preview. Refs, basis, market-support line, evidence and the confidence chip
// are read-only; the server holds no Korean, so support segments and evidence kinds
// are localized here by key/kind. Proposal-only: no PASS / verified wording.
import { useTranslations } from "next-intl";
import type {
  DirectionCounts,
  DirectionDrafted,
  DirectionOrigin,
  DirField,
  DirItem,
  EvidenceView,
  StoredDirection,
  SupportSegment,
} from "./types.ts";

const WRAP = "whitespace-pre-wrap [overflow-wrap:anywhere]";
const MUTED = "text-[color:var(--muted-fg)]";
const GROWTH_KINDS = ["external_forecast", "topdown_cagr", "trend_cagr"];

type Tr = ReturnType<typeof useTranslations>;

function Cites({ refs }: { refs: string[] }) {
  return (
    <>
      {refs.map((r) => (
        <code key={r} className="dd-item-id ml-1">
          [{r}]
        </code>
      ))}
    </>
  );
}

function Unverified({ show, t }: { show: boolean; t: Tr }) {
  if (!show) return null;
  return (
    <span className="status-chip status-amber ml-1">
      <span aria-hidden="true">⚠ </span>
      {t("needsVerification")}
    </span>
  );
}

function Text({ f, t }: { f: DirField; t: Tr }) {
  if (!f.text) return <span className={MUTED}>{t("notProposed")}</span>;
  return (
    <>
      {f.text}
      <Cites refs={f.refs} />
      <Unverified show={f.unverified} t={t} />
    </>
  );
}

function ItemList({ list, t }: { list: DirItem[]; t: Tr }) {
  if (list.length === 0) return <span className={MUTED}>{t("notProposed")}</span>;
  return (
    <ol className="m-0 list-none p-0">
      {list.map((it, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a positional list of at most 3 proposal lines with no stable id
        <li key={i} className={WRAP}>
          {i + 1}) {it.type}
          {it.why ? ` — ${it.why}` : ""}
          <Cites refs={it.refs} />
          <Unverified show={it.unverified} t={t} />
        </li>
      ))}
    </ol>
  );
}

function supportText(s: SupportSegment, t: Tr): string {
  if (s.key === "size") return `${t("supportSize")} ${s.value}`;
  if (s.key === "growth") {
    if (s.kind === "unrecorded" || !s.value) return t("growthUnrecorded");
    const kind = GROWTH_KINDS.includes(s.kind) ? ` (${t(`growthKind.${s.kind}`)})` : "";
    return `${t("supportGrowth")} ${s.value}${kind}`;
  }
  return s.kind === "unverified" || !s.value ? t("profitUnverified") : `${t("supportProfit")} ${s.value}`;
}

const EVIDENCE_KINDS = new Set([
  "s1_identity",
  "s1_anchor",
  "s1_trend_cagr",
  "s1_topdown_cagr",
  "s1_external_forecast",
  "s1_projection",
  "s1_competitive",
  "s1_chain",
  "s1_region_mix",
  "s1_segments",
  "s1_opportunity_factor",
  "s1_risk_factor",
  "stage_financial",
  "stage_financial_gap",
  "s3_capability",
]);

function Evidence({ e, t }: { e: EvidenceView; t: Tr }) {
  const kind = EVIDENCE_KINDS.has(e.kind) ? t(`evidenceKind.${e.kind}`) : e.kind;
  return (
    <li className={WRAP}>
      <code className="dd-item-id">[{e.id}]</code> {kind} · {e.ref} · {e.fact}
      {e.grade ? ` · ${t("confidence", { grade: e.grade })}` : ""}
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[6rem_1fr]">
      <dt className={`text-[length:var(--fs-caption)] ${MUTED}`}>{label}</dt>
      <dd className={`m-0 ${WRAP}`}>{children}</dd>
    </div>
  );
}

export interface DirectionViewProps {
  direction: StoredDirection;
  evidence: EvidenceView[];
  origin?: DirectionOrigin | null;
  drafted?: DirectionDrafted | null;
  minLongList?: number;
  /** Modal preview only: proposal notice and the emptied/dropped/clamped counts. */
  preview?: { counts?: DirectionCounts | null };
}

export function UniverseDirectionView({
  direction: d,
  evidence,
  origin,
  drafted,
  minLongList,
  preview,
}: DirectionViewProps) {
  const t = useTranslations("stages.s67.directionCard");
  const origins = [...new Set(Object.values(origin ?? {}))];
  const originLine = origins.map((o) => t(`origin.${o}`)).join(" · ");
  const date = drafted?.generated_at?.slice(0, 10);
  const counts = preview?.counts;
  return (
    <div>
      {preview && <p className="mb-2 text-[length:var(--fs-caption)]">{t("proposalNotice")}</p>}
      <dl className="m-0 grid gap-2">
        <Row label={t("conclusion")}>
          <Text f={d.headline} t={t} />
          {d.grade && (
            <span className="status-chip status-not-started ml-1">{t("confidence", { grade: d.grade })}</span>
          )}
        </Row>
        <Row label={t("scope")}>
          <ul className="m-0 list-none p-0">
            {(["industry", "region", "size"] as const).map((k) => (
              <li key={k} className={WRAP}>
                <span className={MUTED}>{t(k)}</span> <Text f={d.scope[k]} t={t} />
              </li>
            ))}
          </ul>
        </Row>
        <Row label={t("valueChain")}>
          <Text f={d.value_chain} t={t} />
        </Row>
        <Row label={t("prioritise")}>
          <ItemList list={d.prioritise} t={t} />
        </Row>
        <Row label={t("exclude")}>
          <ItemList list={d.exclude} t={t} />
        </Row>
        <Row label={t("marketSupport")}>
          {d.support.segments.length === 0 ? (
            <span className={MUTED}>{t("notProposed")}</span>
          ) : (
            d.support.segments.map((s, i) => (
              <span key={s.key}>
                {i > 0 ? " · " : ""}
                {supportText(s, t)}
                {s.ref && <Cites refs={[s.ref]} />}
              </span>
            ))
          )}
        </Row>
        {minLongList !== undefined && <Row label={t("minCandidates")}>{minLongList}</Row>}
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer text-[length:var(--fs-caption)]">
          {t("viewBasis")} · {t("evidenceCount", { n: evidence.length })}
        </summary>
        <p className={`mt-1 mb-1 text-[length:var(--fs-caption)] ${WRAP}`}>
          <span className={MUTED}>{t("basisLine")}</span> <Text f={d.basis} t={t} />
        </p>
        <ul className="m-0 list-none p-0 text-[length:var(--fs-caption)]">
          {evidence.map((e) => (
            <Evidence key={e.id} e={e} t={t} />
          ))}
        </ul>
      </details>
      {counts && (
        <p className={`mt-2 mb-0 text-[length:var(--fs-caption)] ${MUTED}`}>
          {t("counts", { emptied: counts.emptied_fields, dropped: counts.dropped_refs, clamped: counts.clamped })}
        </p>
      )}
      {!preview && originLine && (
        <p className={`mt-2 mb-0 text-[length:var(--fs-caption)] ${MUTED}`}>
          {originLine}
          {date ? ` ${date}` : ""} · {t("savedByPerson")}
        </p>
      )}
    </div>
  );
}
