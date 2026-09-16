-- @reversible: true (CREATE TABLE — rollback은 pre-migration backup 복원,
-- scripts/co-newbiz/restore.ts)
-- 후보(brownfield_target)의 근거 타임라인 — 등록·재분석·위원회 추천 검토 등
-- 시점에 수집·확정된 "참고 가능한 정보"를 이벤트로 적립한다(사용자 결정,
-- 2026-09-16: 수집 정보를 후보 상세에서 나중에 참고할 수 있게).
--   discovery    — 후보 발굴·등록 근거(마스터 제안/웹 제안 사유·출처)
--   analysis     — 회사 AI 프로파일 (재)분석 결과 요약(버전·출처 수·DART 연도)
--   screening    — 위원회 추천 검토의 항목별 판정 근거 저장 기록
-- 항목별 상세 근거(사유·출처)는 brownfield_target.screening_evidence_json
-- (0108)이 담고, 이 테이블은 언제 무엇이 수집되었는지의 타임라인을 담는다 —
-- 역할을 분리해 상세 화면에서 "근거 목록"과 "판정 근거"를 함께 보여준다.
CREATE TABLE brownfield_target_evidence (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES brownfield_target(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  source_url TEXT,
  source_kind TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_brownfield_target_evidence_target
  ON brownfield_target_evidence(target_id, created_at);
