/** Compact magnitude suffixes keep $6B distinct from $6M while remaining comparable to spelled-out units. */
const MAGNITUDE: Record<string, string> = {
  billion: "b",
  bn: "b",
  million: "m",
  thousand: "k",
};

const SCALE: Record<string, number> = { b: 1e9, m: 1e6, k: 1e3 };

export type Quantity = {
  token: string;
  value: number;
  currency: string;
  percent: boolean;
};

const NUMBER_PATTERN =
  /([$€£])?\s*(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(billion|million|thousand|bn|[bmk])\b)?(\s*%|\s*percent\b)?/gi;

function parseMatch(match: RegExpMatchArray): Quantity | null {
  const currency = match[1] ?? "";
  const digits = match[2].replace(/,/g, "");
  const amount = Number(digits);
  if (!Number.isFinite(amount)) return null;
  const unit = match[3] ? MAGNITUDE[match[3].toLowerCase()] ?? match[3].toLowerCase() : "";
  const percent = Boolean(match[4]);
  const scale = percent ? 1 : (SCALE[unit] ?? 1);
  return {
    token: `${currency}${digits}${unit}${percent ? "%" : ""}`.toLowerCase(),
    value: amount * scale,
    currency,
    percent,
  };
}

export function parseQuantities(text: string): Quantity[] {
  return [...text.matchAll(NUMBER_PATTERN)].flatMap((match) => {
    const index = match.index ?? 0;
    const prefix = text.slice(Math.max(0, index - 16), index).toLowerCase();
    if (/(?:cfa|level|series)\s*[$€£]?\s*$/.test(prefix)) return [];
    const parsed = parseMatch(match);
    return parsed ? [parsed] : [];
  });
}

/** Preserve magnitude, currency, and percent markers when displaying or hashing quantities. */
export function extractNumbers(text: string): string[] {
  return parseQuantities(text).map((item) => item.token);
}

export function sameQuantity(left: Quantity, right: Quantity): boolean {
  if (left.percent !== right.percent) return false;
  if (left.currency && right.currency && left.currency !== right.currency) return false;
  return Math.abs(left.value - right.value) <= 1e-6 * Math.max(1, Math.abs(left.value));
}

export function excerptContainsStatementNumbers(statement: string, excerpt: string): boolean {
  const needed = parseQuantities(statement);
  if (!needed.length) return true;
  const found = parseQuantities(excerpt);
  return needed.every((need) => found.some((have) => sameQuantity(need, have)));
}

export function hasUnattributedNumber(text: string, allowedTexts: string[]): boolean {
  const allowed = allowedTexts.flatMap(parseQuantities);
  return parseQuantities(text).some((have) => !allowed.some((need) => sameQuantity(need, have)));
}

/** Job-board counters and directory chrome are not business facts. */
export function isInterfaceChrome(statement: string): boolean {
  return /\b\d+\s+jobs\b/i.test(statement) || /\bno jobs\b/i.test(statement);
}
