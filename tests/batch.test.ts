import { describe, expect, it, vi } from "vitest";
import { batchServices, serialQueue } from "@/pipeline/batch";
import type { PipelineServices } from "@/pipeline/shared";

describe("batch scheduling", () => {
  it("deduplicates simultaneous searches and page requests and serializes each host", async () => {
    let active = 0; let peak = 0;
    const fetchPage = vi.fn(async (url: string) => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { url, title: url, fetchStatus: "fetched" as const, retrievedAt: new Date().toISOString(), notes: [] };
    });
    const search = vi.fn(async () => []);
    const services = batchServices({ search, fetchPage, requestStructured: vi.fn() } as PipelineServices);
    const request = { query: "same query", maxResults: 2 };
    await Promise.all([services.search(request), services.search(request), services.fetchPage("https://example.com/a"), services.fetchPage("https://example.com/a"), services.fetchPage("https://example.com/b")]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });
  it("keeps writes ordered and continues after a failed write", async () => {
    const queue = serialQueue(); const order: number[] = [];
    const results = await Promise.allSettled([queue(async () => { await Promise.resolve(); order.push(1); throw new Error("failed"); }), queue(async () => { order.push(2); })]);
    expect(order).toEqual([1, 2]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
  });
});
