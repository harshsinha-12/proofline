import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { makeDiagnostic } from "./helpers/fixtures";

vi.mock("@/pipeline/review-run", () => ({ generateReviewDiagnostic: vi.fn() }));
vi.mock("@/lib/diagnostic-store", async (original) => ({
  ...await original<typeof import("@/lib/diagnostic-store")>(),
  approveDiagnostic: vi.fn(),
}));

import { generateReviewDiagnostic } from "@/pipeline/review-run";
import { approveDiagnostic } from "@/lib/diagnostic-store";
import { POST as createRun } from "@/app/api/research/route";
import { POST as draftRoute } from "@/app/api/research/[runId]/diagnostic/route";
import { POST as approveRoute } from "@/app/api/research/[runId]/approve/route";

const context = { params: Promise.resolve({ runId: "run_a" }) };

describe("research intake POST", () => {
  it("rejects malformed JSON", async () => {
    const response = await createRun(new Request("http://localhost/api/research", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
  });
});

describe("diagnostic POST", () => {
  it("returns an insufficient fact set without fabricating a draft", async () => {
    vi.mocked(generateReviewDiagnostic).mockResolvedValueOnce({
      status: "insufficient_evidence",
      facts: [],
      reason: "At least three approved verified facts are required.",
    });
    const response = await draftRoute(new Request("http://localhost", { method: "POST", body: "{}" }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "insufficient_evidence" });
  });
  it("returns a drafted diagnostic", async () => {
    vi.mocked(generateReviewDiagnostic).mockResolvedValueOnce({ status: "ok", diagnostic: { ...makeDiagnostic(), reviewStatus: "draft" } });
    const response = await draftRoute(new Request("http://localhost", { method: "POST", body: "{}" }), context);
    expect(response.status).toBe(200);
    expect((await response.json()).diagnostic.reviewStatus).toBe("draft");
  });
});

describe("approve POST", () => {
  it("requires confirmation and a reviewer name", async () => {
    const response = await approveRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify({ confirmation: false }) }), context);
    expect(response.status).toBe(400);
  });
  it("returns 409 when approval is not allowed", async () => {
    vi.mocked(approveDiagnostic).mockRejectedValueOnce(new AppError("approval_not_allowed", "Generate a draft first.", 409));
    const response = await approveRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmation: true, reviewerName: "Harsh Sinha" }),
    }), context);
    expect(response.status).toBe(409);
  });
});
