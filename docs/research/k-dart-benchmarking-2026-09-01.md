---
lang: en
counterpart: k-dart-benchmarking-2026-09-01_ko.md
---

# Research: k-dart Skill Benchmarking and Enhancement Plan — 2026-09-01

**Scope**: `skills/k-dart/SKILL.md` v2.0.0 + `app/web-next/lib/dart-client.ts`·`corp-code-fallback.ts` implementation
**Benchmark sources**: dart-fss (Python), korean-dart-mcp (83 APIs → 15 tools), snaiws/DART-mcp-server, OpenDART official guides
**Purpose**: derive a k-dart enhancement roadmap by benchmarking similar open-source projects and MCP servers

---

## 1. Benchmark Targets Summary

| Target | Type | Strengths | Implications |
|---|---|---|---|
| **dart-fss** (Python, de facto standard library) | Library | corp list caching, disclosure·financial·XBRL extraction, bulk financial statement extraction | corp_code cache pre-loading pattern, XBRL parsing maturity |
| **korean-dart-mcp** (Node/TS, MIT) | MCP server | Compression of 83 APIs → 15 tools, SQLite FTS corp_code (116K companies, 24h TTL), 90-day auto chunking, concurrency limit of 5, **pre-aggregated analyst frames (signals·scores)**, HWP/PDF→markdown, ZIP slip/bomb defense | LLM-native design — returns decision-ready signals rather than raw data |
| **snaiws/DART-mcp-server** | MCP server | Restructures data into AI-analysis-friendly form | Providing data ≠ providing analysis |
| **OpenDART official constraints** | — | 1,000 requests/minute·20,000/day; corpCode.xml assumed to be downloaded once and self-cached thereafter | Caching + backoff is the correct approach, not a workaround |

## 2. Current k-dart vs Benchmarks — Gap Analysis

| Area | Current | Benchmark level | Gap |
|---|---|---|---|
| corp_code resolution | corpCode.xml.zip (blocked) + web fallback + company.json reverse lookup | SQLite FTS pre-loaded with 116K companies + 24h TTL | **Largest gap** — name→code resolution is not stable |
| Financial statements | fnlttSinglAcntAll 6 accounts × 3 years (2026-09 bug fix complete) | Full BS/IS/CFS + multi-year bulk + XBRL hierarchy | No item expansion·validation (summation check) |
| Disclosure search | Fragment-level list.json | 22 presets + 90-day chunking + parallel paging | No disclosure body·amendment history tracking |
| Attachments | None | HWP/HWPX/PDF/DOCX→markdown | Not integrated with the project's hwp-document-processing skill |
| Analysis frames | None (raw data only) | Insider signals·accounting risk 0-100·quality checklists | "Decision-ready data" needed by S3/S8 not provided |
| Rate limiting·security | Timeout only | Concurrency cap·backoff·ZIP bomb defense·TTL cache | No unlimited-call protection·cache TTL |
| Ownership·events | None | 5% rule holdings·executive holdings·36-event timeline | Insufficient input for S9 DD·S7 screening |

## 3. Enhancement Plan (Priority Roadmap)

### P1 — Stabilize corp_code resolution (top priority, biggest current weakness)
1. **Periodic dump cache**: when corpCode.xml.zip succeeds (once unblocked), persist to SQLite FTS or JSON —
   add a **24h TTL + manual refresh CLI** (`bun scripts/dart-sync-corp-codes.ts`) to the current
   dart-corpcode-cache.json. Port korean-dart-mcp's 24h TTL pre-loading pattern.
2. **Formalize the multi-fallback chain**: cache → corpCode.xml retry (with backoff) → web fallback
   (naviCrpCik/corpCode pattern — implemented 2026-09-01) → company.json reverse-lookup verification.
   Log success/failure of each chain step and record provenance of which path resolved the code (integrate
   with the RAG data reliability cap).
3. **Add stock-code path**: verify whether company.json reverse lookup also works with a 6-digit stock code
   (use the disclosure search stock_code field if corp_code is unsupported).

### P2 — Financial statement enhancement (directly affects S3·S8 quality)
4. **Account item expansion + normalization**: expand the current 6 accounts (wanted) to a K-IFRS standard
   account dictionary (COGS, SG&A, EBITDA conversion, etc.) — implement in code the normalization the
   skill's "Parsing Rules" section already documents.
5. **Cross-year validation (summation checks)**: detect disclosure errors·parsing errors via summation
   checks such as assets = liabilities + equity (a lightweight version of korean-dart-mcp's calculation
   linkbase validation). On failure, flag data reliability downward.
6. **Explicit separate/consolidated distinction**: currently fixed at fs_div=CFS — improve profile·synergy
   report accuracy with BFS (separate) fallback and source labeling (consolidated/separate).

### P3 — Disclosure·ownership·event expansion (strengthen S7·S9 inputs)
7. **Disclosure search presets**: add query functions for a target company's amendment disclosures·audit
   opinions·capital changes — automated evidence collection for S7 t-02 regulatory screening·S9 DD.
8. **Ownership·insider trading composite wrapper**: pre-aggregate majorshareholders·executive compensation
   into an "ownership stability signal" — bring the benchmark's insider_signal concept in as an S7
   scorecard input.

### P4 — Document raw-text processing (infrastructure integration)
9. **HWP/PDF attachments → text**: benchmark korean-dart-mcp's kordoc approach and integrate with the
   existing `hwp-document-processing` skill·tesseract OCR path — feed business report bodies·audit reports
   directly in as S3 research sources.

### P5 — Operational safeguards
10. **Call budget + backoff**: per-minute/per-day call counters and backoff on 429/020 codes (exponential
    backoff, concurrency ≤ 5) — prevents blocking during multi-query pipeline runs.
11. **Cache security**: ZIP slip/bomb defense and cache integrity checks when parsing — essential for the
    corpCode.xml.zip manual refresh procedure.

## 4. Execution Proposal (This Cycle)

- Immediately feasible: P1-1 (cache TTL+CLI), P1-2 (fallback chain provenance logging), P5-10 (backoff·
  counters) — pure logic changes, no external dependencies.
- Next cycle: P2-4~6 (financial enhancement), P3-7 (disclosure presets).
- Needs review: P3-8 and P4-9 touch new API areas, so design the procedure·gate integration before starting.

## Sources
- [dart-fss (PyPI)](https://pypi.org/project/dart-fss/) · [dart-fss docs](https://dart-fss.readthedocs.io/)
- [chrisryugj/korean-dart-mcp](https://github.com/chrisryugj/korean-dart-mcp/) · [glama.ai listing](https://glama.ai/mcp/servers/chrisryugj/korean-dart-mcp)
- [snaiws/DART-mcp-server](https://github.com/snaiws/DART-mcp-server)
- [OpenDART official guide — Corp Number API (020 request limit)](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018) · [English guide (20,000 limit)](https://engopendart.fss.or.kr/guide/detail.do?apiGrpCd=DE002&apiId=AE00032)
