"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ClaimCard } from "@/components/claim-card";
import { DiagnosticSheet } from "@/components/diagnostic-sheet";
import { ExecutionTimeline } from "@/components/execution-timeline";
import { ResearchLoader } from "@/components/research-loader";
import { ResearchProgress } from "@/components/research-progress";
import { ResearchActivity } from "@/components/research-activity";
import { PrintFitCheck } from "@/components/print-fit-check";
import { SourceTable } from "@/components/source-table";
import {
  advanceResearchRun,
  approveDiagnosticExport,
  approveEligibleClaims,
  generateDiagnostic,
  getRunPayload,
  reviewClaim,
  type RunPayload,
} from "@/lib/client";
import { cn } from "@/lib/utils";
import { ACTIVE_STAGES } from "@/lib/labels";
import { getWriterInput, isEligibleClaim } from "@/lib/diagnostic-audit";

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

export function ResearchWorkspace({ runId }: { runId: string }) {
  const [payload, setPayload] = useState<RunPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameHint, setNameHint] = useState("");
  const [companyHint, setCompanyHint] = useState("");
  const [roleLimitation, setRoleLimitation] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [confirmationVersion, setConfirmationVersion] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [resumeCount, setResumeCount] = useState(0);
  const [polling, setPolling] = useState(false);
  const [printFitVersion, setPrintFitVersion] = useState<string | null>(null);
  const reportPrintFit = useCallback((fits: boolean) => setPrintFitVersion(fits ? payload?.run.updatedAt ?? null : null), [payload?.run.updatedAt]);

  const refresh = useCallback(async () => {
    const result = await getRunPayload(runId);
    if (!result.ok) {
      setError(result.error.message);
      return null;
    }
    setError(null);
    setPayload(result.data);
    return result.data;
  }, [runId]);

  // Read activity while an advance request is still fetching or calling the model.
  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    let reading = false;
    const timer = setInterval(async () => {
      if (reading) return;
      reading = true;
      try {
        const result = await getRunPayload(runId, controller.signal);
        if (!controller.signal.aborted && result.ok) setPayload((current) => !current || result.data.run.updatedAt >= current.run.updatedAt ? result.data : current);
      } finally { reading = false; }
    }, 2_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [polling, runId]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function loop() {
      setPolling(true);
      try {
      while (!cancelled) {
        const current = await getRunPayload(runId, controller.signal);
        if (cancelled) break;
        if (!current.ok) {
          setError(current.error.message);
          break;
        }
        setError(null);
        setPayload(current.data);
        const run = current.data.run;
        if (current.data.fixtureMode || !ACTIVE_STAGES.has(run.stage) || run.identityStatus && run.identityStatus !== "resolved") break;
        if (run.retryAfter && Date.parse(run.retryAfter) > Date.now()) {
          await sleep(Math.min(60_000, Date.parse(run.retryAfter) - Date.now()), controller.signal);
          continue;
        }
        const advanced = await advanceResearchRun(runId, undefined, controller.signal);
        if (cancelled) break;
        if (!advanced.ok) {
          if (advanced.status === 409) {
            await sleep(800 + Math.floor(Math.random() * 700), controller.signal);
            continue;
          }
          setError(advanced.error.message);
          break;
        }
        if (advanced.data.retryAfter) {
          const wait = Math.max(0, Date.parse(advanced.data.retryAfter) - Date.now());
          await sleep(Math.min(wait, 60_000), controller.signal);
        } else {
          await sleep(400, controller.signal);
        }
        if (cancelled) break;
        if (!advanced.data.canContinue && !advanced.data.retryAfter) {
          await refresh();
          break;
        }
      }
      } finally {
        if (!cancelled) setPolling(false);
      }
    }
    void loop();
    return () => { cancelled = true; controller.abort(); };
  }, [refresh, runId, resumeCount]);

  async function resumeWithHints(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await advanceResearchRun(runId, {
      nameHint: nameHint.trim() || undefined,
      companyHint: companyHint.trim() || undefined,
    });
    setBusy(false);
    await refresh();
    if (!result.ok) setError(result.error.message);
    if (result.ok) setResumeCount((count) => count + 1);
  }

  async function onReview(claimId: string, decision: "pending" | "approved" | "excluded", note?: string) {
    setConfirmationVersion(null);
    const result = await reviewClaim(runId, claimId, decision, note);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await refresh();
  }

  async function onApproveEligible() {
    setConfirmationVersion(null);
    setBusy(true);
    const result = await approveEligibleClaims(runId);
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else await refresh();
  }

  async function onGenerate() {
    setConfirmationVersion(null);
    setBusy(true);
    setActionMessage(null);
    const result = await generateDiagnostic(runId, roleLimitation.trim() || undefined);
    setBusy(false);
    if (!result.ok) {
      await refresh();
      setError(result.error.message);
      return;
    }
    if (result.data.status !== "ok") {
      setActionMessage(result.data.reason);
      await refresh();
      return;
    }
    setActionMessage("Draft generated from approved verified claims.");
    await refresh();
  }

  async function onApproveExport() {
    if (printFitVersion !== payload?.run.updatedAt || confirmationVersion !== payload?.run.updatedAt) {
      setActionMessage("Confirm that you reviewed the evidence before export approval.");
      return;
    }
    setBusy(true);
    const result = await approveDiagnosticExport(runId, reviewerName);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setActionMessage("Diagnostic approved. Print export is now available.");
    await refresh();
  }

  if (!payload && !error) {
    return <ResearchLoader />;
  }
  if (!payload) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm text-destructive">{error}</p>
        <Link className="mt-4 inline-block text-sm text-accent underline-offset-4 hover:underline" href="/">Back to intake</Link>
      </main>
    );
  }

  const { run, claims, sources, events, fixtureMode } = payload;
  const reviewing = run.stage === "awaiting_human_review" || run.stage === "approved" || run.stage === "completed";
  const approved = run.diagnostic?.reviewStatus === "approved";
  const eligibleCount = claims.filter(isEligibleClaim).length;
  const verifiedCount = claims.filter((claim) => claim.status === "verified").length;
  const readOnly = fixtureMode;
  const confirmed = confirmationVersion === run.updatedAt;
  const printFits = printFitVersion === run.updatedAt;
  const writerInput = getWriterInput(claims, roleLimitation);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[0.68rem] tracking-[0.2em] text-muted-foreground uppercase">Evidence ledger</p>
          <h1 className="mt-2 text-3xl">{run.subject?.fullName ?? "Proofline run"}</h1>
        </div>
        <Link className="text-sm text-accent underline-offset-4 hover:underline" href="/">New research</Link>
      </header>

      {fixtureMode ? (
        <p className="border border-accent/40 bg-secondary/50 px-4 py-3 text-sm text-accent">
          Fixture mode. Redis has no live run for this ID, so the read-only demo ledger is shown.
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <ResearchProgress run={run} claims={claims} polling={polling} />
      <ResearchActivity run={run} events={events} polling={polling} />
      {!fixtureMode && ACTIVE_STAGES.has(run.stage) && (!run.identityStatus || run.identityStatus === "resolved") && !polling ? (
        <Button variant="outline" onClick={() => setResumeCount((count) => count + 1)}>Resume research</Button>
      ) : null}

      {run.identityStatus && run.identityStatus !== "resolved" && !fixtureMode ? (
        <form onSubmit={resumeWithHints} className="grid gap-3 border border-border px-4 py-4 sm:grid-cols-[1fr_1fr_auto]">
          <Input aria-label="Name hint" maxLength={150} value={nameHint} onChange={(event) => setNameHint(event.target.value)} placeholder="Name hint" />
          <Input aria-label="Company hint" maxLength={150} value={companyHint} onChange={(event) => setCompanyHint(event.target.value)} placeholder="Company hint" />
          <Button type="submit" disabled={busy || !nameHint.trim() && !companyHint.trim()}>Resume identity</Button>
        </form>
      ) : null}

      {reviewing ? (
        <Tabs defaultValue="claims">
          <TabsList variant="line" className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="diagnostic">Diagnostic</TabsTrigger>
            <TabsTrigger value="claims">Claims</TabsTrigger>
            <TabsTrigger value="sources">Sources</TabsTrigger>
            <TabsTrigger value="execution">Execution</TabsTrigger>
          </TabsList>
          <TabsContent value="diagnostic" className="mt-6 space-y-5">
            {run.diagnostic ? (
              <><DiagnosticSheet diagnostic={run.diagnostic} claims={claims} sources={sources} /><PrintFitCheck version={run.updatedAt} onFit={reportPrintFit} /></>
            ) : (
              <p className="text-sm text-muted-foreground">
                Approve verified claims, then generate the diagnostic from that fact set. The writer never receives unverified or rejected claims.
              </p>
            )}
            {actionMessage ? <p className="text-sm text-accent">{actionMessage}</p> : null}
            {readOnly && approved ? <Link href={`/research/${runId}/print`} className={cn(buttonVariants({ variant: "outline" }))}>Open approved print view</Link> : null}
            {readOnly ? null : (
              <div className="space-y-4 border border-border px-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="role-limit">Role limitation if no verified current role</Label>
                  <Textarea id="role-limit" maxLength={500} value={roleLimitation} onChange={(event) => setRoleLimitation(event.target.value)} />
                </div>
                <Button disabled={busy || writerInput.status !== "ok" || approved} onClick={() => void onGenerate()}>
                  {busy ? "Working" : "Generate from approved claims"}
                </Button>
                <p className="text-xs text-muted-foreground">{eligibleCount} approved verified claims are eligible for the writer.</p>
                {writerInput.status !== "ok" ? <p className="text-sm text-muted-foreground">Insufficient evidence. {writerInput.reason} Inspect the Claims and Sources tabs.</p> : null}
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="reviewer">Reviewer name</Label>
                    <Input id="reviewer" maxLength={120} value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} />
                  </div>
                  <label className="flex items-start gap-2 text-sm text-muted-foreground sm:pb-1">
                    <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmationVersion(value === true ? run.updatedAt : null)} />
                    <span>I reviewed the evidence and approve this diagnostic for export.</span>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || !run.diagnostic || approved || !printFits || !confirmed || !reviewerName.trim()} onClick={() => void onApproveExport()}>
                    Approve diagnostic
                  </Button>
                  {approved ? (
                    <Link href={`/research/${runId}/print`} className={cn(buttonVariants({ variant: "outline" }))}>
                      Open print view
                    </Link>
                  ) : (
                    <Button variant="outline" disabled>Export locked until approval</Button>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
          <TabsContent value="claims" className="mt-6 space-y-4">
            {readOnly ? null : (
              <Button variant="outline" disabled={busy || verifiedCount === 0} onClick={() => void onApproveEligible()}>
                Approve all eligible
              </Button>
            )}
            {claims.map((claim) => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                readOnly={readOnly}
                onReview={(decision, note) => onReview(claim.id, decision, note)}
              />
            ))}
          </TabsContent>
          <TabsContent value="sources" className="mt-6">
            <SourceTable sources={sources} claims={claims} />
          </TabsContent>
          <TabsContent value="execution" className="mt-6">
            <ExecutionTimeline events={events} fixtureMode={fixtureMode} />
          </TabsContent>
        </Tabs>
      ) : (
        <ExecutionTimeline events={events} fixtureMode={fixtureMode} />
      )}
    </main>
  );
}
