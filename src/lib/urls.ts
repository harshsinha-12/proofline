import { AppError } from "@/lib/errors";
import { sha256Hex } from "@/lib/hashing";

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gbraid",
  "gclid",
  "igsh",
  "igshid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "msclkid",
  "original_referer",
  "originalsubdomain",
  "pk_campaign",
  "pk_kwd",
  "ref",
  "ref_src",
  "ref_url",
  "si",
  "trk",
  "twclid",
  "wbraid",
  "yclid",
  "_hsenc",
  "_hsmi",
  "dclid",
  "gad_source",
  "gad_campaignid",
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

function hasScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AppError("invalid_url", "A URL is required.");
  }

  const withProtocol = hasScheme(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new AppError("invalid_url", "The URL could not be parsed.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError("invalid_url", "Only HTTP and HTTPS URLs are supported.");
  }

  const isLocal =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (!isLocal) {
    parsed.protocol = "https:";
  }

  parsed.username = "";
  parsed.password = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = "";

  if (parsed.port === "443" || parsed.port === "80") {
    parsed.port = "";
  }

  const kept = new URLSearchParams();
  const names = [...parsed.searchParams.keys()].sort();
  for (const name of names) {
    if (isTrackingParam(name)) {
      continue;
    }
    for (const value of parsed.searchParams.getAll(name)) {
      kept.append(name, value);
    }
  }
  parsed.search = kept.toString();

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

export function hashNormalizedUrl(raw: string): string {
  return sha256Hex(normalizeUrl(raw));
}

export function isLinkedInProfileUrl(raw: string): boolean {
  try {
    const url = new URL(normalizeUrl(raw));
    return (
      (url.hostname === "linkedin.com" ||
        url.hostname === "www.linkedin.com") &&
      url.pathname.startsWith("/in/")
    );
  } catch {
    return false;
  }
}
