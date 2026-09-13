"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createResearchRun } from "@/lib/client";
import { DEMO_COMPANY_HINT, DEMO_LINKEDIN_URL, DEMO_NAME_HINT, DEMO_RUN_ID } from "@/lib/demo";
import { isLinkedInProfileUrl } from "@/lib/urls";

export function ResearchIntake() {
  const router = useRouter();
  const [linkedInUrl, setLinkedInUrl] = useState(DEMO_LINKEDIN_URL);
  const [nameHint, setNameHint] = useState(DEMO_NAME_HINT);
  const [companyHint, setCompanyHint] = useState(DEMO_COMPANY_HINT);
  const [allowManualUrl, setAllowManualUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!allowManualUrl && !isLinkedInProfileUrl(linkedInUrl)) {
      setError("Enter a public LinkedIn profile URL, or enable the manual fallback.");
      return;
    }
    setPending(true);
    const result = await createResearchRun({
      linkedInUrl,
      nameHint: nameHint.trim() || undefined,
      companyHint: companyHint.trim() || undefined,
      allowManualUrl,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.push(`/research/${result.data.runId}`);
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5">
      <div className="space-y-2">
        <Label htmlFor="linkedin">Public LinkedIn URL</Label>
        <Input id="linkedin" value={linkedInUrl} onChange={(event) => setLinkedInUrl(event.target.value)} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name hint</Label>
          <Input id="name" value={nameHint} onChange={(event) => setNameHint(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company">Company hint</Label>
          <Input id="company" value={companyHint} onChange={(event) => setCompanyHint(event.target.value)} />
        </div>
      </div>
      <label className="flex items-start gap-3 text-sm text-muted-foreground">
        <Checkbox checked={allowManualUrl} onCheckedChange={(value) => setAllowManualUrl(value === true)} />
        <span>This is a public HTTPS profile URL that is not LinkedIn. Use only as an explicit fallback. No login pages.</span>
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Starting" : "Start evidence review"}</Button>
        <Link className="text-sm text-accent underline-offset-4 hover:underline" href={`/research/${DEMO_RUN_ID}`}>
          Open precomputed demo run
        </Link>
      </div>
    </form>
  );
}
