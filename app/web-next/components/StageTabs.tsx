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
  activeTabIndex,
  groupForSegment,
  projectSegment,
  tabHref,
  type StageTabGroup,
} from "../lib/stage-tabs.ts";
import { StageRail } from "./StageFrame.tsx";
import { PrimarySlot } from "./ui.tsx";

function StageTabsInner({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const tabParam = useSearchParams().get("tab");
  const seg = projectSegment(pathname);
  const group: StageTabGroup | null = seg === null ? null : groupForSegment(seg);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMoreOpen(false); }, [pathname, tabParam]);

  if (!group || seg === null) return null;
  const activeIdx = activeTabIndex(group, seg, tabParam);
  const primaryCount = group.tabs.length;
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
