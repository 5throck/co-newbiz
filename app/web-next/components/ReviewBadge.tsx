import { reviewBadge, type ReviewFields } from "../lib/checklist-review-status.ts";

/** Per-item review status badge (informational; never gates). Tone + text, not color alone. */
export function ReviewBadgeChip({ item }: { item: ReviewFields }) {
  const b = reviewBadge(item);
  return (
    <span className={`status-chip ${b.cls} ml-1`} title={b.title} aria-label={`검토 상태: ${b.label}. ${b.title}`}>
      {b.status === "draft-AI" ? "△" : "✓"} {b.label}
    </span>
  );
}
