-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- ADR-0129 — 수요산업(demand industry) 큐레이션을 위한 proxy_link 확장.
-- ADR-0126의 'structural' hop_type은 이미 사람이 승인한 수요산업 엣지라는
-- 개념을 담고 있으므로 새 테이블을 만들지 않고 같은 테이블에 컬럼을 추가해
-- 일급 개체로 승격한다(ADR-0025의 proxy_link/value_chain_link 분리 경계는
-- 그대로 유지 — 이 컬럼들은 proxy_link 안에만 존재한다).
--
-- 리빌드 불필요: 0090은 hop_type 자체의 CHECK 값 목록을 바꿔야 했으므로
-- (기존 다중 컬럼 CHECK 절을 다시 써야 함) 테이블 리빌드가 필요했다. 이번
-- 변경은 그 CHECK를 전혀 건드리지 않고 전부 새 컬럼만 추가한다 — 각 새
-- CHECK는 자기 컬럼만 참조하고, DEFAULT가 상수이며 그 CHECK를 항상
-- 만족한다(NULL 허용 또는 DEFAULT 값이 IN 목록에 포함). SQLite는 이 조건을
-- 만족하는 ALTER TABLE ADD COLUMN ... CHECK (...)를 그대로 허용한다(bun:sqlite
-- 로 로컬 검증 완료) — 0090 스타일의 CREATE-new/copy/DROP/RENAME 리빌드는
-- 이 마이그레이션에서는 불필요하다.

ALTER TABLE proxy_link ADD COLUMN relation TEXT
  CHECK (relation IS NULL OR relation IN ('전방', '전전방', '후방', '후후방'));

ALTER TABLE proxy_link ADD COLUMN hop_distance INTEGER
  CHECK (hop_distance IS NULL OR hop_distance IN (1, 2));

ALTER TABLE proxy_link ADD COLUMN source TEXT NOT NULL DEFAULT 'llm_proposed'
  CHECK (source IN ('llm_proposed', 'user_added', 'approved'));

ALTER TABLE proxy_link ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'retired'));

ALTER TABLE proxy_link ADD COLUMN retired_at TEXT;
ALTER TABLE proxy_link ADD COLUMN retired_by TEXT;

-- Backfill (ADR-0129 §Decision 4): 기존 'structural' 행은 구 플로우에서
-- 이미 사람이 승인했던 링크이므로 source='approved'로 채운다.
-- relation/hop_distance는 방향 컬럼만으로 자동 추론하지 않는다(오분류
-- 위험 — ADR-0129 Alternatives #3에서 명시적으로 기각됨) — NULL로 남겨
-- 두고 사람이 별도 레거시 검토 큐에서 한 행씩 채운다.
UPDATE proxy_link SET source = 'approved' WHERE hop_type = 'structural';

-- 'engineering'/'statistical' 행은 calibrated_at이 채워져 있으면 이미
-- python/correlation.py 보정을 거쳐 값이 확정된 행이다(0004/0090 주석
-- 참조) — 이는 사람이 파이프라인을 실행해 승인한 것과 동등하므로
-- source='approved'로 백필한다. calibrated_at이 NULL인 행(아직 보정되지
-- 않음)은 DEFAULT 'llm_proposed'로 남긴다.
UPDATE proxy_link
SET source = 'approved'
WHERE hop_type IN ('engineering', 'statistical') AND calibrated_at IS NOT NULL;
