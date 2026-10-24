// T4 (design 2026-10-23-i18n-ui-adoption §3.5): the client helper resolves
// envelope errors from `errors.codes.<code>` catalog keys and falls back to
// the server message for unknown codes. Catalog key parity across locales is
// asserted globally by i18n-parity.test.ts; here we pin the helper contract
// and that every produced code has a catalog entry in BOTH catalogs.
import { describe, expect, test } from "bun:test";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";
import { apiErrorKey, resolveApiErrorText, setApiErrorTranslator } from "../../app/web-next/lib/error-messages.ts";

type Catalog = Record<string, unknown>;

function codesOf(catalog: Catalog): Record<string, string> {
  const errors = catalog.errors as Catalog;
  const codes = errors.codes as Catalog;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(codes)) out[k] = String(v);
  return out;
}

describe("error-messages (envelope code → catalog text)", () => {
  test("every errors.codes key exists and is non-empty in ko and en", () => {
    const koCodes = codesOf(ko);
    const enCodes = codesOf(en);
    expect(Object.keys(koCodes).length).toBeGreaterThan(200);
    expect(Object.keys(koCodes).sort()).toEqual(Object.keys(enCodes).sort());
    for (const [code, text] of Object.entries(koCodes)) expect(text.trim(), `ko.${code}`).not.toBe("");
    for (const [code, text] of Object.entries(enCodes)) expect(text.trim(), `en.${code}`).not.toBe("");
  });

  test("apiErrorKey builds the errors.codes.<code> key", () => {
    expect(apiErrorKey("role_required")).toBe("errors.codes.role_required");
  });

  test("known codes resolve through the installed translator (active-locale catalog)", () => {
    setApiErrorTranslator((code) => codesOf(ko)[code] ?? null);
    try {
      expect(resolveApiErrorText("role_required", "Requires the analyst role or higher.")).toBe(
        codesOf(ko).role_required,
      );
      // unknown code falls back to the server message
      expect(resolveApiErrorText("no_such_code_anywhere", "Server developer prose.")).toBe("Server developer prose.");
    } finally {
      setApiErrorTranslator(null);
    }
  });

  test("without a translator (SSR/tests) the server message passes through", () => {
    setApiErrorTranslator(null);
    expect(resolveApiErrorText("role_required", "Requires the analyst role or higher.")).toBe(
      "Requires the analyst role or higher.",
    );
  });
});
