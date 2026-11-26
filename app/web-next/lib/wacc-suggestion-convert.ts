// WACC reference suggestions arrive with mixed units: ECOS-derived risk_free and
// credit_spread are percent points (3.788 = 3.788%) while observed_de is already
// a multiple (0.85 = 0.85x). The published ERP and the statutory tax rate (ADR-0207) are percent points too.
// Session inputs take ratios for the percent-point keys only.
export function suggestionToInputValue(key: string, value: number | null): number | null {
  if (value === null) return null;
  if (key === "risk_free" || key === "credit_spread" || key === "erp" || key === "tax_rate")
    return Number((value / 100).toPrecision(12));
  return value;
}
