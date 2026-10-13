---
lang: ko
lang_reason: source-material
---

# Meeting 2026-10-13 — Residual items (facilitated by PM, skill: meeting-facilitation)

Status: PROPOSALS ONLY. The meeting decided nothing; every outcome below needs the human decider's approval.
Participants: platform-lead, process-governance-manager, release-engineer, legal-counsel, antitrust-agent, risk-officer (dissent seat). Rounds: 2.
Statute facts were checked with the k-law skill (Korea Ministry of Government Legislation Open API) on 2026-10-13; not legal advice.

## Agenda
1. ADR-0164 / ADR-0165 acceptance method and conditions
2. Translator-chosen terms
3. PRJ-T7T81A route mismatch (strategic_investment vs ADR text "partnership")
4. Production rollout (migrations 0139/0140, retroactive scope from 2026-07-01, beta data)
5. Legal / antitrust points needing confirmation
6. Whether the citation-only edit under procedures/** needs an ADR

## Round 1 — contributions (condensed; dissent verbatim below)

- platform-lead: accept 0164 and 0165 "with notes"; write four items into 0165's Decision before acceptance (step-5 rule, reopen notification out of scope, post-gate warning derived from event history, owner removal with a tracking ticket); no server flag now, promote to `reopened_after_gate` if consumers exceed one; procedures citation-only edit needs no new ADR (addendum/DEC + "no policy impact" + YAML diff check); production runbook with migration rehearsal on a backup copy and a 0139 unique-key conflict pre-query.
- process-governance-manager: both ADRs stay Proposed until a human signs (schema + authorization change); 0165 deviations as an "Implementation deviations" section; terms: keep "인력 확보 가능성", change "투자 중점 영역" to "중점 투자 분야", change "최소 대응" to "현상 유지안"; PRJ-T7T81A: ask the user for intent first, assert neither value; procedures: no ADR if behaviour fields are unchanged.
- release-engineer: ordered runbook (manual backup with manifest, record old image sha, deploy, smoke, rollback by image + restore); 7749 and prod DB are operator-only; beta data exists only in the dev DB (re-collect on prod vs migrate decision pending).
- legal-counsel (k-law): closed FIPA date mismatch (one amending act, article-wise effective dates 2025-10-01 / 2026-01-02, inferred), Invention Promotion Act arts. 10/12/13/15 for ef-07, Capital Markets Act art. 174 for min-04; external counsel needed for ef-08 (전적 consent, 전출 vs 근로자파견), ef-04 (Commercial Act art. 374 "important part"), ma-05, lr-07; split procedures edits into (a) citation corrections and (b) new obligations.
- antitrust-agent (k-law): HHI safe-harbour thresholds and decree art. 18(3) (foreign company domestic sales of 30 billion KRW) reported closed; ma-03 keep prudent-practice labels; min-05 needs counsel (scope of non-controlling stakes); min-04 R for strategic_investment is reasonable.

## Round 1 — DISSENT SEAT (risk-officer), verbatim

> [반대석 / risk-officer — 1라운드 발언, 그대로 옮겨 적어 주십시오. 읽기만 했고, 저장소는 깊게 보지 않았습니다. 아래 사실은 회의 안건에 적힌 내용을 근거로 합니다]
>
> **합의안에 대한 반대**
> 1. ADR-0160..0162를 채팅 지시 한 번으로 승인한 것은 사람이 항목별로 검토한 기록이 아닙니다. 설계상 넘을 수 없는 경계 2항(사람만 결정)과 "ADR은 AI 리뷰만으로 통과 불가" 규칙의 형식은 지켰지만, 실질은 지키지 못했습니다. 0164/0165까지 같은 방식으로 일괄 승인하면 안 됩니다.
> 2. ADR-0165는 아직 Proposed인데도 이탈 사항이 세 가지 있습니다. 재오픈 알림이 없고, 5단계가 1~4단계를 요구하는 규칙이 ADR 밖에 있으며, 게이트 이후 재오픈 경고는 UI에서만 만들어집니다. 이 상태로 승인하면 권한 모델이 문서와 코드 두 곳에 나뉩니다. API나 MCP를 거치면 경고 없이 재오픈할 수 있다고 봐야 합니다. 서버에서 강제되고 감사 로그가 남는다는 증거가 없습니다.
> 3. S9 범위 소급(2026-07-01 이후) 건입니다. 운영 DB를 열어보지 않았기 때문에 몇 건의 프로젝트에 영향이 가는지 0건인지 100건인지 모릅니다. 이미 게이트를 지난 프로젝트의 화면이 바뀌면, 승인 당시 근거와 지금 화면이 어긋납니다. 승인된 결정의 근거가 소리 없이 바뀌는 것입니다.
> 4. 법률 체크리스트 22개 이상은 AI가 쓰고 같은 분야의 AI가 검토했습니다. 설계상 이것은 1차 리뷰에 불과합니다. 그런데 출시되었고, k-law 대조도 일부만 했습니다. 번역자가 고른 용어('인력 확보 가능성', '투자 중점 영역', '최소 대응')는 법령 용어가 아닐 수 있습니다. 그러면 체크 결과가 법적으로 다르게 읽힙니다.
> 5. PRJ-T7T81A는 경로가 strategic_investment인데 ADR 본문은 'partnership'입니다. 사람이 기록한 opt-in이 어느 규칙에 묶이는지 모호합니다. 개발 데이터라고 넘기면 같은 불일치가 운영에서도 재현됩니다.
> 6. procedures/** 인용 수정을 ADR 없이 한 것은 프로젝트 규칙(policies/procedures 변경 시 ADR과 project_policy_pin 확인)을 어긴 것입니다. "인용만 고쳤다"는 판단을 누가 검증했습니까?
>
> **사용자가 한 번에 결정하면 안 되는 것**: 0164와 0165 승인, S9 소급 운영 배포, 법률 체크리스트의 "확정" 상태 전환. 이 세 가지는 따로따로 결정해야 합니다.
>
> **지명된 사람(법률 자문)의 검토 전까지 막아야 할 것**: 번역 법률 체크리스트와 용어 3개, legal-counsel·antitrust 문구 가운데 k-law로 확인하지 못한 부분. 그때까지 화면에 "확인 불가"로 표시해야 합니다.
>
> **운영 배포 사전 부검(실패 가정)**: 소급 범위 때문에 이미 게이트를 지난 프로젝트의 S9 항목이 바뀌거나 사라짐 → 투자심의 자료와 시스템이 불일치 → 감사에서 "승인 근거 변조"로 지적됨. API 경로로 재오픈했지만 알림이 가지 않아 담당자가 모름. 확인되지 않은 법률 문구 때문에 신고 의무를 놓침(gun-jumping).
>
> **가장 날카로운 반대 3가지(순위)**
> 1. **법률 체크리스트와 AI 법률 문구를 사람 검토 없이 쓰는 것.** 철회 조건: 이름이 지정된 법률 자문이 항목별로 서명하고, k-law 대조를 100% 마친 기록이 있을 때.
> 2. **S9 소급을 운영에 적용하는 것.** 철회 조건: 운영 DB에서 읽기 전용으로 영향받는 프로젝트 목록을 뽑고, 게이트를 지난 건은 제외하거나 고정(pin)하며, 롤백 계획을 사람이 승인할 때.
> 3. **ADR-0165를 이탈 사항이 남은 채 승인하는 것.** 철회 조건: 재오픈 알림을 구현하고, 5단계 규칙을 ADR 본문에 넣고, 서버에서 강제한다는 테스트를 제시하고, 사람이 0164와 0165를 각각 따로 승인할 때.

## Round 2 — contributions (condensed; dissent verbatim below)

- antitrust-agent (k-law, reproduced): Merger Review Guidelines (FTC notice 2024-15, admin rule serial 2100000245574, effective 2024-08-07) HHI thresholds and the art. 9(3) proviso quoted verbatim; Enforcement Decree art. 18 (MST 284737, effective 2026-03-24) para 3: a foreign counterparty is a filing subject only when each such foreign company's domestic sales are 30 billion KRW or more. FIPA/decree scope: Industrial Technology Protection Act decree art. 18-3(1)1 (50% or more, or largest shareholder with dominant influence), Advanced Strategic Industry Act decree art. 19(1)1 (same 50% test; the amendment version queried is unconfirmed, mark 확인 필요). UI marker proposal: "원문 확인됨(출처·조회일)" / "확인 필요 — 변호사 검토 전 확정 아님" / "확인 불가 — 원문 미조회/잘림". Items not to be shown as final without counsel: min-05 (non-controlling stakes), ma-03 prudent-practice labels.
- legal-counsel (k-law, independent): accepted the HHI guideline closure; did NOT accept decree art. 18(3) (its own queries returned truncated text of about 5.8k characters), so it stays unconfirmed until reproduced (antitrust later reported a successful re-query; the two reports conflict and both stay recorded). The merged procedures/_shared/entity-establishment-execution/schema.yaml edit (v1.1.0 to v1.1.1) is class (a) citation correction; one interpretive clarification (art. 530-9(2)(4): creditor protection attaches to a simple split that excludes joint liability) should be noted in a DEC appendix. Counsel sign-off protocol proposal: `legal-signoff/<checklist>@<version>.yaml` per item (item id, authority MST/article, verdict confirm/revise/hold, named signer and qualification, date); one named lawyer plus a human approver; per item (checklist-level for citation-only corrections); items unsigned after 30 days leave gate evidence and move to "needs judgement"; interim marker "AI 작성 · 법령 원문 일부 확인 · 변호사 검토 전 — 확정 아님".
- process-governance-manager: (a) citation correction only when (i) changes are limited to article numbers/notation/verification date, (ii) gate, agent_key, deliverables, ordering, mandatory flags, deadlines are unchanged, (iii) the same obligation is performed by the same person; otherwise (b) obligation change, which needs an ADR and a project_policy_pin check; citation corrections are patch-version only, with a YAML structural diff and a named human verifier on the PR. The schema.yaml edit classifies as (a) with a post-hoc human signature recommended. Status model for legal checklist items without a DB change: `draft-AI` / `counsel-reviewed` / `confirmed` via YAML fields `review_status`, `reviewer`, `verified_on`, shown as badges and counted in the "could not verify" area of the investment-committee materials. Terms: keep "인력 확보 가능성", change to "중점 투자 분야", change to "현상 유지안". 0164 and 0165 approved separately; add to 0164 Decision that gate-passed projects keep their view via project_policy_pin.
- release-engineer (dev DB, read-only): 0139 only widens the unique key, so the conflict query (group by run_id, source_procedure, review_cycle, section, measure_key having count>1) is a defence against tampered backups (dev: 0 rows, 9 scorecard rows); retroactive-scope impact query must use MIN(created_at, earliest non-overlay policy pin) not created_at alone (dev: 3 projects, 2 already have a dd go decision and later gate rows); nine-point go/no-go checklist; operator-only vs agent-assist split.
- platform-lead (code-verified): reopen audit is written server-side in one transaction for REST and MCP (audit action entity_establishment.reopen/.reopen_cascade, event row), but HUMAN_ONLY_ROUTES is enforced only at the MCP port, REST checks only role, and the actor row records the user id without the call path; the step-5 prerequisite is server-enforced on both completion and reopen but is absent from ADR-0165's Decision; the post-gate warning is derived display only. Retroactive scope DOES change what a gate-passed project sees: recorded gate decisions are not re-evaluated, but S9 completion is computed live, so extras can turn S9 from complete to blocked and later gates' prerequisite checks can fail after the fact. Recommended mitigation: exclude projects with a valid (non-stale) dd gate decision from the by-date path (explicit opt-in stays), needs ADR addendum and human approval; plus a read-only affected list on prod and a human-approved rollback of the three date constants. Acceptance record format per ADR: approver name/time, evidence of reading (commit hash, decision items), per-item table (approve / approve with change / hold + reason), known deviations the AI could not verify, withdrawal conditions, signer statement; 0164 and 0165 recorded separately.

## Round 2 — DISSENT SEAT (risk-officer), verbatim

> [반대석 2라운드 — risk-officer]
>
> (1) 이의 상태
> - 이의1 "재개(reopen)·소급 범위 변경이 서버에서 강제되지 않는다": 부분 해소. 이벤트 테이블과 감사 로그에 기록된다는 답변은 '기록된다'일 뿐 '막는다'는 아니다. platform-lead의 코드 검증 결과가 나오기 전까지는 미해소로 본다. 잔여 조건: 게이트를 통과한 프로젝트에 소급 범위가 바뀌는지를 코드로 증명하거나, 바뀐다면 서버 플래그를 지금 붙일 것.
> - 이의2 "0165의 이탈 사항이 Decision 밖에 묻힌다": 대부분 해소. 'Implementation deviations' 절과 Decision의 4개 항목 명시를 수용한다. 잔여 조건: 각 이탈 항목에 담당자와 종료 조건을 적을 것.
> - 이의3 "법무 체크리스트를 '확인됨'으로 다루는 것은 시기상조": 미해소. ef-08, ef-04, ma-05, lr-07, min-05는 외부 자문이 필요하다고 legal 스스로 인정했다. k-law 조회는 조문이 있는지 확인할 뿐 해석까지 확인해 주지 않는다.
>
> (2) 사전에 필요한 최소한의 사람 행위
> - ADR-0164 수락: 사용자가 Proposed→Accepted로 직접 서명. PRJ-T7T81A의 의도는 사용자 답변으로 확정하고, 에이전트가 값을 추정하지 않는다.
> - ADR-0165 수락: 위 서명에 더해, 사람이 이탈 목록과 서버 강제 검증 결과를 검토한 뒤 서명한다.
> - 07-01 범위로 운영 배포: 운영자가 수동 백업을 완료하고, 백업 사본에서 영향 SQL을 돌려 그 결과(영향받는 게이트 통과 프로젝트 목록)를 사람이 승인한다. 7749 배포는 운영자 본인이 실행한다.
> - 법무 체크리스트 '확인됨' 처리: 항목별로 외부 자문 서면 회신을 첨부한다. 자문 회신이 없는 항목은 'could not verify'로 남긴다. procedures의 (b) 신규 의무 변경은 ADR과 사람 서명 후에만 반영한다.
>
> (3) 사전 부검(pre-mortem)
> - 0164: 사용자 의도를 묻지 않은 채 기본값이 굳어지고, 나중에 "누가 정했나"에 답할 사람이 없다.
> - 0165: 'with notes' 수락이 사실상 무기한 면제가 되어 서버 플래그가 영영 붙지 않는다.
> - 운영 배포: 롤백을 이미지와 복원으로 하면 배포 이후에 입력된 데이터는 사라진다. 이 데이터 손실 구간이 runbook에 없다.
> - 법무: 조문 번호가 맞는 것과 결론이 맞는 것을 혼동해 '확인됨'이 투자 판단에 인용된다.
> - procedures 수정: "행위 필드는 그대로"라는 판단 자체를 AI가 내리면 ADR 회피 통로가 된다. 이 분류는 사람이 확정해야 한다.

## Conflicts left open (not averaged)
- Decree art. 18(3): antitrust reports it verified verbatim; legal-counsel could not reproduce it (truncated response). Both recorded; closure needs a re-query by a third party or the web text.
- procedures/**: platform-lead and governance see no ADR need for a citation-only edit; risk-officer holds it violated the project rule; legal-counsel proposes the (a)/(b) split. Not reconciled; the classification itself must be confirmed by a human.

## Proposed actions (for the user to approve one by one; nothing was decided)
1. ADR-0164 and ADR-0165: approve separately, each with a per-item acceptance record. Before 0165: write the four Decision items (step-5 rule, reopen notification out of scope, post-gate warning derived from history, owner removal date with an owner) and name an owner and exit condition for each deviation.
2. Retroactive scope: before any production rollout add the exclusion of projects with a recorded dd gate decision (ADR addendum + human approval), run the read-only impact query on a prod backup copy, and approve the rollback of the three date constants. Production rollout stays operator-only.
3. Legal checklists: add `review_status` / `reviewer` / `verified_on` and the interim markers; counsel sign-off per the proposed protocol; keep items needing external counsel (ef-08, ef-04, ma-05, lr-07, min-05) marked unconfirmed.
4. Terms: "인력 확보 가능성" keep, "중점 투자 분야", "현상 유지안" (user decision).
5. PRJ-T7T81A: user states the intended sub-track; audit-log check of the opt-in path.
6. procedures/**: human classifies the schema.yaml edit as (a) or (b) and signs; DEC appendix for the art. 530-9 clarification.
7. Housekeeping: a temporary directory /tmp/klq_x holds a copy of the project's .env (the Open API key); the agent could not delete it and neither could the PM (permission denied). The user should delete it.

## Action items and owners
| # | Action | Owner |
|---|---|---|
| 1 | Decide ADR-0164, ADR-0165 separately; sign acceptance records | Human decider |
| 2 | Approve exclusion of gate-passed projects from the by-date scope + rollback plan | Human decider; platform-lead implements |
| 3 | Name counsel and approve the sign-off protocol | Human decider |
| 4 | Confirm the three terms | Human decider |
| 5 | State PRJ-T7T81A's intended sub-track | Human decider |
| 6 | Run the impact and 0139 queries on a prod backup copy; deploy | Operator |
| 7 | Delete /tmp/klq_x | Operator / user |
