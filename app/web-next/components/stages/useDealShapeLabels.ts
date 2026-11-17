"use client";

import { useTranslations } from "next-intl";

/** Shape / intent labels. The four shapes the S10 structure screen already names reuse its keys (one wording per shape). */
export function useDealShapeLabels() {
  const t = useTranslations("stages.s67.dealShapePanel");
  const ts = useTranslations("stages.s10.stage");
  const tc = useTranslations("common");
  const td = useTranslations("stages.s4.decisionTab");
  const shape = (s: string): string => {
    switch (s) {
      case "full_acquisition":
        return ts("fullAcquisition");
      case "majority_stake":
        return ts("majorityStake");
      case "minority_stake":
        return ts("minorityStake");
      case "joint_venture":
        return ts("jointVentureJv");
      case "spv":
        return ts("spcSpvSpecialPurposeEntity");
      case "holdco_route":
        return ts("viaHoldingCompanyHoldco");
      case "license_in":
        return t("shape.license_in");
      case "co_development":
        return t("shape.co_development");
      default:
        return s;
    }
  };
  const intent = (i: string): string =>
    i === "integration" ? td("consolidated") : i === "capability_access" ? tc("capabilityApproach") : i;
  return { shape, intent };
}
