// View helpers for the legacy-record re-confirmation notice (ADR-0186 O-6). The server owns every state and decision.

export const RECONFIRM_ITEM_KEYS = ["wacc_confirmed", "ic_countersign", "na_review"] as const;
export type ReconfirmItemKey = (typeof RECONFIRM_ITEM_KEYS)[number];

export interface ReconfirmView {
  open: boolean;
  id?: string;
  reason?: string;
  created_by?: string;
  created_at?: string;
  items?: Array<{ key: ReconfirmItemKey; satisfied: boolean }>;
  unmet?: ReconfirmItemKey[];
  clearable?: boolean;
}

/** Where a person works on each item. */
export function reconfirmItemHref(projectId: string, key: ReconfirmItemKey): string {
  const id = encodeURIComponent(projectId);
  if (key === "wacc_confirmed") return `/projects/${id}/wacc`;
  if (key === "ic_countersign") return `/projects/${id}/ic-review`;
  return `/projects/${id}/dd`;
}

/** The `unmet` item keys carried by a 409 reconfirmation_required (error details or a warning notice). */
export function unmetFrom(details: unknown): ReconfirmItemKey[] {
  const u = (details as { unmet?: unknown } | null | undefined)?.unmet;
  if (!Array.isArray(u)) return [];
  return u.filter((k): k is ReconfirmItemKey => (RECONFIRM_ITEM_KEYS as readonly string[]).includes(String(k)));
}

/** Server message plus the localized unmet item names. */
export function reconfirmErrorText(message: string, details: unknown, label: (k: ReconfirmItemKey) => string): string {
  const names = unmetFrom(details).map(label);
  return names.length > 0 ? `${message} (${names.join(", ")})` : message;
}

/** Who may see the clear form: a business user who is not an administrator or a viewer (the server still decides). */
export function canTryClear(role: string | undefined): boolean {
  return role === "analyst";
}
