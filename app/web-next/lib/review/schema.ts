// Zod contract for the AI 2nd reviewer output (ADR-0153 §4.3). The three
// buckets are the ONLY shape a review can take: there is no pass/approve/score
// field (.strict() rejects one), and `could_not_verify` must never be empty —
// a reviewer that claims to have checked everything is not credible, and
// silence is never read as approval.
import { z } from "zod";

export const ReviewItemSchema = z
  .object({
    claim: z.string().min(1),
    reason: z.string().min(1),
    evidence_ref: z.string().min(1).optional(),
  })
  .strict();

export const Ai2ndOutputSchema = z
  .object({
    verified: z.array(ReviewItemSchema),
    could_not_verify: z.array(ReviewItemSchema).min(1),
    needs_judgement: z.array(ReviewItemSchema),
  })
  .strict();

export type Ai2ndOutput = z.infer<typeof Ai2ndOutputSchema>;
