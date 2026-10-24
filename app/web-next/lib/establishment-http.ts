// HTTP error mapping shared by the establishment routes (ADR-0165). Lives in
// lib/ because Next route files may only export handlers.
import { NextResponse } from "next/server";
import type { EstablishmentError, EstablishmentModeError } from "./establishment.ts";
import { badRequest, fail } from "./envelope.ts";

export function establishmentErrorResponse(error: EstablishmentError | EstablishmentModeError, extra?: { dependent_steps?: number[] }) {
  switch (error) {
    case "not_applicable":
      return badRequest("not_applicable", "Establishment execution does not apply — this project is not internal or joint.");
    case "evidence_required":
      return badRequest("evidence_required", "Completing a step requires an evidence URL or a note.");
    case "invalid_evidence_url":
      return badRequest("invalid_request", "The evidence URL must be an http(s) address of at most 2048 characters.");
    case "invalid_status":
      return badRequest("invalid_request", "status must be one of: in_progress | done | halted | escalated.");
    case "sequence_violation":
      return badRequest("sequence_violation", "Step 5 completion is only allowed after all four preceding steps are complete.");
    case "assignee_not_member":
      return badRequest("assignee_not_member", "The assignee must be a current member of this project.");
    case "invalid_reason":
      return badRequest("invalid_request", "The resume reason must be 10-2000 characters.");
    case "reopen_required":
      return fail(409, "reopen_required", "A completed step must be reopened before it can be changed.");
    case "not_done":
      return fail(409, "not_done", "Only completed steps can be resumed.");
    case "dependent_step_done":
      return NextResponse.json(
        {
          data: { dependent_steps: extra?.dependent_steps ?? [5] },
          meta: { as_of: new Date().toISOString() },
          error: { code: "dependent_step_done", message: "완료확인(5단계)이 완료 상태입니다. 함께 재개하려면 cascade_step5를 지정하세요." },
        },
        { status: 409 },
      );
    case "mode_not_chosen":
      return fail(409, "mode_not_chosen", "The establishment mode is not decided yet — confirm it in S10.");
    case "mode_mismatch":
      return fail(409, "mode_mismatch", "The requested establishment mode differs from the project's current mode. The mode cannot be changed via this path.");
    case "invalid_mode":
      return badRequest("invalid_request", "mode must be one of: new_entity | business_unit.");
    case "mode_not_allowed":
      return badRequest("mode_not_allowed", "business_unit can be chosen only for greenfield projects with origin=internal.");
    case "reason_required":
      return badRequest("reason_required", "Changing an already-chosen establishment mode requires a reason (10+ characters); prior step records remain as history.");
    default:
      return badRequest("invalid_request", "This project has no origin-opportunity link for establishment execution, so new steps cannot be created.");
  }
}

