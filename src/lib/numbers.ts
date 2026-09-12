/** Preserve magnitude, currency, and percent markers when comparing quantities. */
export function extractNumbers(text: string): string[] {
  const matches = text.matchAll(
    /([$€£]?\s*\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(billion|million|thousand|bn|[bmk])\b)?(\s*%|\s*percent\b)?/gi,
  );
  return [...matches].map((match) => {
    const value = match[1].replace(/[\s,]/g, "");
    const unit = match[2]?.toLowerCase();
    const magnitude = unit ? ({ billion: "b", bn: "b", million: "m", thousand: "k" }[unit] ?? unit) : "";
    return `${value}${magnitude}${match[3] ? "%" : ""}`;
  });
}
