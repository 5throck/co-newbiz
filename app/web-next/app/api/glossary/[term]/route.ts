// Port of app/server/glossary.ts GET /api/glossary/:term
import { authenticate } from "../../../../lib/auth.ts";
import { notFound, ok } from "../../../../lib/envelope.ts";
import { findTerm } from "../../../../lib/glossary.ts";

export async function GET(request: Request, { params }: { params: Promise<{ term: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { term: raw } = await params;
  const term = findTerm(decodeURIComponent(raw));
  if (!term) return notFound("Term not found in the glossary.");
  return ok(term);
}
