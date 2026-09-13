import type { Source, SourceKind } from "@/schemas/source";

export const PRIMARY_SOURCE_KINDS = new Set<SourceKind>([
  "regulator_or_government",
  "company_first_party",
  "subject_first_party",
  "institutional_first_party",
]);

export function isPrimarySourceKind(kind: SourceKind): boolean {
  return PRIMARY_SOURCE_KINDS.has(kind);
}

export function isSubjectCompanyHost(url: string, organization?: string): boolean {
  const needle = organization?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  if (needle.length < 4) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const nameLabels = host.split(".").slice(0, -1);
    const compact = nameLabels.join("").replace(/[^a-z0-9]/g, "");
    return compact.includes(needle) || nameLabels.some((label) => {
      const normalized = label.replace(/[^a-z0-9]/g, "");
      return normalized === needle || normalized.endsWith(needle) || normalized.startsWith(needle);
    });
  } catch {
    return false;
  }
}

export function stabilizeSourceKind(source: Source, organization?: string): SourceKind {
  if (source.sourceKind === "regulator_or_government") return source.sourceKind;
  if (isSubjectCompanyHost(source.canonicalUrl || source.url, organization)) return "company_first_party";
  return source.sourceKind;
}

export function preservePageSourceKind(
  current: SourceKind,
  proposed: SourceKind,
  url: string,
  organization?: string,
): SourceKind {
  if (current === "regulator_or_government") return current;
  if (isSubjectCompanyHost(url, organization) && proposed !== "regulator_or_government") return "company_first_party";
  if (current !== "unknown") return current;
  return proposed;
}
