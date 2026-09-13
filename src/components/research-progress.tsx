"use client";

import type { ResearchRun } from "@/schemas/run";
import { FETCH_LABELS, STAGE_LABELS } from "@/lib/labels";

export function ResearchProgress({ run }: { run: ResearchRun }) {
  const progress = [
    `${run.progress.sourcesDiscovered} sources discovered`,
    `${run.progress.sourcesFetched} sources fetched`,
    `${run.progress.claimsExtracted} claims extracted`,
    `${run.progress.checksCompleted} checks completed`,
    `${run.progress.verifiedClaims} verified`,
    `${run.progress.excludedClaims} excluded`,
  ];

  return (
    <section className="border border-border bg-card px-5 py-4">
      <p className="font-mono text-[0.68rem] tracking-[0.18em] text-muted-foreground uppercase">
        {STAGE_LABELS[run.stage]}
      </p>
      <p className="mt-2 text-lg text-foreground">{run.subject?.fullName ?? "Unresolved subject"}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {run.subject?.currentRole ? `${run.subject.currentRole}${run.subject.organization ? `, ${run.subject.organization}` : ""}` : "Identity and role are still being resolved from public sources."}
      </p>
      <ul className="mt-4 grid gap-1 text-sm text-foreground/80 sm:grid-cols-2">
        {progress.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {run.warnings.length > 0 ? (
        <ul className="mt-4 space-y-1 border-t border-border pt-3 text-sm text-accent">
          {run.warnings.slice(-8).map((warning, index) => (
            <li key={`${warning.createdAt}-${index}`}>{warning.message}</li>
          ))}
        </ul>
      ) : null}
      {run.fatalError ? (
        <p className="mt-3 text-sm text-destructive">{run.fatalError.message}</p>
      ) : null}
      {run.identityStatus && run.identityStatus !== "resolved" ? (
        <p className="mt-3 text-sm text-accent">
          Identity is {run.identityStatus.replace(/_/g, " ")}. Add a name or company hint to continue.
        </p>
      ) : null}
    </section>
  );
}

export function FetchStamp({ status }: { status: keyof typeof FETCH_LABELS }) {
  return <span className="font-mono text-[0.7rem] tracking-wide uppercase text-muted-foreground">{FETCH_LABELS[status]}</span>;
}
