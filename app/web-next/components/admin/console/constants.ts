// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import dynamic from "next/dynamic";
import type { Section } from "./types.ts";

export const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

// Admin console — ui-spec §5. All ten sections are served by backend
// endpoints and render real data; master-data is managed by the dedicated
// MasterDataSection component (code tables + staging queue resolution).
export const SECTION_TITLE: Record<Section, string> = {
  users: "사용자·토큰 관리",
  audit: "로그 관리",
  "data-sources": "데이터 소스 관리",
  schedule: "배치·스케줄 관리",
  database: "데이터베이스 관리",
  notifications: "알림 관리",
  glossary: "용어집 관리",
  governance: "거버넌스 문서",
  "master-data": "마스터 데이터",
  adr: "ADR 인덱스",
};