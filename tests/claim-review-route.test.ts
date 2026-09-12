import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { makeClaim } from "./helpers/fixtures";

vi.mock("@/lib/claim-store", () => ({ updateClaimReview: vi.fn() }));
import { updateClaimReview } from "@/lib/claim-store";
import { PATCH } from "@/app/api/research/[runId]/claims/[claimId]/route";

describe("claim review PATCH", () => {
  const context = { params: Promise.resolve({ runId: "run_a", claimId: "claim_a" }) };
  it("rejects malformed JSON before touching the ledger", async () => {
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: "{" }), context);
    expect(response.status).toBe(400);
  });
  it("returns the typed 409 when a partial claim is approved", async () => {
    vi.mocked(updateClaimReview).mockRejectedValueOnce(new AppError("approval_not_allowed", "Only verified claims can be approved.", 409));
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ decision: "approved" }) }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("approval_not_allowed");
  });
  it("returns a successful eligible review", async () => {
    vi.mocked(updateClaimReview).mockResolvedValueOnce(makeClaim({ status: "verified", humanDecision: "approved" }));
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ decision: "approved", note: "Reviewed" }) }), context);
    expect(response.status).toBe(200);
  });
});
