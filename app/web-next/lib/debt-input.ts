// @version 1.0.0
// Input contract of POST /api/projects/:id/debt (MC verification D1 review, MEDIUM-2/3).
// principal: integer KRW millions (ADR-0061); rate: percent in (0, 100]; amortization: the
// canonical enum or a Korean/English synonym lib/covenant-dscr.ts understands; maturity: a tenor
// or a date that parseTenorYears accepts; free-text fields are length-capped.
import { z } from "zod";
import { parseAmortization, parseTenorYears } from "./covenant-dscr.ts";

export const DEBT_COVENANT_JSON_MAX = 2000;

const optText = (max: number) => z.string().trim().max(max).nullish();

export const debtCreateSchema = z.object({
  lender: optText(200),
  principal: z.number().int("principal must be an integer (KRW millions)").positive(),
  rate_type: z.enum(["fixed", "floating"]).optional(),
  rate: z.number().gt(0, "rate is a percent and must be > 0").lte(100, "rate is a percent and must be <= 100"),
  maturity: optText(40).refine((v) => !v || parseTenorYears(v, "1900-01-01T00:00:00Z") !== null, "maturity must be a tenor (5년, 5y) or a date (YYYY-MM)"),
  amortization: optText(60).refine((v) => !v || parseAmortization(v) !== null, "amortization must be annuity | equal_principal | bullet (or a Korean synonym)"),
  covenant_json: optText(DEBT_COVENANT_JSON_MAX),
  security: optText(200),
  seniority: optText(100),
});
