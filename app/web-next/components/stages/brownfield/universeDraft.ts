// S6 evaluation-target direction — the editable draft state and its pure helpers
// (design 2026-11-17-s6-universe-direction-review §5.4, §7.2). Editing a conclusion
// field marks that group's origin `person`; refs, evidence, support line and flags
// stay as drafted (read-only). `definition` is always recomposed from the direction.
import labels from "../../../lib/universe-direction-labels.json";
import type {
  DirectionDrafted,
  DirectionOrigin,
  DirItem,
  EvidenceView,
  OppDetail,
  StoredDirection,
  UniverseDirectionView,
} from "./types.ts";

export interface UniverseDraft {
  definition: string;
  min_long_list: string;
  /** null = legacy record (no direction) — the plain definition textarea is shown. */
  direction: StoredDirection | null;
  evidence: EvidenceView[];
  origin: DirectionOrigin;
  drafted: DirectionDrafted | null;
}

export type DirTextKey = "headline" | "industry" | "region" | "size" | "value_chain";
export type DirListKey = "prioritise" | "exclude";

export const MAX_ITEMS = 3;
/** Same caps the server re-applies on save (lib/universe-direction.ts CAPS). */
export const TEXT_CAPS = { headline: 90, industry: 120, region: 120, size: 120, value_chain: 100, type: 60, why: 80 };

export function emptyUniverseDraft(): UniverseDraft {
  return {
    definition: "",
    min_long_list: "5",
    direction: null,
    evidence: [],
    origin: {},
    drafted: null,
  };
}

const items = (list: DirItem[]): string =>
  list
    .filter((i) => i.type.trim())
    .map((i, n) => `${n + 1}) ${i.type.trim()}${i.why.trim() ? ` — ${i.why.trim()}` : ""}`)
    .join("; ");

/** The labelled direction text stored as `definition` (downstream readers keep working unchanged). */
export function composeDefinition(d: StoredDirection): string {
  const line = (label: string, text: string) => (text.trim() ? `${label}: ${text.trim()}` : "");
  return [
    line(labels.headline, d.headline.text),
    line(labels.industry, d.scope.industry.text),
    line(labels.region, d.scope.region.text),
    line(labels.size, d.scope.size.text),
    line(labels.value_chain, d.value_chain.text),
    line(labels.prioritise, items(d.prioritise)),
    line(labels.exclude, items(d.exclude)),
  ]
    .filter(Boolean)
    .join("\n");
}

type Universe = NonNullable<OppDetail["universe"]>;

export function draftFromSaved(u: Universe | null | undefined): UniverseDraft {
  const hasDirection = u?.direction_version === 1 && !!u.direction;
  return {
    definition: u?.definition ?? "",
    min_long_list: String(u?.min_long_list ?? 5),
    direction: hasDirection ? (u?.direction ?? null) : null,
    evidence: hasDirection ? (u?.evidence ?? []) : [],
    origin: hasDirection ? (u?.origin ?? {}) : {},
    drafted: hasDirection ? (u?.drafted ?? null) : null,
  };
}

/** Applying a draft fills the editable fields only; criteria and the minimum count stay as the person set them. */
export function draftFromView(
  view: UniverseDirectionView,
  promptVersion: string | undefined,
  prev: UniverseDraft,
): UniverseDraft {
  const direction: StoredDirection = {
    direction_version: 1,
    headline: view.headline,
    scope: view.scope,
    value_chain: view.value_chain,
    prioritise: view.prioritise,
    exclude: view.exclude,
    basis: view.basis,
    support: view.support,
    grade: view.grade,
  };
  const o = view.origin;
  return {
    ...prev,
    definition: composeDefinition(direction),
    direction,
    evidence: view.evidence,
    origin: { headline: o, scope: o, value_chain: o, prioritise: o, exclude: o },
    drafted: { prompt_version: promptVersion ?? "", generated_at: new Date().toISOString() },
  };
}

function withDirection(draft: UniverseDraft, next: StoredDirection, group: keyof DirectionOrigin): UniverseDraft {
  return {
    ...draft,
    direction: next,
    origin: { ...draft.origin, [group]: "person" },
    definition: composeDefinition(next),
  };
}

export function editText(draft: UniverseDraft, key: DirTextKey, text: string): UniverseDraft {
  const d = draft.direction;
  if (!d) return draft;
  if (key === "headline") return withDirection(draft, { ...d, headline: { ...d.headline, text } }, "headline");
  if (key === "value_chain")
    return withDirection(draft, { ...d, value_chain: { ...d.value_chain, text } }, "value_chain");
  return withDirection(draft, { ...d, scope: { ...d.scope, [key]: { ...d.scope[key], text } } }, "scope");
}

function withList(draft: UniverseDraft, list: DirListKey, next: DirItem[]): UniverseDraft {
  const d = draft.direction;
  return d ? withDirection(draft, { ...d, [list]: next }, list) : draft;
}

export function editItem(
  draft: UniverseDraft,
  list: DirListKey,
  index: number,
  patch: Partial<Pick<DirItem, "type" | "why">>,
): UniverseDraft {
  const cur = draft.direction?.[list];
  return cur
    ? withList(
        draft,
        list,
        cur.map((it, i) => (i === index ? { ...it, ...patch } : it)),
      )
    : draft;
}

export function addItem(draft: UniverseDraft, list: DirListKey): UniverseDraft {
  const cur = draft.direction?.[list];
  if (!cur || cur.length >= MAX_ITEMS) return draft;
  return withList(draft, list, [...cur, { type: "", why: "", refs: [], unverified: false }]);
}

export function removeItem(draft: UniverseDraft, list: DirListKey, index: number): UniverseDraft {
  const cur = draft.direction?.[list];
  return cur
    ? withList(
        draft,
        list,
        cur.filter((_, i) => i !== index),
      )
    : draft;
}

/** PUT body. Legacy drafts (no direction) send no direction keys, so the server preserves what is stored. */
export function savePayload(draft: UniverseDraft): Record<string, unknown> {
  return {
    definition: draft.definition.trim(),
    // The criteria input is gone from this screen; the server preserves the stored value when omitted.
    min_long_list: Number(draft.min_long_list) || 5,
    ...(draft.direction
      ? {
          direction: draft.direction,
          evidence: draft.evidence,
          origin: draft.origin,
          ...(draft.drafted ? { drafted: draft.drafted } : {}),
        }
      : {}),
  };
}
