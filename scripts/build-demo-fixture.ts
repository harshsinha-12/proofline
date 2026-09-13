import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyClaim } from "../src/pipeline/classify-claims";
import { auditDiagnostic, isEligibleClaim, MAX_DIAGNOSTIC_WORDS } from "../src/lib/diagnostic-audit";
import { parseDemoFixture } from "../src/lib/demo-fixture";
import { DEMO_COMPANY_HINT, DEMO_LINKEDIN_URL, DEMO_NAME_HINT, DEMO_RUN_ID } from "../src/lib/demo";
import { hashContent } from "../src/lib/hashing";
import { claimIdFromStatement, checkId, eventId, gapId, sourceIdFromCanonicalUrl } from "../src/lib/ids";
import { normalizeUrl } from "../src/lib/urls";
import { redactSecrets } from "../src/lib/errors";
import { sanitizeEventData } from "../src/lib/store-utils";
import type { Claim } from "../src/schemas/claim";
import type { Source } from "../src/schemas/source";
import type { VerificationCheck } from "../src/schemas/verification";
import type { Diagnostic } from "../src/schemas/diagnostic";
import type { ExecutionEvent, ResearchRun } from "../src/schemas/run";

const RETRIEVED = "2026-09-13T04:08:00.000Z";
const CHECKED = "2026-09-13T04:12:00.000Z";
const APPROVED = "2026-09-13T04:18:00.000Z";
const SUBJECT_ID = `sub_3a1836bcb4348765`;

function sourceId(url: string) {
  return sourceIdFromCanonicalUrl(normalizeUrl(url));
}

function check(
  claim: Claim,
  pass: 1 | 2,
  source: Source,
  excerpt: string,
  extras: Partial<VerificationCheck> = {},
): VerificationCheck {
  return {
    id: checkId(claim.id, pass),
    pass,
    verdict: "supported",
    evidence: [{
      sourceId: source.id, url: source.url, title: source.title, excerpt, supportsExactly: claim.statement,
    }],
    sourceAuthorityForClaim: "qualifying",
    independenceFromOtherCheck: "independent",
    reasoning: "The cited excerpt is present on the fetched page and supports the atomic wording.",
    limitations: [],
    checkedAt: CHECKED,
    ...extras,
  };
}

