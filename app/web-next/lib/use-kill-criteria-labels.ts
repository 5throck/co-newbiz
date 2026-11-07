"use client";

// Locale labels for kill criteria. `procedures/_kill-criteria/*.json` carries the English title and the action code as
// governance data; screens show the catalog entry (`killCriteria.titles.<criterion_id>`, `killCriteria.actions.<action>`)
// and fall back to the registry text when a criterion has no entry yet.
import { useTranslations } from "next-intl";

/** The criterion_id of a snapshot key (`<procedure>:<criterion_id>`; procedure names contain no colon). */
export function criterionIdOfKey(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? key : key.slice(i + 1);
}

export function useKillCriteriaLabels() {
  const t = useTranslations("killCriteria");
  const title = (criterionId: string | null | undefined, fallback: string): string => {
    const k = `titles.${criterionId ?? ""}`;
    return criterionId && t.has(k as never) ? t(k as never) : fallback;
  };
  const action = (code: string): string => {
    const k = `actions.${code}`;
    return t.has(k as never) ? t(k as never) : code;
  };
  /** Evidence caveat of a criterion (`killCriteria.caveats.<criterion_id>`); the server text is the fallback. */
  const caveat = (criterionId: string | null | undefined, fallback: string): string => {
    const k = `caveats.${criterionId ?? ""}`;
    return criterionId && t.has(k as never) ? t(k as never) : fallback;
  };
  return { title, action, caveat, caveatOfKey: (key: string, fallback: string) => caveat(criterionIdOfKey(key), fallback), titleOfKey: (key: string, fallback: string) => title(criterionIdOfKey(key), fallback) };
}
