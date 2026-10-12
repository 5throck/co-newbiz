// Wave F predicate cut-over date (shared by process-flow.ts and dd-checklist-tailor.ts
// without an import cycle). See process-flow.ts for the grandfathering rule.
export const WAVE_F_PREDICATE_DATE = "2026-10-08";

// ADR-0160 greenfield sub-track selection cut-over (same grandfathering rule as
// WAVE_F_PREDICATE_DATE): projects whose earliest project_policy_pin predates
// it keep the greenfield-dd 1.0.0 selection unless a human opts them in.
export const GF_SUBTRACK_PREDICATE_DATE = "2026-10-12";

// ADR-0160 addendum (b) S9 workspace scope cut-over (overlay
// checklists/_overlays/greenfield-workspace-scope.yaml). Separate from
// GF_SUBTRACK_PREDICATE_DATE so projects that opted into the site scoping are
// not silently moved. PLACEHOLDER: set to the merge date at merge.
export const GF_WORKSPACE_SCOPE_DATE = "2026-10-12";

// ADR-0162 brownfield S9 workspace scope cut-over (overlay
// checklists/_overlays/brownfield-workspace-scope.yaml). Separate from
// GF_WORKSPACE_SCOPE_DATE and WAVE_F_PREDICATE_DATE; same grandfathering rule
// (earliest policy pin or created_at before it keeps the current view until a
// person opts in). PLACEHOLDER: set to the merge date at merge.
export const BF_WORKSPACE_SCOPE_DATE = "2026-10-12";
