"use client";

// StageTabs (Wave U-1, design §3.4/§9) — layer-3-free replacement for the
// ~30-link StageTabs. Shows only the tabs of the stage that owns the
// current page (max 5) plus a "More" overflow menu. Links keep real URLs, so
// deep links and the browser history work unchanged. Keyboard: roving
// tabindex, Left/Right/Home/End across tabs; "More" is a menu button
// (aria-haspopup, Esc closes and returns focus).
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  activeSubtabIndex,
  activeTabIndex,
  groupForSegment,
  groupForTrack,
  projectSegment,
  stageTabGroupsFor,
  tabHref,
  type StageTabGroup,
} from "../lib/stage-tabs.ts";
import { StageRail } from "./StageFrame.tsx";
import { PrimarySlot } from "./ui.tsx";
import { api } from "../lib/api.ts";
import { S8LensStrip } from "./stages/S8LensStrip.tsx";
import { S8PartHeader } from "./stages/S8PartHeader.tsx";

// Track per project, cached for the session: only S8 needs it (greenfield hides the target tab).
const trackCache = new Map<string, string | null>();

function useProjectTrack(projectId: string, enabled: boolean): string | null {
  const [track, setTrack] = useState<string | null>(trackCache.get(projectId) ?? null);
  useEffect(() => {
    if (!enabled || trackCache.has(projectId)) { if (enabled) setTrack(trackCache.get(projectId) ?? null); return; }
    let live = true;
    api.get<{ track: string | null }>(`/api/projects/${encodeURIComponent(projectId)}/process`)
      .then((r) => { trackCache.set(projectId, r.data.track ?? null); if (live) setTrack(r.data.track ?? null); })
      .catch(() => { /* unknown track: keep every tab */ });
    return () => { live = false; };
  }, [projectId, enabled]);
  return track;
}

// ADR-0161: PMI applies only to brownfield M&A / JV / strategic investment. Cached per project;
// null = not known yet (or the lookup failed): keep every tab, as with an unknown track.
const pmiCache = new Map<string, boolean>();

function useProjectPmiApplies(projectId: string, enabled: boolean): boolean | null {
  const [applies, setApplies] = useState<boolean | null>(pmiCache.get(projectId) ?? null);
  useEffect(() => {
    if (!enabled) return;
    if (pmiCache.has(projectId)) { setApplies(pmiCache.get(projectId) ?? null); return; }
    let live = true;
    api.get<{ applicability: { pmi_applies: boolean } }>(`/api/projects/${encodeURIComponent(projectId)}/post-management`)
      .then((r) => { pmiCache.set(projectId, r.data.applicability.pmi_applies); if (live) setApplies(r.data.applicability.pmi_applies); })
      .catch(() => { /* unknown applicability: keep every tab */ });
    return () => { live = false; };
  }, [projectId, enabled]);
  return applies;
}

// Source opportunity of a project (S1-S4 live on the opportunity, not on /projects/{id}). Cached per project.
const sourceOppCache = new Map<string, string | null>();

function useSourceOpportunity(projectId: string): string | null {
  const [oppId, setOppId] = useState<string | null>(sourceOppCache.get(projectId) ?? null);
  useEffect(() => {
    if (sourceOppCache.has(projectId)) { setOppId(sourceOppCache.get(projectId) ?? null); return; }
    let live = true;
    api.get<{ opportunity: { id: string } | null }>(`/api/projects/${encodeURIComponent(projectId)}/process`)
      .then((r) => { const id = r.data.opportunity?.id ?? null; sourceOppCache.set(projectId, id); if (live) setOppId(id); })
      .catch(() => { /* no link when the source cannot be resolved */ });
    return () => { live = false; };
  }, [projectId]);
  return oppId;
}

