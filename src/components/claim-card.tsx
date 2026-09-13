"use client";

import { useState } from "react";
import type { Claim } from "@/schemas/claim";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_LABELS } from "@/lib/labels";
import { singleSourceEvidence } from "@/lib/claim-research";

export function ClaimCard({
  claim,
  readOnly,
  onReview,
}: {
  claim: Claim;
  readOnly?: boolean;
  onReview: (decision: Claim["humanDecision"], note?: string) => Promise<void>;
}) {
  const [note, setNote] = useState(claim.humanNote ?? "");
  const [pending, setPending] = useState(false);
  const canApprove = claim.status === "verified";
  const singleSource = singleSourceEvidence(claim);

  async function submit(decision: Claim["humanDecision"]) {
    setPending(true);
    try {
      await onReview(decision, note);
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[0.68rem] tracking-[0.16em] text-muted-foreground uppercase">
          {claim.category.replace(/_/g, " ")} · {claim.materiality} materiality
        </p>
        <p className="font-mono text-[0.68rem] tracking-[0.16em] uppercase text-accent">
          {STATUS_LABELS[claim.status]} · {claim.humanDecision}
        </p>
      </div>
      <p className="mt-3 text-[1.05rem] leading-6 text-foreground">{claim.statement}</p>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{claim.statusReason}</p>
      {singleSource ? (
        <aside className="mt-3 space-y-2 border-l-2 border-accent pl-3 text-sm">
          <p className="font-medium">Single-source support · independent confirmation missing</p>
          <p className="text-muted-foreground">Source attribution for review: <a className="underline" href={singleSource.url} target="_blank" rel="noopener noreferrer">{singleSource.title}</a> states:</p>
          <blockquote className="text-muted-foreground">“{singleSource.excerpt}”</blockquote>
          <p className="text-xs text-muted-foreground">This records what the source says. It does not independently verify the underlying claim and is not eligible for the diagnostic.</p>
        </aside>
      ) : null}
      {claim.asOfDate ? <p className="mt-1 text-xs text-muted-foreground">As of {claim.asOfDate}</p> : null}
      <EvidencePanel claim={claim} />
      {readOnly ? null : (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <Textarea aria-label={`Reviewer note for ${claim.statement}`} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Reviewer note" rows={2} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || !canApprove} onClick={() => submit("approved")}>
              Approve for diagnostic
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => submit("excluded")}>
              Exclude
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => submit("pending")}>
              Reset
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => submit(claim.humanDecision)}>Save note</Button>
          </div>
          {!canApprove ? (
            <p className="text-xs text-muted-foreground">Only verified claims can be approved for the writer.</p>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function EvidencePanel({ claim }: { claim: Claim }) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <CheckBlock label="Check 1" check={claim.check1} />
      <CheckBlock label="Check 2" check={claim.check2} />
    </div>
  );
}

function CheckBlock({
  label,
  check,
}: {
  label: string;
  check: Claim["check1"];
}) {
  if (!check) {
    return (
      <div className="border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
        {label}: not completed. The ledger records an explicit gap rather than inventing a second source.
      </div>
    );
  }
  return (
    <div className="border border-border px-3 py-3 text-sm">
      <p className="font-mono text-[0.65rem] tracking-[0.16em] text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-foreground">{check.verdict.replace(/_/g, " ")} · {check.sourceAuthorityForClaim.replace(/_/g, " ")}</p>
      <p className="mt-1 text-muted-foreground">{check.independenceFromOtherCheck.replace(/_/g, " ")}</p>
      {check.evidence.map((excerpt, index) => (
        <blockquote key={`${excerpt.sourceId}:${index}`} className="mt-2 border-l border-accent/40 pl-3 text-foreground/80">
          {excerpt.excerpt}
          <a className="mt-1 block text-xs text-accent underline-offset-2 hover:underline" href={excerpt.url} target="_blank" rel="noreferrer">
            {excerpt.title}
          </a>
          <p className="mt-1 text-xs text-muted-foreground">Exact scope: {excerpt.supportsExactly}</p>
        </blockquote>
      ))}
      <p className="mt-2 text-muted-foreground">{check.reasoning}</p>
      <p className="mt-2 font-mono text-[0.65rem] text-muted-foreground">Checked {new Date(check.checkedAt).toUTCString()}</p>
      {check.limitations.length > 0 ? (
        <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">
          {check.limitations.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
