// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import dynamic from "next/dynamic";
import type { Section } from "./types.ts";

export const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

// Admin console — ui-spec §5. All ten sections are served by backend
// endpoints and render real data; master-data is managed by the dedicated
// MasterDataSection component (code tables + staging queue resolution).
//
// i18n: the h1 titles resolve through admin.section.* catalog keys at render
// time (AdminConsole.tsx) — this map only pins the key per section.
export const SECTION_TITLE_KEY: Record<Section, string> = {
  users: "admin.section.users",
  audit: "admin.section.audit",
  "data-sources": "admin.section.dataSources",
  schedule: "admin.section.schedule",
  database: "admin.section.database",
  notifications: "admin.section.notifications",
  glossary: "admin.section.glossary",
  governance: "admin.section.governance",
  "master-data": "admin.section.masterData",
  adr: "admin.section.adr",
};

// One-line purpose under each h1 (admin.pageIntro.*), same pattern as the dashboard and gate-integrity pages.
export const SECTION_INTRO_KEY: Record<Section, string> = {
  users: "admin.pageIntro.users",
  audit: "admin.pageIntro.audit",
  "data-sources": "admin.pageIntro.dataSources",
  schedule: "admin.pageIntro.schedule",
  database: "admin.pageIntro.database",
  notifications: "admin.pageIntro.notifications",
  glossary: "admin.pageIntro.glossary",
  governance: "admin.pageIntro.governance",
  "master-data": "admin.pageIntro.masterData",
  adr: "admin.pageIntro.adr",
};
