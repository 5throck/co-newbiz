#!/usr/bin/env bun
// @version 0.1.0
import { Database } from "bun:sqlite";
import { ulid } from "../db/lib/ulid.ts";
import { runSizingPipeline } from "../app/web-next/lib/market-sizing-pipeline.ts";
import { runSynergyPipeline } from "../app/web-next/lib/synergy-pipeline.ts";

const db = new Database("db/data/co-newbiz.sqlite");
const now = new Date().toISOString();

// 1) 휴머노이드 로봇 S1 분석
let ind = db.query("SELECT id FROM md_industry WHERE name_ko = '휴머노이드 로봇'").get() as { id: string } | null;
if (!ind) {
  const id = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [id, "NEW-HR", "휴머노이드 로봇", "Humanoid Robot", now]);
  ind = { id };
}
let sizing = db.query("SELECT id FROM market_sizing_analysis WHERE industry_id = ? AND status = 'in_progress'").get(ind.id) as { id: string } | null;
if (!sizing) {
  sizing = { id: ulid() };
  db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, current_step, methodology_version, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [sizing.id, ind.id, "in_progress", 0, "1.1.0", "analyst", now]);
}
console.log("S1 pipeline start:", ind.id);
await runSizingPipeline(db, sizing.id);
console.log("S1 done");

// 2) 레인보우로보틱스 회사 등록 + 삼성전자 S3 재분석
let rb = db.query("SELECT id FROM md_company WHERE name_ko = '레인보우로보틱스'").get() as { id: string } | null;
if (!rb) {
  const id = ulid();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [id, "레인보우로보틱스", now]);
  rb = { id };
}
let syn = db.query("SELECT id FROM synergy_analysis WHERE company_id = ? AND status = 'in_progress'").get(rb.id) as { id: string } | null;
if (!syn) {
  syn = { id: ulid() };
  db.run("INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [syn.id, rb.id, "in_progress", 0, "analyst", now]);
}
console.log("S3 pipeline start (레인보우로보틱스)");
await runSynergyPipeline(db, syn.id);
console.log("S3 done");
