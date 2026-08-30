// LLM configuration status for the market-sizing pipeline — reports whether
// the CO_NEWBIZ_LLM_* environment is configured so new analyses will use a
// real LLM (vs deterministic synthesis). Never returns the API key.
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";
import { getProviderConfig } from "../../../lib/llm.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const cfg = getProviderConfig();
  return ok(
    {
      configured: cfg !== null,
      provider: cfg?.provider ?? null,
      model: cfg?.model ?? null,
    },
    200,
    { configured: cfg !== null },
  );
}
