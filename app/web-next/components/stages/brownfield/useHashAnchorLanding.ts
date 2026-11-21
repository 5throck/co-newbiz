"use client";

// Hash-anchor landing for the S6/S7 body (design 2026-11-21-s67-completion-visibility Amendment 4).
// The Pre-FS panel and the Universe section render only after async data, i.e. after the browser's native
// hash scroll already ran against a missing element — and content above them keeps growing as the rest of
// the page loads. Once the target appears, scroll it into view (the elements carry their own scroll-margin),
// move focus onto it once, then re-align on each layout mutation until the page has been quiet for SETTLE_MS
// or the user scrolls/clicks/types. Runs once per mount; no-op without a matching hash. Cross-route links
// (`s6#...` from S7) are full mounts, so mount-time reading is sufficient.
import { useEffect } from "react";
import { SECTION_IDS } from "./constants.ts";

export const LANDING_ANCHORS = ["gate-decision-pre_fs", SECTION_IDS.universe, "s6-criteria"] as const;
const GIVE_UP_MS = 15000;
const SETTLE_MS = 1200;
const USER_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

export function useHashAnchorLanding(): void {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id || !(LANDING_ANCHORS as readonly string[]).includes(id)) return;
    let focused = false;
    let settleTimer: number | undefined;
    const stop = () => {
      observer.disconnect();
      window.clearTimeout(settleTimer);
      window.clearTimeout(giveUpTimer);
      for (const ev of USER_EVENTS) window.removeEventListener(ev, stop);
    };
    const align = () => {
      const el = document.getElementById(id);
      if (!el) return;
      // Instant jump, like the native hash scroll it replaces — no animation, so prefers-reduced-motion is honored by construction.
      el.scrollIntoView({ behavior: "auto", block: "start" });
      if (!focused) {
        el.focus({ preventScroll: true });
        focused = true;
      }
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(stop, SETTLE_MS);
    };
    const observer = new MutationObserver(align);
    const giveUpTimer = window.setTimeout(stop, GIVE_UP_MS);
    observer.observe(document.body, { childList: true, subtree: true });
    for (const ev of USER_EVENTS) window.addEventListener(ev, stop, { passive: true });
    align();
    return stop;
  }, []);
}
