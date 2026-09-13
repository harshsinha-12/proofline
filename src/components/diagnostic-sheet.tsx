import type { Claim } from "@/schemas/claim";
import type { Diagnostic } from "@/schemas/diagnostic";
import type { Source } from "@/schemas/source";
import { citationEntries } from "@/lib/client";

function CitationLinks({ ids, entries }: { ids: string[]; entries: ReturnType<typeof citationEntries> }) {
  return <span className="citation-marks">{entries.filter((entry) => ids.includes(entry.claimId)).map((entry) => <a key={entry.claimId} href={entry.url ?? `#citation-${entry.number}`} target={entry.url ? "_blank" : undefined} rel="noreferrer" aria-label={`Citation ${entry.number}: ${entry.title}`}>[{entry.number}]</a>)}</span>;
}

export function DiagnosticSheet({
  diagnostic,
  claims,
  sources,
  generatedLabel,
}: {
  diagnostic: Diagnostic;
  claims: Claim[];
  sources: Source[];
  generatedLabel?: string;
}) {
  const citations = citationEntries(diagnostic, claims, sources);
  const summary = diagnostic.integritySummary;
  const sampledIds = [...new Set(diagnostic.gaps.flatMap((gap) => gap.sampledSourceIds))];
  const sample = sampledIds.map((id, index) => ({ id, number: index + 1, source: sources.find((source) => source.id === id) }));
  const identityIds = claims.filter((claim) => claim.category === "identity" || claim.category === "role").map((claim) => claim.id);

  return (
    <article className="diagnostic-sheet mx-auto w-full max-w-[210mm] bg-card px-8 py-8 text-foreground">
      <header className="border-b border-foreground/20 pb-4">
        <p className="font-mono text-[0.65rem] tracking-[0.22em] text-muted-foreground uppercase">
          Public Presence Diagnostic
        </p>
        <h1 className="mt-2 text-3xl leading-tight">{diagnostic.subjectName}</h1>
        <p className="mt-1 text-base text-accent">{diagnostic.roleLine} <CitationLinks ids={identityIds} entries={citations} /></p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {generatedLabel ?? new Date(diagnostic.generatedAt).toUTCString()}
        </p>
      </header>

      <section className="mt-6">
        <h2 className="font-mono text-[0.7rem] tracking-[0.18em] text-muted-foreground uppercase">Current positioning</h2>
        <p className="mt-2 text-[1.02rem] leading-7">{diagnostic.currentPositioning} <CitationLinks ids={diagnostic.citationClaimIds} entries={citations} /></p>
      </section>

      <section className="mt-6">
        <h2 className="font-mono text-[0.7rem] tracking-[0.18em] text-muted-foreground uppercase">Verified credibility signals</h2>
        <ol className="mt-2 space-y-2">
          {diagnostic.credibilitySignals.map((signal) => (
            <li key={signal.claimIds.join(":")} className="text-[1.02rem] leading-7">
              {signal.text} <CitationLinks ids={signal.claimIds} entries={citations} />
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6">
        <h2 className="font-mono text-[0.7rem] tracking-[0.18em] text-muted-foreground uppercase">Three biggest public-profile gaps</h2>
        <ol className="mt-3 space-y-4">
          {diagnostic.gaps.map((gap, index) => (
            <li key={gap.id}>
              <p className="font-medium">{index + 1}. {gap.title}</p>
              <p className="mt-1 leading-6">{gap.observation} <CitationLinks ids={gap.supportingClaimIds} entries={citations} /> {sample.filter((entry) => gap.sampledSourceIds.includes(entry.id)).map((entry) => <a key={entry.id} href={entry.source?.url ?? `#sample-${entry.number}`} target="_blank" rel="noreferrer">[S{entry.number}]</a>)}</p>
              <p className="mt-1 text-sm leading-6 text-foreground/80">Why it matters: {gap.whyItMatters}</p>
              <p className="mt-1 text-sm leading-6 text-foreground/80">Recommendation: {gap.recommendation}</p>
              <p className="mt-1 text-xs text-muted-foreground">Limitation: {gap.limitation}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6">
        <h2 className="font-mono text-[0.7rem] tracking-[0.18em] text-muted-foreground uppercase">Narrative opportunity</h2>
        <p className="mt-2 leading-7">{diagnostic.narrativeOpportunity} <CitationLinks ids={diagnostic.citationClaimIds} entries={citations} /></p>
      </section>

      <footer className="mt-8 border-t border-foreground/20 pt-4 text-xs leading-5 text-muted-foreground">
        <p>
          {summary.evaluated} claims evaluated | {summary.verified} verified | {summary.partiallyVerified} partial | {summary.unverified} unverified | {summary.rejected} rejected | {summary.conflicts} conflicts
        </p>
        <p className="mt-1">Public sources reviewed on {diagnostic.generatedAt.slice(0, 10)}. Recommendations are evidence-bounded analysis.</p>
        <ol className="mt-3 space-y-1">
          {citations.map((entry) => (
            <li key={entry.claimId} id={`citation-${entry.number}`}>
              [{entry.number}]{" "}
              {entry.url ? (
                <a className="underline-offset-2 hover:underline" href={entry.url} target="_blank" rel="noreferrer">
                  {entry.title}
                </a>
              ) : entry.title}
            </li>
          ))}
        </ol>
        {sample.length ? <p className="mt-2">Source sample: {sample.map((entry) => <a key={entry.id} id={`sample-${entry.number}`} href={entry.source?.url} target="_blank" rel="noreferrer">[S{entry.number}] {entry.source?.title ?? entry.id}{" "}</a>)}</p> : null}
      </footer>
    </article>
  );
}
