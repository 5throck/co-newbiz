// T6 (design 2026-10-23-i18n-ui-adoption §5): the project-runnable form of the
// workspace i18n-audit skill (skills/i18n-audit steps 1–4), adapted for the two
// documented project deviations — the master locale is ko (ADR-0184 /
// DEC-20261023-02), and the glossary termbase is YAML (glossary/*.yaml) rather
// than docs/glossary.md / glossary.json.
//
// What this locks in, beyond tests/unit/i18n-parity.test.ts (which stays the
// en-mirror guard of design §5.1):
//   1. Master key sync generalized to every locale declared in i18n/config.ts —
//      adding ja.json later is a catalog file plus a config entry, and this
//      test starts enforcing it with no edit here.
//   2. ICU {param} parity: every key's interpolation set must equal the ko
//      master's, per locale.
//   3. ICU validity: every catalog value parses with the same engine next-intl
//      uses (intl-messageformat), and the `''{param}''` quoting discipline is
//      one-way — no value may carry the broken `'{param}'` single-quote-wrapped
//      form (ICU would render the braces literally and drop the parameter).
//   4. Hangul must not leak into en values except the endonym allowlist
//      (common.locale.ko, pages.library.langKo — "한국어" is correct in en).
//   5. Glossary adherence with a recorded drift baseline: the drift count may
//      only ratchet DOWN — lowering the constant is the mechanism, raising it
//      is forbidden by the assertion below.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import * as yaml from "js-yaml";
// intl-messageformat (the engine inside next-intl) is hoisted under
// app/web-next/node_modules only; a path import is the established pattern
// (tests/scenarios/_support/browser.ts resolves axe-core the same way).
import { IntlMessageFormat } from "../../app/web-next/node_modules/intl-messageformat";
import { locales, masterLocale } from "../../app/web-next/i18n/config.ts";
import en from "../../app/web-next/locales/en.json";
import ko from "../../app/web-next/locales/ko.json";

type Catalog = Record<string, unknown>;

const REPO_ROOT = join(import.meta.dirname, "../..");

/** Flat dot-path → string-value leaves of a nested catalog. */
function leaves(obj: Catalog, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") out.push(...leaves(v as Catalog, path));
    else if (typeof v === "string") out.push([path, v]);
  }
  return out;
}

function dotValue(obj: Catalog, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, k) => (acc as Catalog | undefined)?.[k], obj);
}

/** ICU argument names used by a message. Braces inside single-quoted literals
 * cannot hide parameters under the enforced quote discipline (the `'{…}'`
 * form fails the quote-discipline test), so flat extraction is exact here. */
function icuParams(value: string): string[] {
  const names: string[] = [];
  for (const match of value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

/** The broken quoting form: a SINGLE-quoted `{param}` renders the braces
 * literally (ICU treats '…' as a literal run). The correct form doubles the
 * quotes — `''{param}''` — so a match must reject quote-adjacent braces. */
const BROKEN_QUOTED_PARAM = /(?<!')'\{[^{}]*\}'(?!')/;

const HANGUL = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/;

/** en values allowed to contain Hangul: endonym labels (rendered identically
 * in every locale — a language's name in its own script is not a leak). */
const EN_HANGUL_ALLOWLIST = new Set(["common.locale.ko", "pages.library.langKo"]);

// --- Glossary adherence (skill step 3, YAML adaptation) ----------------------
//
// Matching rules (fixed by the 2026-10-24 audit, recorded in
// docs/audits/2026-10-24-i18n-audit.md):
//   - A glossary term "applies" to a key when the ko master value contains the
//     term's ko form as a whole word: no adjacent same-script character
//     (Hangul terms get Hangul boundaries; Latin/digit terms get
//     [A-Za-z0-9_] boundaries) — 확정 inside 확정일자 is not a match.
//   - The en counterpart adheres when it contains, case-insensitively and as a
//     whole word (optional plural -s), the term's en rendering OR the term
//     name (acronym terms: the UI legitimately says "DSCR", not the full
//     "Debt Service Coverage Ratio"), or the common-noun form greenfield /
//     brownfield for Green Field / Brown Field (T5 review note).
//   - Everything else is drift. The dominant drift class is terminological
//     granularity, not mistranslation: generic 확정 ("confirmed", the verb)
//     and 게이트 ("gate") cannot literally carry "Confirmed Status" /
//     "Stage Gate" — that split is a glossary-curator referral (report §5).

/** Glossary drift at audit time (2026-10-24). Ratchet: lower this constant
 * after fixing entries; the test fails if drift grows back toward it. */
const GLOSSARY_DRIFT_BASELINE = 274;

interface GlossaryTerm {
  name: string;
  ko: string;
  en: string;
}

function loadGlossaryTerms(): GlossaryTerm[] {
  const dir = join(REPO_ROOT, "glossary");
  const terms: GlossaryTerm[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml") && f !== "_schema.yaml")) {
    const doc = yaml.load(readFileSync(join(dir, file), "utf8")) as {
      terms?: Record<string, { ko?: string; en?: string }>;
    };
    for (const [name, term] of Object.entries(doc.terms ?? {})) {
      if (term?.ko && term?.en) terms.push({ name, ko: term.ko, en: term.en });
    }
  }
  return terms;
}

function koTermMatcher(term: string): RegExp {
  const wordClass = /^[A-Za-z0-9_]/.test(term) ? "A-Za-z0-9_" : "\uAC00-\uD7A3";
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![${wordClass}])${escaped}(?![${wordClass}])`, "i");
}

function enWordRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}s?($|[^A-Za-z0-9_])`, "i");
}

