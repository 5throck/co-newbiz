# 리서치 노트 — 대시보드·업무용 화면 패턴 분류 표준 관행

> 🌐 외부 참고 자료. 조사일: 2026-09-05. 표준 화면 패턴 P0~P5 분류의 업계 관행 비교용.

## 표준 관행

1. **레이아웃 표준**: 좌측 고정 사이드바 + 상단 검색/사용자/액션 바 + 카드형 콘텐츠 영역 —
   메뉴가 5개에서 50개로 늘어나도 접이식 그룹으로 방향감을 유지. 내부 도구·CRUD 중심 관리자
   화면에 가장 적합
2. **대시보드 3분류(taxonomy)**: **operational**(실시간 일상 업무 추적), **analytical**(과거
   데이터 탐색·추세 발견), **strategic**(경영진용 고수준 KPI 요약) — 대시보드는 리포트(특정 시점의
   스냅샷 문서화)와 달리 지속 모니터링과 즉각 행동을 위해 설계된다는 점이 구분 기준
3. **의사결정 지원 설계 원칙**: 화면당 하나의 명확한 결론(verdict), 박스가 아닌 타이포그래피·
   여백으로 위계를 만들 것, 색은 상태 표현에만 예약, 점진적 정보 노출(progressive disclosure) —
   설계는 사용자가 실제로 내려야 하는 **결정**에서 출발해야 하고 레이아웃은 그 결정을 따라가야 한다
4. **레지스트리형 데이터 관리**: 관련 지표를 명확한 레이블로 그룹핑, 가장 중요한 3~5개 지표가
   먼저 읽히도록 시각적 위계 구성, 요약→상세로 drill-down, 탭형 하위 뷰로 복잡도를 관리
5. **학술적 분류축**: 데이터 추상화(원시/집계/파생), 시각 인코딩, 메타정보, 공간 배치, 상호작용,
   역할 기반 적응 — 구조 패턴 중 "drillboard"는 대시보드를 차트 leaf(atom)와 차트 그룹(internal
   node)의 계층으로 조직해 고수준 개요에서 상세로 동적으로 drill-down하게 한다

## co-newbiz 매핑

- P1 Registry(목록·레지스트리), P2 Report(리포트 열람), P3 Decision(판정·채점), P4 Execution
  (실행·체크리스트), P5 Monitoring(대시보드)은 업계의 operational/analytical/strategic 3분류+
  CRUD/리포트 패턴을 5개로 더 세분화한 것에 대응 — P5는 operational 대시보드, P2는 analytical
  리포트 계열에 가장 가깝다.
- "한 화면 한 목적"(design-philosophy 원칙 3)은 "화면당 하나의 명확한 결론" 원칙과 동일.
- P0 Shell(공통 골격: 헤더·사이드바·StageRail)은 업계 표준 레이아웃(고정 사이드바+상단바)과 구조가
  일치 — 새 화면 설계 시 이 표준 레이아웃 관행을 기준으로 이탈 여부를 점검할 수 있다.

## 출처

- Setproduct, "Dashboard UI design: From KPIs to layouts that convert" — https://www.setproduct.com/blog/dashboard-ui-design (접근일 2026-09-05)
- AdminLTE.IO, "Admin Dashboard Design: Principles, Layouts & Examples (2026)" — https://adminlte.io/blog/admin-dashboard-design/ (접근일 2026-09-05)
- Emergent Mind, "Dashboard Design Patterns" — https://www.emergentmind.com/topics/dashboard-design-patterns (접근일 2026-09-05)
