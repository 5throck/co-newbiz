// API error code → localized text resolution (design 2026-10-23-i18n-ui-adoption §3.5).
//
// The wire contract stays `{code, message}` (ADR-0109): `code` is the stable
// key, the server `message` is English developer-facing prose. Localized
// user-facing text comes from the `errors.codes.<code>` catalog keys resolved
// on the client in the active locale.
//
// lib/api.ts throws ApiError outside the React tree, so it cannot call
// next-intl hooks. The translator is captured from the React tree once at
// provider mount (ApiErrorBridge in components/ui.tsx) into this
// module-scoped registry; every later throw resolves through it.
//
// Resolution order for an envelope error:
//   1. `errors.codes.<code>` in the active locale (when the key exists)
//   2. the raw server message (English after T4 normalization)
// Client-safe: no React/next-intl imports here — only the registry contract.

export function apiErrorKey(code: string): string {
  return `errors.codes.${code}`;
}

type ApiErrorTranslator = (code: string) => string | null;

let translator: ApiErrorTranslator | null = null;

/** Installed by ApiErrorBridge on mount; `null` (SSR, tests) = raw message passthrough. */
export function setApiErrorTranslator(fn: ApiErrorTranslator | null): void {
  translator = fn;
}

/** Resolve a user-facing text for an envelope error `{code, message}`. */
export function resolveApiErrorText(code: string, fallback: string): string {
  const hit = translator ? translator(code) : null;
  return hit ?? fallback;
}
