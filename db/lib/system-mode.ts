// 시스템 모드 (ADR-0133) — production|development 전역 스위치.
// production: 딜 데이터(프로젝트·검토/안건) DELETE 차단 — 실수로 인한 데이터
// 유실을 막는다. development: 테스트 데이터 정리를 위해 계속 허용한다.
// 행이 없으면(마이그레이션 미적용 등) 안전 우선으로 production 취급한다.
import type { Database } from "bun:sqlite";

export type SystemMode = "production" | "development";

export function getSystemMode(db: Database): SystemMode {
  const row = db.query("SELECT value FROM system_setting WHERE key = 'system_mode'").get() as { value: string } | null;
  return row?.value === "development" ? "development" : "production";
}

export function setSystemMode(db: Database, mode: SystemMode, actor: string, now: string): void {
  db.run(
    `INSERT INTO system_setting (key, value, updated_by, updated_at) VALUES ('system_mode', ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [mode, actor, now],
  );
}
