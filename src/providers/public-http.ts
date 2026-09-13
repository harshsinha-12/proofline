import "server-only";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";
import { AppError } from "@/lib/errors";
import { requireRateLimit } from "@/lib/rate-limit";

export const USER_AGENT = "Proofline/0.1 (public evidence research; no login scraping)";
const MAX_PAGE_BYTES = 2_000_000;

export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === "unicast";
  } catch { return false; }
}

export function validatePublicUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new AppError("invalid_url", "A valid public HTTPS URL is required.", 400); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
    !hostname.includes(".") && !isIP(hostname) || isIP(hostname) && !isPublicAddress(hostname)) {
    throw new AppError("invalid_url", "Only public HTTPS evidence pages on the standard port can be fetched.", 400);
  }
  return url;
}

export type PublicResponse = { status: number; url: string; contentType: string; body: string };

async function resolveAddresses(hostname: string, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<LookupAddress[]>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    lookup(hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Resolve and pin public addresses for each connection, including every redirect hop. */
export async function publicGet(raw: string, signal = AbortSignal.timeout(10_000)): Promise<PublicResponse> {
  let url = validatePublicUrl(raw);
  for (let redirect = 0; redirect <= 3; redirect++) {
    await requireRateLimit("fetch");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolveAddresses(hostname, signal);
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) throw new AppError("invalid_url", "The evidence URL does not resolve exclusively to public addresses.", 400);
    const agent = new Agent({ connect: { lookup: (_hostname, options, callback) => {
      const filtered = options.family ? addresses.filter((entry) => entry.family === options.family) : addresses;
      if (!filtered.length) return callback(new Error("No public address for requested family."), "", 4);
      if (options.all) callback(null, filtered);
      else callback(null, filtered[0].address, filtered[0].family);
    } } });
    try {
      const response = await request(url, { dispatcher: agent, signal,
        headersTimeout: 10_000, bodyTimeout: 10_000, headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain", "Accept-Encoding": "identity" } });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.body.destroy();
        const location = response.headers.location;
        if (!location || Array.isArray(location)) throw new Error("Redirect has no valid location.");
        const next = validatePublicUrl(new URL(location, url).toString());
        if (next.origin !== url.origin) throw new AppError("invalid_url", "Cross-origin redirects require a separately discovered source URL.", 400);
        url = next;
        continue;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_PAGE_BYTES) { response.body.destroy(); throw new Error("Evidence page exceeds the extraction size budget."); }
        chunks.push(buffer);
      }
      return { status: response.statusCode, url: url.toString(), contentType: String(response.headers["content-type"] ?? ""), body: Buffer.concat(chunks).toString("utf8") };
    } finally { await agent.close(); }
  }
  throw new Error("Evidence page exceeded the redirect budget.");
}
