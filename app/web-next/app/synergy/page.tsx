"use client";

// /synergy — S3 flat route, now a redirect stub (route-cleanup follow-up design
// §4.2). The real S3 screen is the /deals/{id}/s3 tab (shared SynergyStage
// component). The S3 자회사 프로파일 화면(/our-company)은 별도 라우트로 유지된다.
import { CarrierGate } from "../../components/CarrierGate.tsx";

export default function SynergyPage() {
  return <CarrierGate route="synergy" />;
}
