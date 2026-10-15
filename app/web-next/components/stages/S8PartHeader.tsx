// Heading for one of the three major S8 parts (사업 목표 / 기술적 타당성 / 재무적 타당성)
// with a one-line purpose. Presentational; the wording lives in S8_PART_VIEW.
import { S8_PART_VIEW, type S8Part } from "../../lib/business-goals-view.ts";

export function S8PartHeader({ part }: { part: S8Part }) {
  const v = S8_PART_VIEW[part];
  return (
    <header className="mb-3" aria-label={`${v.title} 영역`}>
      <div className="section-toolbar"><span className="section-title"><h2>{v.title}</h2></span></div>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{v.purpose}</p>
    </header>
  );
}
