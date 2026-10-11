// WACC reference suggestions arrive with mixed units: ECOS-derived risk_free and
// credit_spread are percent points (3.788 = 3.788%) while observed_de is already
// a multiple (0.85 = 0.85x). Session inputs take ratios for the former only.
export function suggestionToInputValue(key: string, value: number | null): number | null {
  if (value === null) return null;
  return key === "risk_free" || key === "credit_spread" ? value / 100 : value;
}
