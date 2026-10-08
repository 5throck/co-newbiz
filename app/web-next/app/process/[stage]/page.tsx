import { redirect } from "next/navigation";

// R2-A item 8 (docs/designs/2026-10-09-ux-r2-design.md §3.6): the per-stage
// feature-card hub had no inbound link and duplicated the stage stepper plus the
// deal stage tabs. It now redirects to the deal board with a visible notice
// (AppShell shows it from `?moved=process`) — never a silent redirect.
export default function ProcessHubRedirect() {
  redirect("/deals?moved=process");
}
