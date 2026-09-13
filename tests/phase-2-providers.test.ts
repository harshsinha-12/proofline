import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { MemoryRedis } from "./helpers/memory-redis";

const state = vi.hoisted(() => ({ redis: undefined as MemoryRedis | undefined, create: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/redis", async () => {
  const { MemoryRedis } = await import("./helpers/memory-redis"); state.redis = new MemoryRedis();
  return { getRedis: () => state.redis, redisKey: (...parts: string[]) => ["proofline:provider-test", ...parts].join(":") };
});
vi.mock("@/lib/env", () => ({ getEnv: () => ({ OPENAI_API_KEY: "test-key", SEARCH_PROVIDER: "openai", MAX_CONCURRENT_FETCHES: 3 }) }));
vi.mock("openai", () => ({ default: class {
  static APIError = class extends Error { status?: number };
  responses = { create: state.create };
} }));
vi.mock("@/providers/public-http", async (original) => ({ ...await original<typeof import("@/providers/public-http")>(), publicGet: state.get }));

import { requestStructured } from "@/providers/ai";
import { forKnownOrigins } from "@/prompts/source-authority";
import { validateOutput } from "@/prompts/validate-verification";
import { search } from "@/providers/search";
import { extractPage, fetchPage, fetchFailureReason, MAX_EXTRACTED_CHARACTERS } from "@/providers/fetch-page";
import { isPublicAddress, validatePublicUrl } from "@/providers/public-http";

beforeEach(() => { state.redis!.reset(); state.create.mockReset(); state.get.mockReset(); });

describe("Phase 2 providers", () => {
  const prompt = { purpose: "identity" as const, system: "Return JSON only.", inputSchema: z.object({ query: z.string() }), outputSchema: z.object({ name: z.string() }) };
  const response = (output: string) => ({ status: "completed", output_text: output, output: [], usage: { input_tokens: 10, output_tokens: 5 } });
  it("rejects a legacy cached fabricated quote and caches only a repaired exact quote", async () => {
    const contract = { purpose: "verification_one" as const, system: "Verify", inputSchema: z.object({ source: z.object({ textExcerpt: z.string() }) }), outputSchema: z.object({ verdict: z.string(), excerpt: z.string().nullable() }) };
    const input = { source: { textExcerpt: "Alex founded Example." } };
    state.create.mockResolvedValueOnce(response(JSON.stringify({ verdict: "supported", excerpt: "Alex leads Example." })));
    await requestStructured(contract, input);
    state.create.mockResolvedValueOnce(response(JSON.stringify({ verdict: "supported", excerpt: "Alex leads Example." }))).mockResolvedValueOnce(response(JSON.stringify({ verdict: "supported", excerpt: "Alex founded Example." })));
    const record = vi.fn();
    const checked = { ...contract, validateOutput };
    expect((await requestStructured(checked, input, { record })).excerpt).toBe("Alex founded Example.");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: "model_cache_rejected" }));
    await requestStructured(checked, input);
    expect(state.create).toHaveBeenCalledTimes(3);
    expect(() => validateOutput({ verdict: "no_evidence", excerpt: "Invented" }, input)).toThrow();
  });
  it("repairs an unknown authority origin before caching and reuses only the repaired result", async () => {
    const contract = { ...prompt, outputSchema: forKnownOrigins([]).outputSchema };
    const authority = { sourceAuthorityForClaim: "useful_but_insufficient", suspectedSharedOrigin: true, derivationNote: "Origin uncertain", reasoning: "Possibly supplied biography", sourceKind: "unknown", derivedFromSourceId: "invented-origin" };
    state.create.mockResolvedValueOnce(response(JSON.stringify(authority))).mockResolvedValueOnce(response(JSON.stringify({ ...authority, derivedFromSourceId: null })));
    expect((await requestStructured(contract, { query: "authority" })).derivedFromSourceId).toBeNull();
    expect((await requestStructured(contract, { query: "authority" })).suspectedSharedOrigin).toBe(true);
    expect(state.create).toHaveBeenCalledTimes(2);
  });
  it("limits authority origin references to supplied IDs", () => {
    const field = forKnownOrigins(["src_known"]).outputSchema.shape.derivedFromSourceId;
    expect(field.safeParse("src_known").success).toBe(true);
    expect(field.safeParse(null).success).toBe(true);
    expect(field.safeParse("https://publisher.example").success).toBe(false);
    expect(field.safeParse("src_unknown").success).toBe(false);
  });
  it("repairs malformed model JSON exactly once and records validation failure", async () => {
    state.create.mockResolvedValueOnce(response("{" )).mockResolvedValueOnce(response('{"name":"Alex"}'));
    const record = vi.fn();
    expect(await requestStructured(prompt, { query: "Alex" }, { record })).toEqual({ name: "Alex" });
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: "model_validation_failed" }));
  });
  it("throws a typed validation error after two bad responses", async () => {
    state.create.mockResolvedValue(response('{"wrong":"field"}'));
    await expect(requestStructured(prompt, { query: "Alex" })).rejects.toMatchObject({ code: "validation_failed", status: 422 });
    expect(state.create).toHaveBeenCalledTimes(2);
  });
  it("uses only tool-returned URLs and citations for OpenAI discovery and caches the result", async () => {
    state.create.mockResolvedValue({ status: "completed", output_text: "Invented summary URL https://fake.example", output: [
      { type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://public.example/about?utm_source=foo" }] } },
      { type: "message", content: [{ type: "output_text", annotations: [{ type: "url_citation", title: "Public page", url: "https://public.example/about" }] }] },
    ] });
    const request = { query: "Alex Example", maxResults: 3 };
    expect(await search(request)).toEqual([{ title: "https://public.example/about?utm_source=foo", url: "https://public.example/about", snippet: "" }]);
    await search(request);
    expect(state.create).toHaveBeenCalledTimes(1);
  });
  it("extracts bounded readable HTML and keeps source publication metadata", () => {
    const output = extractPage('<html><head><title>Public record</title><meta property="article:published_time" content="2026-09-12" /></head><body><main><p>' + "Public evidence. ".repeat(2_000) + "</p></main><script>SECRET SCRIPT</script></body></html>", "https://public.example/record");
    expect(output.title).toBe("Public record"); expect(output.textExcerpt!.length).toBeLessThanOrEqual(MAX_EXTRACTED_CHARACTERS);
    expect(output.textExcerpt).not.toContain("SECRET SCRIPT"); expect(output.publishedAt).toBe("2026-09-12");
  });
  it("fetches permitted pages once, caches extraction, and records access failures", async () => {
    state.get.mockResolvedValueOnce({ status: 200, body: "User-agent: *\nAllow: /" }).mockResolvedValueOnce({ status: 200,
      body: "<html><head><title>Record</title></head><body><main>Alex leads Example.</main></body></html>", contentType: "text/html", url: "https://public.example/record" });
    expect((await fetchPage("https://public.example/record")).fetchStatus).toBe("fetched");
    await fetchPage("https://public.example/record"); expect(state.get).toHaveBeenCalledTimes(2);
    state.get.mockResolvedValueOnce({ status: 404 }).mockResolvedValueOnce({ status: 403 });
    expect((await fetchPage("https://public.example/blocked")).fetchStatus).toBe("blocked");
  });
  it("records safe URL, phase, and DNS diagnostics without leaking raw errors", async () => {
    state.get.mockRejectedValue(Object.assign(new Error("secret provider details"), { code: "ENOTFOUND" }));
    const record = vi.fn();
    const page = await fetchPage("https://public.example/dns", { record });
    expect(page.notes.join(" ")).toContain("dns_failure");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ data: { attempt: 2, url: "https://public.example/dns", phase: "robots", reason: "dns_failure" } }));
    expect(JSON.stringify(record.mock.calls)).not.toContain("secret provider details");
    expect(fetchFailureReason(new Error("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))).toBe("timeout");
  });
  it("respects robots exclusions without requesting the page", async () => {
    state.get.mockResolvedValue({ status: 200, body: "User-agent: *\nDisallow: /" });
    expect((await fetchPage("https://public.example/private")).fetchStatus).toBe("blocked"); expect(state.get).toHaveBeenCalledTimes(1);
  });
  it("retries an extraction failure once and preserves the typed outcome", async () => {
    state.get.mockRejectedValue(new Error("TimeoutError"));
    expect((await fetchPage("https://public.example/timeout")).fetchStatus).toBe("timed_out"); expect(state.get).toHaveBeenCalledTimes(2);
  });
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1"])("blocks non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it("accepts public IPs and rejects unsafe URLs and LinkedIn extraction", async () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(() => validatePublicUrl("https://user:secret@public.example/")).toThrow();
    expect(() => validatePublicUrl("https://public.example:8443/")).toThrow();
    expect((await fetchPage("https://www.linkedin.com/in/alex")).fetchStatus).toBe("blocked");
    expect(state.get).not.toHaveBeenCalled();
  });
});
