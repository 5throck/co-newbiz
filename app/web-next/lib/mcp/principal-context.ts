// @version 1.0.0
// In-process delegated principal — ADR-0154 §1 (InProcessRestPort).
//
// /api/mcp runs the existing route handlers in-process. The delegated human
// principal travels in an AsyncLocalStorage scope that only
// InProcessRestPort enters; lib/auth.ts's authenticate() reads it before
// looking at headers. An HTTP client cannot set it — there is no header or
// cookie form of this principal — so the general REST API still rejects
// OAuth access tokens (audience binding, RFC 8707).

import { AsyncLocalStorage } from "node:async_hooks";

export interface DelegatedPrincipal {
  userId: string;
  role: string;
  /** Live OAuth scopes (granted ∩ role-allowed). */
  scopes: readonly string[];
  mustChangePassword: boolean;
  tokenId: string;
  clientId: string;
}

// One store per process even if the module is evaluated in several bundles.
const KEY = Symbol.for("co-newbiz.mcp.delegatedPrincipal");
type Holder = { [KEY]?: AsyncLocalStorage<DelegatedPrincipal> };
const holder = globalThis as Holder;
const store: AsyncLocalStorage<DelegatedPrincipal> = holder[KEY] ?? (holder[KEY] = new AsyncLocalStorage<DelegatedPrincipal>());

export function runAsPrincipal<T>(principal: DelegatedPrincipal, fn: () => Promise<T>): Promise<T> {
  return store.run(principal, fn);
}

export function currentPrincipal(): DelegatedPrincipal | undefined {
  return store.getStore();
}