function StageTabsInner({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const tabParam = useSearchParams().get("tab");
  const seg = projectSegment(pathname);
  const baseGroup: StageTabGroup | null = seg === null ? null : groupForSegment(seg);
  const track = useProjectTrack(projectId, baseGroup?.stage === "S8");
  const pmiApplies = useProjectPmiApplies(projectId, baseGroup?.stage === "S12");
  // The PMI tab is removed from the DOM when PMI does not apply; PMI-applicable projects get the same group object.
  const pmiGroup: StageTabGroup | null = baseGroup && pmiApplies === false
    ? (stageTabGroupsFor({ pmiApplies: false }).find((g) => g.stage === baseGroup.stage) ?? baseGroup)
    : baseGroup;
  const group: StageTabGroup | null = pmiGroup ? groupForTrack(pmiGroup, track) : null;
  const sourceOppId = useSourceOpportunity(projectId);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMoreOpen(false); }, [pathname, tabParam]);

  if (!group || seg === null) return null;
  const activeIdx = activeTabIndex(group, seg, tabParam);
  const primaryCount = group.tabs.length;
  const subIdx = activeSubtabIndex(group, seg, tabParam);
  const subtabs = group.subtabs ?? [];
  const moreActive = activeIdx >= primaryCount;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-tab-item]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next >= 0) { e.preventDefault(); items[next].focus(); }
  }

  return (
    <>
    {/* Layer 2 for every project page — StageFrame skips its own rail under /projects/ so it is never doubled. */}
    <StageRail current={[group.stage]} />
    <div className="stage-tabs-bar">
    <nav aria-label={`${group.stage} 화면`} className="stage-tabs-wrap">
      <div className="stage-tabs" ref={listRef} onKeyDown={onKeyDown}>
        <div className="stage-tabs-list" role="tablist" aria-label={`${group.stage} · ${group.name}`}>
        {group.tabs.map((t, i) => {
          const active = i === activeIdx;
          return (
            <Link
              key={`${t.seg}|${t.query ?? ""}`}
              href={tabHref(projectId, t)}
              role="tab"
              data-tab-item
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              tabIndex={active || (activeIdx < 0 && i === 0) || (moreActive && i === 0) ? 0 : -1}
              className={`stage-tab${active ? " stage-tab-active" : ""}`}
            >
              {t.label}
            </Link>
          );
        })}
        </div>
        {group.more.length > 0 && (
          <span className="stage-tab-more" role="presentation">
            <button
              ref={moreBtn}
              type="button"
              data-tab-item
              className={`stage-tab${moreActive ? " stage-tab-active" : ""}`}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              tabIndex={-1}
              onClick={() => setMoreOpen((v) => !v)}
              onKeyDown={(e) => { if (e.key === "Escape") { setMoreOpen(false); } }}
            >
              더보기 <span aria-hidden="true">▾</span>
            </button>
            {moreOpen && (
              <div
                role="menu"
                aria-label={`${group.stage} 더보기`}
                className="stage-tab-menu"
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setMoreOpen(false); moreBtn.current?.focus(); }
                }}
              >
                {group.more.map((t, j) => {
                  const active = primaryCount + j === activeIdx;
                  return (
                    <Link
                      key={`${t.seg}|${t.query ?? ""}`}
                      href={tabHref(projectId, t)}
                      role="menuitem"
                      aria-current={active ? "page" : undefined}
                      className={`stage-tab-menu-item${active ? " stage-tab-active" : ""}`}
                    >
                      {t.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </span>
        )}
      </div>
    </nav>
    {/* The screen's Primary Action (design §5) sits at the top right, beside the stage tabs. */}
    <PrimarySlot />
    </div>
    {subIdx >= 0 && (
      <nav aria-label="재무적 타당성 하위 화면" className="stage-tabs-wrap">
        <div className="stage-tabs-list" role="tablist" aria-label="재무적 타당성 · 하위 탭">
          {subtabs.map((t, i) => (
            <Link
              key={`${t.seg}|${t.query ?? ""}`}
              href={tabHref(projectId, t)}
              role="tab"
              aria-selected={i === subIdx}
              aria-current={i === subIdx ? "page" : undefined}
              className={`stage-tab${i === subIdx ? " stage-tab-active" : ""}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
    )}
    {group.stage === "S8" && <S8LensStrip projectId={projectId} />}
    {group.stage === "S8" && (seg === "/wacc" || seg === "/financial-analysis") && <S8PartHeader part="financial" />}
    {sourceOppId && (
      <p className="mb-2 text-[length:var(--fs-caption)]">
        <Link href={`/deals/${encodeURIComponent(sourceOppId)}/s4`} className="text-[color:var(--accent)] font-bold">원본 기회 보기</Link>
        <span className="text-[color:var(--muted-fg)]"> — S1~S4(시장분석·기회·시너지·진출방식) 화면으로 이동합니다.</span>
      </p>
    )}
    </>
  );
}

export function StageTabs({ projectId }: { projectId: string }) {
  return (
    <Suspense fallback={null}>
      <StageTabsInner projectId={projectId} />
    </Suspense>
  );
}
