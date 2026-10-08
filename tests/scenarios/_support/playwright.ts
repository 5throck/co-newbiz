// playwright-core lives in app/web-next (its own dependency tree). Its ESM entry
// (index.mjs) ships no sibling .d.mts, so re-export the runtime with the types
// from index.d.ts to keep the root typecheck clean.
import type * as PlaywrightTypes from "../../../app/web-next/node_modules/playwright-core/index.d.ts";
// @ts-ignore -- no declaration file next to index.mjs; typed through the cast below
import * as runtime from "../../../app/web-next/node_modules/playwright-core/index.mjs";

export const chromium: typeof PlaywrightTypes.chromium = (runtime as typeof PlaywrightTypes).chromium;
export type { Browser, BrowserContext, Locator, Page } from "../../../app/web-next/node_modules/playwright-core/index.d.ts";
