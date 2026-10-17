// One-release re-export shim (2026-10-17 entry-market flow redesign, OD-4):
// this module's logic folded into lib/entry-market-flow-state.ts (which adds
// the FlowState machine, the header-strip derivation and the derivation-step
// form mappers). The old import path keeps working for the existing tests
// and any out-of-tree consumers; delete this shim in a later wave.
export * from "./entry-market-flow-state.ts";