function enAdheresToTerm(enValue: string, term: GlossaryTerm): boolean {
  const allowedForms = term.en === term.name ? [term.en] : [term.en, term.name];
  for (const form of allowedForms) {
    if (enWordRegex(form).test(enValue)) return true;
  }
  // Task-named common-noun allowances (T5 note).
  for (const form of allowedForms) {
    const lower = form.toLowerCase();
    if (lower === "green field" && enWordRegex("greenfield").test(enValue)) return true;
    if (lower === "brown field" && enWordRegex("brownfield").test(enValue)) return true;
  }
  return false;
}

interface GlossaryDrift {
  key: string;
  term: string;
  enTerm: string;
  enValue: string;
}

function computeGlossaryDrift(): GlossaryDrift[] {
  const koLeaves = leaves(ko);
  const enByKey = new Map(leaves(en));
  const drift: GlossaryDrift[] = [];
  for (const term of loadGlossaryTerms()) {
    const matcher = koTermMatcher(term.ko);
    for (const [key, koValue] of koLeaves) {
      if (!matcher.test(koValue)) continue;
      const enValue = enByKey.get(key) ?? "";
      if (!enAdheresToTerm(enValue, term)) {
        drift.push({ key, term: term.name, enTerm: term.en, enValue });
      }
    }
  }
  return drift.sort((a, b) => a.term.localeCompare(b.term) || a.key.localeCompare(b.key));
}

// --- Audit checks -------------------------------------------------------------

const nonMasterLocales = locales.filter((l) => l !== masterLocale);

/** Non-master catalogs, loaded by config declaration — a future ja.json is
 * picked up here with no edit to this file. */
const catalogs = new Map<string, Catalog>(
  await Promise.all(
    nonMasterLocales.map(async (locale) => {
      const mod = (await import(`../../app/web-next/locales/${locale}.json`)) as { default: Catalog };
      return [locale, mod.default] as const;
    }),
  ),
);

describe("i18n audit (skills/i18n-audit, project-runnable form)", () => {
  test("step 1+2 — every declared locale's key tree exactly mirrors the ko master", () => {
    expect(locales.length).toBeGreaterThanOrEqual(2);
    const masterKeys = leaves(ko)
      .map(([k]) => k)
      .sort();
    for (const [locale, catalog] of catalogs) {
      expect(
        leaves(catalog)
          .map(([k]) => k)
          .sort(),
        `locales/${locale}.json key tree`,
      ).toEqual(masterKeys);
    }
  });

  test("ICU param parity — every locale's {param} set per key equals ko's", () => {
    const koParams = new Map(leaves(ko).map(([k, v]) => [k, icuParams(v)]));
    for (const [key, params] of [...koParams.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const expected = [...params].sort().join(",");
      for (const [locale, catalog] of catalogs) {
        const actual = icuParams(dotValue(catalog, key) as string)
          .sort()
          .join(",");
        expect(actual, `${locale}.${key}`).toBe(expected);
      }
    }
  });

  test("ICU validity — every value in every catalog parses with intl-messageformat", () => {
    const unparseable: string[] = [];
    for (const [locale, catalog] of [[masterLocale, ko] as const, ...catalogs]) {
      for (const [key, value] of leaves(catalog)) {
        try {
          new IntlMessageFormat(value, locale);
        } catch (error) {
          unparseable.push(`${locale}.${key}: ${String(error).slice(0, 80)}`);
        }
      }
    }
    expect(unparseable).toEqual([]);
  });

  test("quote discipline — no value wraps a param in single quotes ('{p}'), the literal-brace form", () => {
    const broken = [...leaves(ko), ...[...catalogs.values()].flatMap(leaves)].filter(([, v]) =>
      BROKEN_QUOTED_PARAM.test(v),
    );
    expect(broken.map(([k]) => k)).toEqual([]);
  });

  test("en values contain no Hangul outside the endonym allowlist", () => {
    const leaked = leaves(en).filter(([key, value]) => HANGUL.test(value) && !EN_HANGUL_ALLOWLIST.has(key));
    expect(leaked.map(([k]) => k)).toEqual([]);
  });

  test(`glossary adherence — drift count ${GLOSSARY_DRIFT_BASELINE} is a ceiling that only ratchets down`, () => {
    const drift = computeGlossaryDrift();
    expect(drift.length).toBeLessThanOrEqual(GLOSSARY_DRIFT_BASELINE);
  });
});
