/**
 * Wave F-8 (audit B4, ADR-0047 §A.5): default project.origin from the Brownfield
 * route sub_track. JV -> joint, CVC -> internal (both trigger the establishment
 * record), M&A / strategic -> external, minority -> hybrid. Partnership / R&BD /
 * Greenfield have no unambiguous mapping and stay null. A supplied origin wins.
 */
export function deriveOriginFromSubTrack(
  track: "greenfield" | "brownfield" | null,
  subTrack: string | null,
): "internal" | "external" | "hybrid" | "joint" | null {
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