async function main() {
  const evidenceDir = path.join(process.cwd(), "fixtures/evidence");
  const artifact = JSON.parse(await readFile(path.join(process.cwd(), "artifacts/phase-2-vertical-slice.json"), "utf8")) as {
    sources: Source[];
  };
  const nationalExcerpt = artifact.sources.find((source) => source.fetchStatus === "fetched")?.textExcerpt?.trim();
  if (!nationalExcerpt) throw new Error("National excerpt missing from the Phase 2 artifact.");
  const webinarExcerpt = (await readFile(path.join(evidenceDir, "stake-webinar-20260520.txt"), "utf8")).trim();
  const aboutExcerpt = (await readFile(path.join(evidenceDir, "stake-about-20241003.txt"), "utf8")).trim();
  const sefExcerpt = (await readFile(path.join(evidenceDir, "sef-manar-mahmassani.txt"), "utf8")).trim();

  const nationalUrl = "https://www.thenationalnews.com/business/money/how-to-jump-on-the-uae-s-property-ladder-through-crowdfunding-1.1199391";
  const webinarArchiveUrl = "https://web.archive.org/web/20260520221355/https://getstake.com/webinars/ask-me-anything-with-stake-s-founders";
  const aboutArchiveUrl = "https://web.archive.org/web/20241003230710/https://getstake.com/about-us";
  const aboutLiveUrl = "https://getstake.com/about-us";
  const webinarLiveUrl = "https://getstake.com/webinars/ask-me-anything-with-stake-s-founders";
  const crunchbaseUrl = "https://www.crunchbase.com/person/manar-mahmassani-mahmassani";
  const sefUrl = "https://sharjahef.com/speakers/manar-mahmassani";
  const pdfUrl = "https://cdn.getstake.com/www.getstake.com/Stake_Investor_Report_2025.pdf";

  const national: Source = {
    id: sourceId(nationalUrl), url: nationalUrl, canonicalUrl: normalizeUrl(nationalUrl),
    title: "How to jump on the UAE's property ladder through crowdfunding | The National",
    publisher: "The National", retrievedAt: "2026-09-12T18:40:57.811Z", fetchStatus: "fetched",
    sourceKind: "reputable_secondary", textExcerpt: nationalExcerpt, contentHash: hashContent(nationalExcerpt),
    discoveryQuery: `${DEMO_LINKEDIN_URL} ${DEMO_NAME_HINT} ${DEMO_COMPANY_HINT} identity current company founder`,
    isPublic: true, notes: ["Fetched during the live Phase 2 slice."],
  };
  const webinar: Source = {
    id: sourceId(webinarArchiveUrl), url: webinarArchiveUrl, canonicalUrl: normalizeUrl(webinarArchiveUrl),
    title: "Stake | Ask me Anything with Stake's Founders",
    publisher: "Stake", retrievedAt: RETRIEVED, fetchStatus: "fetched", sourceKind: "company_first_party",
    textExcerpt: webinarExcerpt, contentHash: hashContent(webinarExcerpt),
    discoveryQuery: "site:getstake.com Manar Mahmassani Rami Tabbara leadership team Stake",
    isPublic: true,
    notes: ["Live getstake.com timed out. Excerpt is from a public Wayback Machine snapshot of Stake's own webinar page."],
  };
  const aboutArchive: Source = {
    id: sourceId(aboutArchiveUrl), url: aboutArchiveUrl, canonicalUrl: normalizeUrl(aboutArchiveUrl),
    title: "Learn about Stake - The leading real estate investment platform in Dubai and the Middle East",
    publisher: "Stake", retrievedAt: RETRIEVED, fetchStatus: "fetched", sourceKind: "company_first_party",
    textExcerpt: aboutExcerpt, contentHash: hashContent(aboutExcerpt),
    discoveryQuery: "site:getstake.com Manar Mahmassani Stake co-founder biography leadership",
    isPublic: true,
    notes: ["Live getstake.com timed out. This archived About page describes the company and does not name the subject."],
  };
  const aboutLive: Source = {
    id: sourceId(aboutLiveUrl), url: aboutLiveUrl, canonicalUrl: normalizeUrl(aboutLiveUrl),
    title: aboutLiveUrl, retrievedAt: RETRIEVED, fetchStatus: "timed_out", sourceKind: "company_first_party",
    discoveryQuery: "site:getstake.com Manar Mahmassani Stake co-founder biography leadership",
    isPublic: true, notes: ["Extraction failed after one retry; failure remains in the source ledger."],
  };
  const webinarLive: Source = {
    id: sourceId(webinarLiveUrl), url: webinarLiveUrl, canonicalUrl: normalizeUrl(webinarLiveUrl),
    title: webinarLiveUrl, retrievedAt: RETRIEVED, fetchStatus: "timed_out", sourceKind: "company_first_party",
    discoveryQuery: "site:getstake.com Manar Mahmassani Rami Tabbara leadership team Stake",
    isPublic: true, notes: ["Extraction failed after one retry; failure remains in the source ledger."],
  };
  const crunchbase: Source = {
    id: sourceId(crunchbaseUrl), url: crunchbaseUrl, canonicalUrl: normalizeUrl(crunchbaseUrl),
    title: crunchbaseUrl, retrievedAt: "2026-09-12T18:41:14.000Z", fetchStatus: "blocked", sourceKind: "other_secondary",
    discoveryQuery: `"${DEMO_NAME_HINT}" Stake founder`,
    isPublic: true, notes: ["Page access is restricted. No bypass was attempted."],
  };
  const sef: Source = {
    id: sourceId(sefUrl), url: sefUrl, canonicalUrl: normalizeUrl(sefUrl),
    title: "SEF26", publisher: "Sharjah Entrepreneurship Festival", retrievedAt: RETRIEVED,
    fetchStatus: "fetched", sourceKind: "other_secondary", textExcerpt: sefExcerpt, contentHash: hashContent(sefExcerpt),
    suspectedOriginId: webinar.id,
    discoveryQuery: `"${DEMO_NAME_HINT}" Stake co-founder`,
    isPublic: true,
    notes: ["Speaker biography repeats first-party career-volume language; treated as derived rather than independent confirmation."],
  };
  const pdf: Source = {
    id: sourceId(pdfUrl), url: pdfUrl, canonicalUrl: normalizeUrl(pdfUrl),
    title: pdfUrl, retrievedAt: "2026-09-12T18:41:20.000Z", fetchStatus: "timed_out", sourceKind: "unknown",
    discoveryQuery: "site:getstake.com Manar Mahmassani Stake",
    isPublic: true, notes: ["PDF extraction is unsupported; the live fetch also timed out."],
  };
  const sources = [national, webinar, aboutArchive, aboutLive, webinarLive, crunchbase, sef, pdf];

  const required = {
    nationalName: "Manar Mahmassani and Rami Tabbara, co-founders of digital real estate investment and asset management company Stake",
    webinarManar: "Manar MahmassaniCo-Founder & Co-CEO",
    webinarRami: "Rami TabbaraCo-Founder & Co-CEO",
    webinarVolume: "During his career, Manar executed over $6bn of transactions for corporates, family offices, quasi-sovereigns, and financial institutions.",
  };
  for (const [label, excerpt] of Object.entries({ nationalName: required.nationalName, webinarManar: required.webinarManar, webinarRami: required.webinarRami, webinarVolume: required.webinarVolume })) {
    const haystack = label.startsWith("national") ? nationalExcerpt : webinarExcerpt;
    if (!haystack.includes(excerpt)) throw new Error(`Missing evidence substring: ${label}`);
  }

  function baseClaim(statement: string, category: Claim["category"], materiality: Claim["materiality"], extras: Partial<Claim> = {}): Claim {
    const id = claimIdFromStatement(SUBJECT_ID, statement);
    return {
      id, subjectId: SUBJECT_ID, statement, category, materiality, containsNumber: false, timeSensitive: false,
      originSourceIds: [webinar.id, national.id], status: "pending", statusReason: "Awaiting classification.",
      humanDecision: "pending", createdAt: CHECKED, updatedAt: APPROVED, ...extras,
    };
  }

  const identityDraft = baseClaim("The researched subject is Manar Mahmassani.", "identity", "high");
  const roleDraft = baseClaim("Manar Mahmassani is a co-founder of Stake.", "role", "high");
  const companyDraft = baseClaim("Rami Tabbara is a co-founder of Stake.", "company", "medium");
  const titleDraft = baseClaim("Manar Mahmassani is Co-CEO of Stake.", "role", "high");
  const volumeDraft = baseClaim("During his career, Manar Mahmassani executed over $6bn of transactions.", "performance", "high", { containsNumber: true });

  const identity: Claim = {
    ...identityDraft,
    check1: check(identityDraft, 1, webinar, required.webinarManar, { reasoning: "Stake's own speaker page names Manar Mahmassani." }),
    check2: check(identityDraft, 2, national, required.nationalName, { reasoning: "Independent newspaper coverage names Manar Mahmassani as a Stake co-founder." }),
  };
  const role: Claim = {
    ...roleDraft,
    check1: check(roleDraft, 1, webinar, required.webinarManar, { reasoning: "Stake's own page lists Manar Mahmassani as Co-Founder." }),
    check2: check(roleDraft, 2, national, required.nationalName, { reasoning: "The National independently describes Manar Mahmassani as a co-founder of Stake." }),
  };
  const company: Claim = {
    ...companyDraft,
    check1: check(companyDraft, 1, webinar, required.webinarRami, { reasoning: "Stake's own page lists Rami Tabbara as Co-Founder." }),
    check2: check(companyDraft, 2, national, required.nationalName, { reasoning: "The National independently describes Rami Tabbara as a co-founder of Stake." }),
  };
  const title: Claim = {
    ...titleDraft,
    originSourceIds: [webinar.id],
    check1: check(titleDraft, 1, webinar, required.webinarManar, { reasoning: "Stake's own page uses the Co-CEO title." }),
    check2: {
      id: checkId(titleDraft.id, 2), pass: 2, verdict: "no_evidence", evidence: [], sourceAuthorityForClaim: "not_qualifying",
      independenceFromOtherCheck: "independent", reasoning: "The accessible independent newspaper extract confirms co-founder, not Co-CEO.",
      limitations: ["The independent secondary extract does not confirm the Co-CEO title."], checkedAt: CHECKED,
    },
  };
  const volume: Claim = {
    ...volumeDraft,
    originSourceIds: [webinar.id, sef.id],
    check1: check(volumeDraft, 1, webinar, required.webinarVolume, {
      reasoning: "Stake's own page states the career transaction volume.",
    }),
    check2: {
      id: checkId(volumeDraft.id, 2), pass: 2, verdict: "no_evidence", evidence: [], sourceAuthorityForClaim: "not_qualifying",
      independenceFromOtherCheck: "possibly_derived",
      reasoning: "The independent newspaper extract does not contain the volume figure. The event biography repeats the same first-party language and is not an independent check.",
      limitations: ["No independent source confirmed the quantitative career-volume figure."], checkedAt: CHECKED,
    },
  };

  const classified = [identity, role, company, title, volume].map((claim) => {
    const result = classifyClaim(claim, { sources });
    const humanDecision = result.status === "verified" ? "approved" as const : "excluded" as const;
    const humanNote = result.status === "verified"
      ? "Approved from first-party archive plus independent newspaper support."
      : "Excluded because the second check could not independently confirm the exact wording.";
    return { ...claim, ...result, humanDecision, humanNote };
  });

  const expectedStatus = { [identity.id]: "verified", [role.id]: "verified", [company.id]: "verified", [title.id]: "partially_verified", [volume.id]: "partially_verified" };
  for (const claim of classified) {
    if (claim.status !== expectedStatus[claim.id]) {
      throw new Error(`${claim.statement} classified as ${claim.status}: ${claim.statusReason}`);
    }
  }

  const approved = classified.filter(isEligibleClaim);
  const diagnostic: Diagnostic = {
    subjectName: DEMO_NAME_HINT,
    roleLine: "Co-founder of Stake",
    generatedAt: APPROVED,
    currentPositioning: "Public coverage identifies Manar Mahmassani as a co-founder of Stake, with co-founder Rami Tabbara. Later titles and performance figures are not independently confirmed.",
    credibilitySignals: [
      { text: "Public sources identify the subject as Manar Mahmassani.", claimIds: [identity.id] },
      { text: "Manar Mahmassani is a co-founder of Stake.", claimIds: [role.id] },
      { text: "Stake has a second named co-founder, Rami Tabbara.", claimIds: [company.id] },
    ],
    gaps: [
      {
        id: gapId(DEMO_RUN_ID, 0), title: "Title beyond co-founder is unconfirmed",
        observation: "Company pages use a broader leadership title. The independent newspaper extract confirms co-founder only.",
        whyItMatters: "Upgrading the title in client copy would outrun the independent record.",
        recommendation: "Keep the public line at co-founder until a second independent source confirms any later title.",
        supportingClaimIds: [role.id], sampledSourceIds: [webinar.id, national.id],
        limitation: "This sample cannot prove a broader title is false, only that it is unconfirmed.",
      },
      {
        id: gapId(DEMO_RUN_ID, 1), title: "Career volume is first-party only",
        observation: "A career-volume figure appears on Stake's page and is repeated on an event biography. The newspaper extract does not contain it.",
        whyItMatters: "Repeating a first-party number as audited evidence would overstate the record.",
        recommendation: "Omit the volume figure until a qualifying independent record confirms it.",
        supportingClaimIds: [role.id], sampledSourceIds: [webinar.id, national.id],
        limitation: "Absence from this sample is not proof that no independent record exists.",
      },
      {
        id: gapId(DEMO_RUN_ID, 2), title: "Live first-party pages often failed",
        observation: "Live Stake pages timed out. Crunchbase was blocked. LinkedIn was not scraped. Working first-party evidence came from a public archive.",
        whyItMatters: "Hiding fetch failures would make the diagnostic look more complete than the collection was.",
        recommendation: "Keep timeouts visible and treat archived company pages as retrieved copies.",
        supportingClaimIds: [identity.id, role.id], sampledSourceIds: [aboutLive.id],
        limitation: "A timeout does not distinguish a down site from a blocked path.",
      },
    ],
    narrativeOpportunity: "The defensible line is the co-founder role at Stake with Rami Tabbara. Keep later titles and performance numbers out until independent records confirm them.",
    integritySummary: { evaluated: classified.length, verified: 3, partiallyVerified: 2, unverified: 0, rejected: 0, conflicts: 0 },
    citationClaimIds: [identity.id, role.id, company.id],
    reviewStatus: "approved",
  };

  const audit = auditDiagnostic(diagnostic, approved);
  if (!audit.valid) throw new Error(audit.issues.join(" "));

  const events: ExecutionEvent[] = [
    { id: eventId(DEMO_RUN_ID, 1), at: "2026-09-12T18:39:54.987Z", stage: "created", type: "stage_checkpoint", message: "Saved a bounded pipeline checkpoint.", data: { previousStage: "created", stage: "resolving_identity" } },
    { id: eventId(DEMO_RUN_ID, 2), at: "2026-09-12T18:40:06.590Z", stage: "resolving_identity", type: "search_completed", message: "Public source discovery completed.", data: { query: `${DEMO_LINKEDIN_URL} ${DEMO_NAME_HINT} Stake identity`, count: 3, latencyMs: 8931 } },
    { id: eventId(DEMO_RUN_ID, 3), at: "2026-09-12T18:41:14.944Z", stage: "resolving_identity", type: "source_unavailable", message: "LinkedIn is used as an identity input only.", data: { sourceId: "linkedin_input" } },
    { id: eventId(DEMO_RUN_ID, 4), at: RETRIEVED, stage: "extracting_sources", type: "source_unavailable", message: "Live first-party page timed out.", data: { sourceId: aboutLive.id } },
    { id: eventId(DEMO_RUN_ID, 5), at: RETRIEVED, stage: "extracting_sources", type: "source_unavailable", message: "Page access is restricted. No bypass was attempted.", data: { sourceId: crunchbase.id } },
    { id: eventId(DEMO_RUN_ID, 6), at: CHECKED, stage: "extracting_sources", type: "page_cache_hit", message: "Reused cached page extraction.", data: { cacheHit: true, sourceId: national.id } },
    { id: eventId(DEMO_RUN_ID, 7), at: CHECKED, stage: "classifying_claims", type: "stage_checkpoint", message: "Saved a bounded pipeline checkpoint.", data: { previousStage: "classifying_claims", stage: "analyzing_gaps" } },
    { id: eventId(DEMO_RUN_ID, 8), at: APPROVED, stage: "approved", type: "diagnostic_approved", message: "An immutable approved snapshot was stored.", data: { stage: "approved" } },
  ];
  for (const event of events) {
    if (JSON.stringify(event.data) !== JSON.stringify(sanitizeEventData(event.data))) {
      throw new Error(`Event ${event.id} has unsanitized data.`);
    }
  }

  const run: ResearchRun = {
    id: DEMO_RUN_ID,
    linkedInUrl: DEMO_LINKEDIN_URL,
    stage: "approved",
    subject: {
      fullName: DEMO_NAME_HINT,
      currentRole: "co-founder",
      organization: DEMO_COMPANY_HINT,
      canonicalLinkedInUrl: DEMO_LINKEDIN_URL,
      aliases: [],
      identityEvidence: [
        { sourceId: webinar.id, url: webinar.url, title: webinar.title, excerpt: required.webinarManar, supportsExactly: identity.statement },
        { sourceId: national.id, url: national.url, title: national.title, excerpt: required.nationalName, supportsExactly: identity.statement },
      ],
      ambiguityNotes: [],
    },
    createdAt: "2026-09-12T18:39:51.528Z",
    updatedAt: APPROVED,
    completedAt: APPROVED,
    approvedAt: APPROVED,
    approvedBy: "Harsh Sinha",
    progress: {
      sourcesDiscovered: sources.length,
      sourcesFetched: sources.filter((source) => source.fetchStatus === "fetched").length,
      claimsExtracted: classified.length,
      checksCompleted: classified.length * 2,
      verifiedClaims: 3,
      excludedClaims: 2,
    },
    warnings: [
      { code: "linkedin_not_fetched", message: "Identity was resolved from public sources; LinkedIn was not scraped.", createdAt: "2026-09-12T18:41:14.944Z" },
      { code: "source_timed_out", message: "Live getstake.com pages timed out. Archived first-party HTML was used where a public snapshot existed.", createdAt: RETRIEVED },
      { code: "source_blocked", message: "Crunchbase was blocked. No access bypass was attempted.", createdAt: RETRIEVED },
    ],
    completedStageKeys: [
      "run:started", "identity:resolved", "research:plan", "discovery:complete", "sources:complete",
      "claims:complete", "check1:complete", "adversarial:complete", "check2:complete",
      "classification:complete", "gaps:deferred_to_review", "draft:deferred_to_review",
    ],
    diagnostic,
    hints: { name: DEMO_NAME_HINT, company: DEMO_COMPANY_HINT },
    identityStatus: "resolved",
    identityFieldEvidence: {
      fullName: [webinar.id, national.id],
      currentRole: [webinar.id, national.id],
      organization: [webinar.id, national.id],
      location: [],
    },
    gaps: diagnostic.gaps,
  };

  const payload = { run, sources, claims: classified, events };
  const parsed = parseDemoFixture(payload);
  if (!parsed) throw new Error("parseDemoFixture rejected the generated payload.");
  if (redactSecrets(JSON.stringify(payload)) !== JSON.stringify(payload)) throw new Error("Fixture contains a secret pattern.");
  const wordCount = [diagnostic.subjectName, diagnostic.roleLine, diagnostic.currentPositioning,
    ...diagnostic.credibilitySignals.map((signal) => signal.text),
    ...diagnostic.gaps.flatMap((gap) => [gap.title, gap.observation, gap.whyItMatters, gap.recommendation, gap.limitation]),
    diagnostic.narrativeOpportunity].join(" ").trim().split(/\s+/).length;
  if (wordCount > MAX_DIAGNOSTIC_WORDS) throw new Error(`Diagnostic is ${wordCount} words.`);

  await writeFile(path.join(process.cwd(), "fixtures/demo-run.json"), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    claims: classified.map((claim) => ({ id: claim.id, status: claim.status, decision: claim.humanDecision, statement: claim.statement })),
    sources: sources.map((source) => ({ id: source.id, fetchStatus: source.fetchStatus, kind: source.sourceKind })),
    wordCount, eligible: approved.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
