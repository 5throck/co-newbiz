"use client";

// Honest placeholder for analysis views that depend on the valuation/model
// engine, which does not exist yet. Renders an explicit "arrives with the
// engine" note — never fabricated data or a silent empty state.
export function EnginePendingPanel({
  title,
  note,
}: {
  title: string;
  note: string;
}) {
  return (
    <section aria-label={title} className="mt-6">
      <h4 className="font-semibold mb-2">{title}</h4>
      <div className="glass p-4 text-sm text-[color:var(--muted-fg)] border border-dashed border-[color:var(--border)]">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 mr-2">
          엔진 의존
        </span>
        {note}
      </div>
    </section>
  );
}
