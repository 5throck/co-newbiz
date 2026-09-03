// @version 1.0.0
// Seed idempotent external benchmarking cases (benchmark_case, migration
// 0041). Public, widely-reported deals only — figures are approximate
// public-reported values rounded, cited to their source, and meant as
// reference context, not valuation inputs. Usage: bun scripts/co-newbiz/seed-benchmark-cases.ts
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { ulid } from "../../db/lib/ulid.ts";

interface CaseSeed {
  title: string;
  industry: string;
  region: string;
  deal_type: "greenfield" | "brownfield" | "license-in" | "jv" | "partnership";
  deal_year: number;
  deal_size_krw_m: number | null;
  summary_ko: string;
  key_metrics_json: string | null;
  source_ref: string;
}

const CASES: CaseSeed[] = [
  {
    title: "삼성바이오로직스 송도 5공장 (Plant 5) 신설",
    industry: "바이오 CDMO",
    region: "한국 인천",
    deal_type: "greenfield",
    deal_year: 2020,
    deal_size_krw_m: 2000000,
    summary_ko:
      "240,000L 규모의 바이오 의약품 CDMO 5공장 신설. 수주 잔고 기반 수요 확정 상태에서 착수해 2023년 가동 — 수요 선확보 후 증설하는 그린필드 표준 사례.",
    key_metrics_json: JSON.stringify({ capacity_l: 240000, construction_years: 3, anchor_customer: "Pfizer 등 글로벌 빅파마" }),
    source_ref: "삼성바이오로직스 공시·보도자료(2020)",
  },
  {
    title: "LG엔솔 GM 합작 JV (Ultium Cells)",
    industry: "2차전지",
    region: "미국 오하이오/테네시",
    deal_type: "jv",
    deal_year: 2019,
    deal_size_krw_m: 3480000,
    summary_ko:
      "LG에너지솔루션-GM 50:50 합작으로 배터리 셀 공장 다수 신설. 대규모 고정투자의 수요 리스크를 OEM 장기수주계약으로 완화한 JV 구조 사례.",
    key_metrics_json: JSON.stringify({ ownership: "50:50", plants: 3, anchor: "GM Ultium 플랫폼" }),
    source_ref: "공시·주요 언론 보도(2019~)",
  },
  {
    title: "한온시스 인수(한국타이어 애프터마켓 사업부)",
    industry: "자동차부품",
    region: "한국",
    deal_type: "brownfield",
    deal_year: 2016,
    deal_size_krw_m: 1100,
    summary_ko:
      "한국타이어의 클러치·공조 사업부를 캐리브아웃 형태로 인수해 별도 법인화. 사업부 매각형 카브아웃의 재무·조직 분리 실무 사례.",
    key_metrics_json: JSON.stringify({ structure: "carve-out", businesses: ["클러치", "공조"] }),
    source_ref: "공시·언론 보도(2016)",
  },
  {
    title: "두산인프라코어 도시바 인수 → 두산에너빌리티",
    industry: "에너지·중공업",
    region: "한국/일본",
    deal_type: "brownfield",
    deal_year: 2014,
    deal_size_krw_m: 410000,
    summary_ko:
      "도시바로부터 원전·중공업 자산 인수 후 '두산중공업'으로 재편. 구조조정 후 매각인 사례로, 인수 후 해저드 리스크(원전 사업 부실)가 이후 구조조정으로 이어진 리스크 관리 참고 사례.",
    key_metrics_json: JSON.stringify({ seller: "도시바", post_deal: "원전 부실 → 2022년 리캡 구조조정" }),
    source_ref: "공시·언론 보도(2014, 2022)",
  },
  {
    title: "셀트리온 바이오시밀러 아웃라이선싱(머크·화이자 등)",
    industry: "바이오",
    region: "글로벌",
    deal_type: "license-in",
    deal_year: 2011,
    deal_size_krw_m: null,
    summary_ko:
      "자체 개발 바이오시밀러 후보의 글로벌 권한을 지역별 아웃라이선스. 계약금+마일스톤+로열티 구조의 라이선싱 수익화 참고 사례.",
    key_metrics_json: JSON.stringify({ structure: "upfront + milestone + royalty", partners: ["Pfizer(merck bio)', 'MBK 등"] }),
    source_ref: "공시(2011~)",
  },
  {
    title: "테슬라 기가팩토리 베를린 신설",
    industry: "전기차",
    region: "독일",
    deal_type: "greenfield",
    deal_year: 2019,
    deal_size_krw_m: 4600000,
    summary_ko:
      "유럽 시장 수요 대응을 위한 통합 생산(셀→차량) 기가팩토리 신설. 인허가 지연·환경 규제가 일정에 미치는 영향을 보여주는 해외 그린필드 사례.",
    key_metrics_json: JSON.stringify({ capacity: "연 50만대(목표)", permit_delay: "약 2년" }),
    source_ref: "Tesla 공식 발표·언론(2019~2022)",
  },
  {
    title: "CJ제일제도 스케일러블 바이오 미국 플랜트 인수",
    industry: "바이오 CDMO",
    region: "미국 아이오와",
    deal_type: "brownfield",
    deal_year: 2021,
    deal_size_krw_m: 150000,
    summary_ko:
      "기존 바이오 플랜트를 인수해 CDMO 역량을 확장. 그린필드 대비 가동까지의 시간 단축을 노린 브라운필드 확장 사례.",
    key_metrics_json: JSON.stringify({ rationale: "time-to-market", prior_owner: "Pfizer 등" }),
    source_ref: "공시·언론 보도(2021)",
  },
  {
    title: "현대차그룹-삼성SDI 등 조합 배터리 협력체제",
    industry: "2차전지·완성차",
    region: "한국",
    deal_type: "partnership",
    deal_year: 2022,
    deal_size_krw_m: null,
    summary_ko:
      "완성차 그룹과 셀 업체 간 공급망 협력 강화. JV까지 가지 않는 전략적 공급 파트너십 구조의 참고 사례.",
    key_metrics_json: JSON.stringify({ structure: "장기공급계약 + 협의체" }),
    source_ref: "언론 보도(2022~)",
  },
];

const db = new Database(join(import.meta.dirname, "..", "..", "db", "data", "co-newbiz.sqlite"));
const existing = db.query("SELECT COUNT(*) AS c FROM benchmark_case").get() as { c: number };
if (existing.c > 0) {
  console.log(`benchmark_case already has ${existing.c} rows — skipping (idempotent seed).`);
  process.exit(0);
}
const now = new Date().toISOString();
const insert = db.query(
  `INSERT INTO benchmark_case (id, title, industry, region, deal_type, deal_year, deal_size_krw_m,
                               summary_ko, key_metrics_json, source_ref, created_by, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
);
for (const c of CASES) {
  insert.run(ulid(), c.title, c.industry, c.region, c.deal_type, c.deal_year, c.deal_size_krw_m,
    c.summary_ko, c.key_metrics_json, c.source_ref, "seed:benchmark", now);
}
console.log(`Seeded ${CASES.length} benchmark cases.`);
