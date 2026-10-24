"use client";

// /inbox — pending-decisions inbox (Wave U-1, design §4). A READ MODEL over
// existing APIs: it creates no decision authority. The single Primary Action
// of the detail pane routes to the existing human-only control (confirm page,
// gate panel, S12 closure host). LLM-drafted lines are labelled proposals.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageState, FilterChip, PrimaryAction } from "../../components/ui.tsx";
import { InboxList } from "../../components/InboxList.tsx";
import { ReviewBuckets } from "../../components/ReviewBuckets.tsx";
import { useInbox } from "../../lib/use-inbox.ts";
import { KIND_LABEL_KEY, SEVERITY_LABEL, type InboxItem, type InboxKind } from "../../lib/inbox.ts";

const SNOOZE_KEY = "cn-inbox-snooze";
const ALL_KINDS = Object.keys(KIND_LABEL_KEY) as InboxKind[];
const REVIEW_GATES = new Set(["screening", "pre_fs", "fs", "dd", "entity_ic", "group_ic"]);

function readSnooze(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

// Primary-action label per kind — key map resolved at render (label maps stay out of JSX).
const PRIMARY_LABEL_KEY: Partial<Record<InboxKind, string>> = {
  gate_proposal: "openProposal",
  decision_proposal: "openProposal",
  gate_hold: "openGate",
  closure_precondition: "openClosure",
};

export default function InboxPage() {
  const t = useTranslations();
  const ti = useTranslations("pages.inbox");
  const tc = useTranslations("common");
  const { result, loading } = useInbox();
  // Empty set = "전체" (no kind filter). A chip is filled only when it is an active filter.
  const [kinds, setKinds] = useState<Set<InboxKind>>(new Set());
  const [deal, setDeal] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const detailHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { setSnoozed(readSnooze()); }, []);

  // Single-column layout (<= 880px): the detail pane is a pushed view, so the list view needs its own primary. (design-token-exempt: prose)
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 880px)"); // design-token-exempt: breakpoint (matchMedia cannot resolve CSS custom properties)
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const items = useMemo(
    () => (result?.items ?? []).filter((i) => (kinds.size === 0 || kinds.has(i.kind)) && (!deal || i.dealId === deal) && !((snoozed[i.id] ?? 0) > Date.now())),
    [result, kinds, deal, snoozed],
  );
  const deals = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of result?.items ?? []) if (i.dealId) m.set(i.dealId, i.dealName);
    return [...m.entries()];
  }, [result]);
  const selected: InboxItem | null = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const showReview = !!(selected?.entityType && selected.dealId && selected.gate && REVIEW_GATES.has(selected.gate));
  const primaryLink = selected ? <Link href={selected.href} className="btn-primary">{ti(PRIMARY_LABEL_KEY[selected.kind] ?? "openTarget")}</Link> : null;

  function select(id: string) {
    setSelectedId(id);
    setMobileDetail(true);
    window.setTimeout(() => detailHeading.current?.focus(), 0);
  }
  function toggleKind(k: InboxKind) {
    setKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }
  function snooze(id: string) {
    const next = { ...snoozed, [id]: Date.now() + 86_400_000 };
    setSnoozed(next);
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    setMobileDetail(false);
  }

  return (
    <main className="inbox-page">
      <div className="page-header-row">
        <h1>{ti("heading")}</h1>
        {narrow && !mobileDetail && items.length > 0 && (
          <span className="ml-auto">
            <PrimaryAction readOnly inline label={ti("openFirstItem")} onClick={() => select(items[0].id)} />
          </span>
        )}
      </div>
      <p className="inbox-lead">
        {ti("lead")}
      </p>

      {result && result.failed.length > 0 && (
        <div role="alert">
          <ul className="inbox-failed">
            {result.failed.map((f) => (
              <li key={f.source}>{ti("failedItem", { source: f.source, message: f.message })}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="inbox-filters" role="group" aria-label={ti("filtersAria")}>
        <FilterChip selected={kinds.size === 0} onClick={() => setKinds(new Set())}>{tc("all")}</FilterChip>
        {ALL_KINDS.map((k) => (
          <FilterChip key={k} selected={kinds.has(k)} onClick={() => toggleKind(k)}>{t(KIND_LABEL_KEY[k])}</FilterChip>
        ))}
        <label className="inbox-deal-filter">
          <span>{ti("reviewDeal")}</span>
          <select className="form-input" value={deal} onChange={(e) => setDeal(e.target.value)}>
            <option value="">{tc("all")}</option>
            {deals.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <PageState state="loading" />
      ) : items.length === 0 ? (
        <p className="inbox-empty" role="status">{ti("empty")}</p>
      ) : (
        <div className="inbox-layout" data-detail={mobileDetail ? "open" : "closed"}>
          <div className="inbox-list-pane">
            <InboxList items={items} selectedId={selected?.id ?? null} onSelect={select} />
          </div>
          {selected && (
            <aside className="inbox-detail" aria-label={ti("detailAria")}>
              <button type="button" className="btn-ghost btn-sm inbox-back" onClick={() => setMobileDetail(false)}>
                <ArrowLeft size={14} aria-hidden="true" /> {tc("backToList")}
              </button>
              <h2 tabIndex={-1} ref={detailHeading}>{selected.title}</h2>
              <dl className="inbox-facts">
                <div><dt>{ti("dtKind")}</dt><dd>{t(KIND_LABEL_KEY[selected.kind])}</dd></div>
                <div><dt>{ti("reviewDeal")}</dt><dd>{selected.dealName}{selected.stage ? ` · ${selected.stage}` : ""}</dd></div>
                <div><dt>{ti("dtAge")}</dt><dd>{ti("ageDaysValue", { days: selected.ageDays })}</dd></div>
                <div><dt>{ti("dtSeverity")}</dt><dd>{SEVERITY_LABEL[selected.severity]}</dd></div>
              </dl>
              {selected.aiDraft && (
                <p className="inbox-ai-draft">
                  <strong>{ti("aiDraftLabel")}</strong> {ti("aiDraftNote")} {selected.aiDraft}
                </p>
              )}
              {showReview ? (
                // The reviewer sees the three counts beside the single primary link, buckets expanded below.
                <ReviewBuckets
                  entityType={selected.entityType!}
                  entityId={selected.dealId!}
                  gates={[selected.gate!]}
                  variant="expanded"
                  headerSlot={primaryLink}
                />
              ) : (
                <div className="inbox-actions">{primaryLink}</div>
              )}
              <div className="inbox-actions">
                {selected.entityType === "project" && selected.dealId && (
                  <Link href={`/projects/${encodeURIComponent(selected.dealId)}/process`} className="btn-ghost">{ti("openInStage")}</Link>
                )}
                <button type="button" className="btn-ghost" onClick={() => snooze(selected.id)}>{ti("snoozeDay")}</button>
              </div>
            </aside>
          )}
        </div>
      )}
    </main>
  );
}
