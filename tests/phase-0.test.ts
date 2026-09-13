import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { hashQuery } from "@/lib/hashing";
import { claimIdFromStatement, sourceIdFromCanonicalUrl } from "@/lib/ids";
import {
  getModelRequest,
  getOpenAIModel,
  OPENAI_MODEL,
} from "@/lib/model-config";
import { hashNormalizedUrl, isLinkedInProfileUrl, normalizeUrl } from "@/lib/urls";
import { claimSchema, type Claim } from "@/schemas/claim";

const redisEnv = {
  REDIS_USERNAME: "default",
  REDIS_PASSWORD: "secret",
  REDIS_HOST: "redis.example.com",
  REDIS_PORT: "6379",
};

describe("parseEnv", () => {
  it("rejects a missing REDIS_HOST", () => {
    expect(() =>
      parseEnv({
        ...redisEnv,
        REDIS_HOST: undefined,
      }),
    ).toThrow();
  });

  it("parses Redis TCP credentials and applies defaults", () => {
    const env = parseEnv(redisEnv);
    expect(env.REDIS_HOST).toBe("redis.example.com");
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.REDIS_KEY_PREFIX).toBe("proofline:dev");
    expect(env.SEARCH_PROVIDER).toBe("openai");
  });

  it("does not read a model id from the environment", () => {
    const env = parseEnv({
      ...redisEnv,
      OPENAI_MODEL: "gpt-4.1",
    });
    expect("OPENAI_MODEL" in env).toBe(false);
  });
});

describe("model config", () => {
  it("uses GPT 5.5 for every purpose", () => {
    expect(OPENAI_MODEL).toBe("gpt-5.5");
    expect(getOpenAIModel("identity")).toBe("gpt-5.5");
    expect(getOpenAIModel("diagnostic_writer")).toBe("gpt-5.5");
    expect(getModelRequest("verification_one").model).toBe("gpt-5.5");
  });
});

describe("URL normalization", () => {
  it("strips tracking params, fragments, and trailing slashes", () => {
    expect(
      normalizeUrl(
        "https://WWW.LinkedIn.com/in/example/?utm_source=google&trk=public#about",
      ),
    ).toBe("https://www.linkedin.com/in/example");
  });

  it("hashes two URLs that differ only by utm_source to the same value", () => {
    const a = "https://www.stake.com/about?utm_source=twitter";
    const b = "https://www.stake.com/about?utm_source=linkedin";
    expect(hashNormalizedUrl(a)).toBe(hashNormalizedUrl(b));
    expect(hashNormalizedUrl(a)).toHaveLength(64);
  });

  it("accepts public LinkedIn profile URLs", () => {
    expect(
      isLinkedInProfileUrl("https://www.linkedin.com/in/example-person"),
    ).toBe(true);
    expect(isLinkedInProfileUrl("https://example.com/in/example")).toBe(false);
  });
});

describe("hashing and ids", () => {
  it("hashes equivalent queries after whitespace normalization", () => {
    expect(hashQuery("Manar Mahmassani Stake")).toBe(
      hashQuery("  manar   mahmassani   stake "),
    );
  });

  it("creates deterministic source and claim ids", () => {
    const url = "https://www.stake.com/about";
    expect(sourceIdFromCanonicalUrl(url)).toBe(sourceIdFromCanonicalUrl(url));
    expect(claimIdFromStatement("sub_1", "Stake was founded in 2020.")).toBe(
      claimIdFromStatement("sub_1", "Stake was founded in 2020."),
    );
  });
});

describe("claim schema", () => {
  const validClaim: Claim = {
    id: "clm_abc",
    subjectId: "sub_1",
    statement: "Manar Mahmassani currently serves as Co-CEO of Stake.",
    category: "role",
    materiality: "high",
    containsNumber: false,
    timeSensitive: true,
    asOfDate: "2026-09-12",
    originSourceIds: ["src_1"],
    status: "verified",
    statusReason:
      "Check 1 and check 2 independently support the exact claim with a qualifying source.",
    humanDecision: "pending",
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };

  it("parses a valid verified claim", () => {
    expect(claimSchema.parse(validClaim).status).toBe("verified");
  });

  it("rejects a claim missing statusReason", () => {
    const invalid = { ...validClaim, statusReason: undefined };
    expect(claimSchema.safeParse(invalid).success).toBe(false);
  });
});
