"use client";

import type { ResearchRun } from "@/schemas/run";
import { FETCH_LABELS, STAGE_LABELS } from "@/lib/labels";
import { getResearchProgress } from "@/lib/research-progress";
import { LoaderCircle } from "lucide-react";

export function ResearchProgress({ run, polling = false }: { run: ResearchRun; polling?: boolean }) {
  const research = getResearchProgress(run);
  const needsHint = run.identityStatus && run.identityStatus !== "resolved";
  const active = polling && !research.ready && run.stage !== "failed" && !needsHint;
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
      <div className="mt-3 flex items-center justify-between gap-3 text-sm" role="status" aria-live="polite">
        <span className="flex items-center gap-2">
          {active ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" /> : null}
          {research.ready ? "Research complete · ready for review" : run.stage === "failed" ? "Research stopped" : needsHint ? "Waiting for identity hints" : active ? "Research in progress" : "Research paused"}
        </span>
        <span className="shrink-0 font-mono">{research.percent}%</span>
      </div>
      <progress aria-label="Research stages completed" value={research.percent} max={100} className="mt-2 h-2 w-full accent-accent" />
      <p className="mt-2 text-xs text-muted-foreground">
        {research.completed} of {research.total} stages completed. Percentage includes saved tasks within the current stage, not elapsed time; fetching and verification can take longer because of retries.
      </p>
      {!research.ready ? <p className="mt-2 text-xs text-muted-foreground">Before human review: {Array.from(new Set(research.remaining.map((stage) => STAGE_LABELS[stage]))).join(" → ")}.</p> : null}
      {active ? <p className="mt-2 text-xs text-muted-foreground">Keep this page open to continue research. Completed work is saved at each checkpoint.</p> : null}
      {run.retryAfter && active ? <p className="mt-2 text-xs text-muted-foreground">A retry is scheduled; research will resume automatically.</p> : null}
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
