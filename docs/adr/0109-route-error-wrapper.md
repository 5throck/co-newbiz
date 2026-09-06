# ADR-0109: Envelope-guaranteed route handlers — `route()` wraps every API handler so uncaught errors honor the §9 envelope

- Status: Accepted
- Date: 2026-09-06
- Deciders: New Business Review Lead (PM)
- Related: api-spec.md §9 (Response Envelope and Error Contract), ADR-0091 (role separation / deny-by-default), ADR-0105 (navigation SSOT — same "make the contract enforced, not conventional" pattern)

## Context

api-spec.md §9 defines the single response envelope — `{data, meta, error}` —
and `app/web-next/lib/envelope.ts` provides `ok()`/`fail()` for producing it.
But the contract only held on the happy path: it was enforced by developer
discipline inside each handler body. Any uncaught exception (a thrown
repository error, a malformed UUID reaching SQLite, a regression in a shared
helper) bypassed `fail()` entirely and fell through to Next.js's default
error handling, which returns an **HTML** 500 page.

Clients of the API cannot parse that. `lib/api.ts` (the frontend fetch
layer) and the MCP REST wrappers expect a JSON envelope; on an uncaught
error they got `text/html`, broke on parse or surfaced a useless generic
failure, and the actual error message — already logged server-side — never
reached the client in structured form.

Wrapping every handler in its own try/catch was the obvious alternative,
but with 30+ handlers across ~30 route files it is exactly the kind of
convention that rots: the next new route forgets the boilerplate, and the
envelope guarantee silently regresses.

## Decision

1. **New `app/web-next/lib/route.ts` exports `route(handler)`** — a
   higher-order wrapper that runs the handler inside a try/catch. On an
   uncaught error it logs the full error server-side
   (`[api] unhandled route error:`) and returns
   `fail(500, "internal_error", <error message>)` — the standard
   `{data, meta, error}` envelope with a 500 status, instead of Next's
   default HTML 500.
2. **Every API route handler is wrapped.** All handlers in the existing
   route files (16 handlers across 10 files: llm-status, committee-sessions,
   establishment, factors, gate-decisions, pipeline/status, route-advisory,
   route-decision, and both series routes) now export
   `export const GET = route(async ...)` style handlers, and all newly
   added routes (ADR-0110's JV/PMI/partnership surfaces) are born wrapped —
   34 handlers across 20 route files total.
3. **The wrapper is the enforcement mechanism, not a convention.**
   `tests/unit/openapi.test.ts` — the OpenAPI drift gate — now recognizes
   both handler declaration styles (`export async function GET(...)` and
   `export const GET = route(...)`) via its per-method regex
   (`^export\s+(?:(?:async\s+)?function\s+|const\s+)GET\b`), so a route
   using the wrapper stays visible to the drift check. New routes are
   expected to use `route()`; a handler that needs custom error mapping
   can catch inside its body first and let `route()` cover whatever
   escapes.

## Consequences

- The §9 envelope now holds on the error path as well as the success path:
  every client (`lib/api.ts`, MCP wrappers, scripts) can uniformly parse
  `{data, meta, error}` and read `error.code: "internal_error"`.
- Error messages from unexpected exceptions are passed through to the
  client body. They were previously invisible; server-side logging keeps
  the full stack out of the response while the message remains available
  for debugging. If a future route risks leaking sensitive detail through
  an exception message, that route should sanitize inside its body — the
  wrapper is a safety net, not a redaction layer.
- Per-route status codes (401/403/404/409 thrown as `Response`s) are
  unaffected — the wrapper only intercepts exceptions, and handler-returned
  `Response`s pass through untouched.
- One more layer of indirection in every route file; accepted in exchange
  for a contract that no longer depends on per-handler vigilance.
