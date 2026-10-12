// HTTP error mapping shared by the establishment routes (ADR-0165). Lives in
// lib/ because Next route files may only export handlers.
import { NextResponse } from "next/server";
import type { EstablishmentError } from "./establishment.ts";
import { badRequest, fail } from "./envelope.ts";

export function establishmentErrorResponse(error: EstablishmentError, extra?: { dependent_steps?: number[] }) {
  switch (error) {
    case "not_applicable":
      return badRequest("not_applicable", "이 프로젝트는 내부 추진·합작이 아니어서 설립 실행이 적용되지 않습니다.");
    case "evidence_required":
      return badRequest("evidence_required", "완료 처리에는 증적 URL 또는 비고가 필요합니다.");
    case "invalid_evidence_url":
      return badRequest("invalid_request", "증적 URL은 http(s) 주소여야 하며 2048자 이하입니다.");
    case "invalid_status":
      return badRequest("invalid_request", "status는 in_progress | done | halted | escalated 중 하나입니다.");
    case "sequence_violation":
      return badRequest("sequence_violation", "완료확인(5단계)은 선행 4단계가 모두 완료된 후에만 완료할 수 있습니다.");
    case "assignee_not_member":
      return badRequest("assignee_not_member", "담당자는 이 프로젝트의 현재 구성원이어야 합니다.");
    case "invalid_reason":
      return badRequest("invalid_request", "재개 사유는 10자 이상 2000자 이하여야 합니다.");
    case "reopen_required":
      return fail(409, "reopen_required", "완료된 단계는 먼저 재개해야 변경할 수 있습니다.");
    case "not_done":
      return fail(409, "not_done", "완료 상태가 아닌 단계는 재개할 수 없습니다.");
    case "dependent_step_done":
      return NextResponse.json(
        {
          data: { dependent_steps: extra?.dependent_steps ?? [5] },
          meta: { as_of: new Date().toISOString() },
          error: { code: "dependent_step_done", message: "완료확인(5단계)이 완료 상태입니다. 함께 재개하려면 cascade_step5를 지정하세요." },
        },
        { status: 409 },
      );
    default:
      return badRequest("invalid_request", "이 프로젝트에는 설립 실행 기록의 근원 기회(origin opportunity) 연결이 없어 새 단계를 생성할 수 없습니다.");
  }
}

