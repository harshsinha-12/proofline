import Link from "next/link";
import { DiagnosticSheet } from "@/components/diagnostic-sheet";
import { getClaims } from "@/lib/claim-store";
import { getApprovedSnapshot } from "@/lib/diagnostic-store";
import { loadRun } from "@/lib/run-store";
import { getSources } from "@/lib/source-store";

export default async function ResearchPrintPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const loaded = await loadRun(runId);
  if (!loaded) {
    return (
      <main className="px-6 py-16 text-center text-sm text-muted-foreground">
        Research run not found. <Link className="text-accent underline-offset-4 hover:underline" href="/">Return to intake</Link>
      </main>
    );
  }
  const snapshot = await getApprovedSnapshot(runId);
  const diagnostic = snapshot?.diagnostic ?? (loaded.run.diagnostic?.reviewStatus === "approved" ? loaded.run.diagnostic : undefined);
  if (!diagnostic) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16 text-center">
        <p className="font-mono text-[0.68rem] tracking-[0.18em] text-muted-foreground uppercase">Export blocked</p>
        <p className="mt-3 text-lg">This diagnostic is not approved for export.</p>
        <Link className="mt-6 inline-block text-sm text-accent underline-offset-4 hover:underline" href={`/research/${runId}`}>
          Return to the evidence ledger
        </Link>
      </main>
    );
  }
  const [claims, sources] = await Promise.all([getClaims(runId), getSources(runId)]);
  return (
    <main className="print-page min-h-full bg-background py-8">
      <div className="no-print mx-auto mb-6 flex max-w-[210mm] justify-between px-8 text-sm">
        <Link className="text-accent underline-offset-4 hover:underline" href={`/research/${runId}`}>Back to ledger</Link>
        <span className="text-muted-foreground">Use the browser print dialog to save PDF.</span>
      </div>
      <DiagnosticSheet
        diagnostic={diagnostic}
        claims={claims}
        sources={sources}
        generatedLabel={snapshot ? `Approved ${snapshot.approvedAt.slice(0, 10)} by ${snapshot.approvedBy}` : undefined}
      />
    </main>
  );
}
