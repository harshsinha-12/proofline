import "server-only";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { load } from "cheerio";
import pLimit from "p-limit";
import robotsParser from "robots-parser";
import { AppError } from "@/lib/errors";
import { hashNormalizedUrl } from "@/lib/urls";
import { getEnv } from "@/lib/env";
import { readCache, writeCache } from "@/providers/cache";
import { publicGet, validatePublicUrl, USER_AGENT } from "@/providers/public-http";
import { pageResultSchema, type PageResult, type ProviderContext } from "@/providers/types";

export const MAX_EXTRACTED_CHARACTERS = 12_000;
let fetchLimit: ReturnType<typeof pLimit> | undefined;

export function extractPage(html: string, url: string): Pick<PageResult, "title" | "textExcerpt" | "publishedAt"> {
  const $ = load(html);
  const publishedAt = $('meta[property="article:published_time"]').attr("content");
  const title = $("title").text().trim();
  $("script,style,noscript,nav,footer,header,form,iframe").remove();
  const dom = new JSDOM($.html(), { url });
  try {
    const article = new Readability(dom.window.document).parse();
    const text = (article?.textContent || $("main,article").text() || $("body").text()).replace(/\s+/g, " ").trim();
    return { title: article?.title || title || url, textExcerpt: text.slice(0, MAX_EXTRACTED_CHARACTERS),
      ...(publishedAt && Number.isFinite(Date.parse(publishedAt)) ? { publishedAt } : {}) };
  } finally { dom.window.close(); }
}

export function fetchFailureReason(error: unknown): string {
  const failure = error instanceof Error ? error : undefined;
  const cause = failure?.cause as { code?: string } | undefined;
  const code = cause?.code ?? (failure as Error & { code?: string } | undefined)?.code;
  if (code && /ENOTFOUND|EAI_AGAIN/.test(code)) return "dns_failure";
  if (/timeout|abort/i.test((failure?.name ?? "") + (failure?.message ?? "")) || code?.includes("TIMEOUT")) return "timeout";
  if (code && /ECONN|ENET|EHOST|UND_ERR_SOCKET/.test(code)) return "connection_failure";
  if (code && /CERT|TLS|SSL/.test(code)) return "tls_failure";
  if (failure?.message.includes("no readable")) return "empty_content";
  if (failure?.message.includes("size budget")) return "size_limit";
  return "request_or_extraction_failure";
}

export async function fetchPage(raw: string, context: ProviderContext = {}): Promise<PageResult> {
  const initial: PageResult = { url: raw, title: raw, fetchStatus: "failed", retrievedAt: new Date().toISOString(), notes: [] };
  let url: URL;
  try { url = validatePublicUrl(raw); }
  catch { return { ...initial, fetchStatus: "blocked", notes: ["URL is not an allowed public HTTPS evidence page."] }; }
  if (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) {
    return { ...initial, fetchStatus: "blocked", notes: ["LinkedIn is used as an identity input only. No LinkedIn page scraping is performed."] };
  }
  const hash = hashNormalizedUrl(raw);
  const cached = await readCache("page", hash, pageResultSchema);
  if (cached) {
    await context.record?.({ type: "page_cache_hit", message: "Reused cached page extraction.", data: { cacheHit: true, url: url.toString() } });
    return cached;
  }
  fetchLimit ??= pLimit(Math.min(3, getEnv().MAX_CONCURRENT_FETCHES));
  return fetchLimit(async () => {
    const deadline = Date.now() + 25_000;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let phase = "robots";
      try {
        await context.record?.({ type: "page_fetch_started", message: "Checking robots.txt before fetching this public page.", data: { attempt, url: url.toString(), robotsUrl: new URL("/robots.txt", url).toString() } });
        const signal = AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now())));
        const robotsUrl = new URL("/robots.txt", url).toString();
        const robots = await publicGet(robotsUrl, signal);
        if (robots.status !== 404 && (robots.status !== 200 || robotsParser(robotsUrl, robots.body).isAllowed(url.toString(), USER_AGENT) !== true)) {
          return { ...initial, fetchStatus: "blocked", notes: ["Public access policy could not be established or robots.txt disallows extraction."] };
        }
        phase = "page";
        await context.record?.({ type: "page_request_started", message: "Fetching public page HTML.", data: { attempt, url: url.toString() } });
        const response = await publicGet(url.toString(), signal);
        if ([401, 403, 429].includes(response.status)) return { ...initial, fetchStatus: "blocked", notes: ["Page access is restricted. No bypass was attempted."] };
        if (response.status === 404 || response.status === 410) return { ...initial, fetchStatus: "not_found", notes: ["Public page was not found."] };
        if (response.status !== 200) throw new Error(`Public page request failed (HTTP ${response.status}).`);
        if (!/text\/html|application\/xhtml\+xml/.test(response.contentType)) return { ...initial, fetchStatus: "unsupported", notes: ["Only HTML pages are supported for evidence extraction."] };
        phase = "extraction";
        const extracted = extractPage(response.body, response.url);
        if (!extracted.textExcerpt) throw new Error("Page had no readable evidence text.");
        const result: PageResult = { ...initial, ...extracted, fetchStatus: "fetched", notes: response.url !== raw ? ["Followed a same-origin public redirect."] : [] };
        await writeCache("page", hash, result);
        await context.record?.({ type: "page_fetched", message: "Extracted bounded public-page text.", data: { attempt, url: response.url, requestedUrl: url.toString() } });
        return result;
      } catch (error) {
        if (error instanceof AppError) {
          if (error.code === "invalid_url") return { ...initial, fetchStatus: "blocked", notes: [error.safeMessage] };
          throw error;
        }
        const reason = fetchFailureReason(error);
        await context.record?.({ type: "page_fetch_failed", message: `Public page ${phase} failed (${reason}).`, data: { attempt, url: url.toString(), phase, reason } });
        if (attempt === 2) return { ...initial, fetchStatus: reason === "timeout" ? "timed_out" : "failed", notes: [`Public page ${phase} failed (${reason}) after one retry; failure remains in the source ledger.`] };
      }
    }
    return initial;
  });
}
