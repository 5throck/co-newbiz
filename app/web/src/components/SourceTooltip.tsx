import { useId, useState, type ReactNode } from "react";
import { provenanceOf, type ProvenanceMeta } from "../api.ts";

// Source tooltip — ui-spec.md §1 / FR-SYS-03: every numeric figure carries
// its provenance (assumption_key, as_of, source, anchor_ref, run_id) read
// from the API response — envelope `meta` via provenanceOf() first, merged
// with per-row provenance columns the payload carries where the caller
// supplies them — never hand-typed. Fields the response does not carry are
// omitted entirely; with no provenance at all the figure renders bare
// instead of wearing an empty tooltip. Interaction follows GlossaryTerm's
// pattern (button + aria-expanded/aria-describedby + Escape), extended with
// hover/focus open and a click-pin for touch.

const FIELD_LABELS: { key: keyof ProvenanceMeta; label: string }[] = [
  { key: "assumption_key", label: "가정 키" },
  { key: "as_of", label: "제공 시점" },
  { key: "source", label: "출처" },
  { key: "anchor_ref", label: "근거 참조" },
  { key: "run_id", label: "분석 실행 ID" },
  { key: "assessed_at", label: "평가 시점" },
];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ko-KR");
}

export function SourceTooltip({
  provenance,
  children,
}: {
  provenance: ProvenanceMeta | Record<string, unknown> | undefined;
  children: ReactNode;
}) {
  const picked = provenanceOf(provenance);
  const fields = FIELD_LABELS.filter(({ key }) => typeof picked[key] === "string");
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  if (fields.length === 0) return <>{children}</>;
  const shown = open || pinned;

  return (
    <span className="source-figure-wrap">
      <button
        type="button"
        className="source-figure"
        aria-label="수치 출처 보기"
        aria-describedby={shown ? popoverId : undefined}
        aria-expanded={shown}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setPinned((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setPinned(false);
            setOpen(false);
          }
        }}
      >
        {children}
      </button>
      {shown && (
        <span role="tooltip" id={popoverId} className="source-popover">
          <strong className="source-popover-title">출처 정보</strong>
          <dl>
            {fields.map(({ key, label }) => (
              <div key={key} className="source-field">
                <dt>{label}</dt>
                <dd>{key === "as_of" || key === "assessed_at" ? formatDateTime(picked[key]!) : picked[key]}</dd>
              </div>
            ))}
          </dl>
        </span>
      )}
    </span>
  );
}
