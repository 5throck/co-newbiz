-- @reversible: true (additive-only new table; manual rollback:
--  `DROP TABLE system_setting;`)
-- 시스템 모드 (ADR-0133) — production|development 전역 스위치. production에서는
-- 프로젝트·검토/안건(opportunity) DELETE(톰스톤)가 차단된다 — 실제 딜 데이터를
-- 실수로 지우는 사고를 막기 위함. development에서는 테스트 데이터 정리를 위해
-- 계속 허용한다. 관리자만 변경할 수 있다(app/web-next/app/api/admin/system-mode).
-- 안전 우선 기본값은 'production' — 이 로컬 개발 DB는 관리자 화면에서 명시적으로
-- 'development'로 전환해야 한다.
CREATE TABLE IF NOT EXISTS system_setting (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO system_setting (key, value, updated_by, updated_at)
VALUES ('system_mode', 'production', NULL, '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;
