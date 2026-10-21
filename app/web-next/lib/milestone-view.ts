// Client-safe milestone view types & constants (2026-10-21). The server side
// lives in lib/milestones.ts (imports bun:sqlite via db/client — never import
// that from a client component; Turbopack fails on node:fs in the browser
// bundle). Split out so pages can type against the API payload.
export const MILESTONE_CATEGORIES = ["permit", "certification", "capex", "contract", "custom"] as const;
export type MilestoneCategory = (typeof MILESTONE_CATEGORIES)[number];
export const DUE_SOON_DAYS = 7;
export type MilestoneStatus = "done" | "overdue" | "due_soon" | "planned";

export interface MilestoneView {
  id: string;
  project_id: string;
  title: string;
  category: MilestoneCategory;
  due_date: string;
  owner: string | null;
  source: "manual" | "execution_baseline";
  done_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  status: MilestoneStatus;
  days_to_due: number | null;
}
