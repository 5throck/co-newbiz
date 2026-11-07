"use client";

// Long AI-written table cell: clamped to 4 lines with a per-cell "더 보기/접기" toggle. The toggle renders only
// when the text actually overflows. CSS clamping keeps the full text in the DOM, so screen readers read all of
// it; the button carries aria-expanded + aria-controls for the collapsed/expanded state.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export function ExpandableCell({ children }: { children: ReactNode }) {
  const t = useTranslations("stages.s3.synergyLinkageTab");
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  // Measure only while clamped (expanded height equals scroll height); re-measure on resize.
  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  return (
    <>
      <div ref={ref} id={id} className={`whitespace-pre-wrap break-words ${expanded ? "" : "cell-clamp-4"}`}>
        {children}
      </div>
      {(overflowing || expanded) && (
        <button
          type="button"
          className="btn-ghost btn-sm mt-1"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("showLess") : t("showMore")}
        </button>
      )}
    </>
  );
}
