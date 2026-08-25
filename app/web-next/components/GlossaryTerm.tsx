"use client";

import { useCallback, useId, useState } from "react";
import { api, type GlossaryTerm as GlossaryTermData } from "../lib/api.ts";

// Glossary tooltip — ui-spec.md §1/§3: dashed-underline term, click/hover
// popover, definition_ko + why_it_matters_ko (definition alone doesn't
// answer "so what" for a first-time reader). A <button> (not a <span>) so
// the popover is reachable and dismissible by keyboard.

export function GlossaryTerm({ term, children }: { term: string; children: React.ReactNode }) {
  const [data, setData] = useState<GlossaryTermData | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const popoverId = useId();

  const load = useCallback(async () => {
    if (data || loading) return;
    setLoading(true);
    try {
      const res = await api.get<GlossaryTermData>(`/api/glossary/${encodeURIComponent(term)}`);
      setData(res.data);
    } catch {
      /* term not registered — the click still opens, showing a fallback */
    } finally {
      setLoading(false);
    }
  }, [term, data, loading]);

  return (
    <span className="glossary-term-wrap">
      <button
        type="button"
        className="glossary-term"
        aria-describedby={open ? popoverId : undefined}
        aria-expanded={open}
        onMouseEnter={load}
        onFocus={load}
        onClick={() => {
          load();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {children}
      </button>
      {open && (
        <span role="tooltip" id={popoverId} className="glossary-popover">
          {data ? (
            <>
              <strong>
                {data.ko} ({data.en})
              </strong>
              <p>{data.definition_ko}</p>
              <p className="glossary-why">{data.why_it_matters_ko}</p>
            </>
          ) : (
            <span>등록되지 않은 용어입니다.</span>
          )}
        </span>
      )}
    </span>
  );
}
