// OpenTelemetry GenAI spans without an SDK dependency (Wave B / B-1, design §6).
// With OTEL_EXPORTER_OTLP_ENDPOINT unset this is a pure no-op (no exporter, no
// network). With it set, one `gen_ai.chat` span per call is POSTed as OTLP/HTTP
// JSON. Prompt and completion CONTENT is never an input to this module (MNPI):
// only the attribute names listed in SpanAttrs can ever leave the process.

export interface SpanAttrs {
  system: string;
  requestModel: string;
  responseModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  projectId?: string;
  functionName?: string;
}

export function otelEnabled(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}

const hex = (bytes: number): string => {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
};

type OtlpValue = { stringValue: string } | { intValue: string };
const sv = (key: string, v: string): { key: string; value: OtlpValue } => ({ key, value: { stringValue: v } });
const iv = (key: string, v: number): { key: string; value: OtlpValue } => ({ key, value: { intValue: String(Math.floor(v)) } });

/** Fire-and-forget export of a finished span. Never throws, never blocks the caller. */
export function emitGenAiSpan(attrs: SpanAttrs, startMs: number, endMs: number, ok: boolean): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return;
  try {
    const attributes = [
      sv("gen_ai.system", attrs.system),
      sv("gen_ai.request.model", attrs.requestModel),
      ...(attrs.responseModel ? [sv("gen_ai.response.model", attrs.responseModel)] : []),
      ...(attrs.inputTokens !== undefined ? [iv("gen_ai.usage.input_tokens", attrs.inputTokens)] : []),
      ...(attrs.outputTokens !== undefined ? [iv("gen_ai.usage.output_tokens", attrs.outputTokens)] : []),
      ...(attrs.projectId ? [sv("co_newbiz.project_id", attrs.projectId)] : []),
      ...(attrs.functionName ? [sv("co_newbiz.function", attrs.functionName)] : []),
    ];
    const body = {
      resourceSpans: [
        {
          resource: { attributes: [sv("service.name", "co-newbiz-web")] },
          scopeSpans: [
            {
              scope: { name: "co-newbiz.llm" },
              spans: [
                {
                  traceId: hex(16),
                  spanId: hex(8),
                  name: "gen_ai.chat",
                  kind: 3,
                  startTimeUnixNano: String(BigInt(Math.floor(startMs)) * 1_000_000n),
                  endTimeUnixNano: String(BigInt(Math.floor(endMs)) * 1_000_000n),
                  attributes,
                  status: { code: ok ? 1 : 2 },
                },
              ],
            },
          ],
        },
      ],
    };
    const url = `${endpoint.replace(/\/$/, "")}/v1/traces`;
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  } catch {
    // telemetry must never affect a model call
  }
}
