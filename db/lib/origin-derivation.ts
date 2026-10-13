/**
 * Wave F-8 (audit B4, ADR-0047 §A.5): default project.origin from the Brownfield
 * route sub_track. JV -> joint, CVC -> internal (both trigger the establishment
 * record), M&A / strategic -> external, minority -> hybrid. Brownfield partnership /
 * R&BD stay null. ADR-0166 (human decision, chat 2026-10-14): every Green Field
 * project defaults to joint regardless of sub_track; internal stays selectable
 * through the explicit origin. A supplied origin wins.
 */
export function deriveOriginFromSubTrack(
  track: "greenfield" | "brownfield" | null,
  subTrack: string | null,
): "internal" | "external" | "hybrid" | "joint" | null {
  if (track === "greenfield") return "joint";
  if (track !== "brownfield" || !subTrack) return null;
  switch (subTrack) {
    case "jv": return "joint";
    case "corporate_venture":
    case "intra_venture": return "internal";
    case "m_and_a":
    case "strategic_investment": return "external";
    case "minority_investment": return "hybrid";
    default: return null;
  }
}
