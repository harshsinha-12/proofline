"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ResearchError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto max-w-xl space-y-4 px-6 py-16">
      <h1 className="text-2xl">The evidence ledger could not be loaded.</h1>
      <p className="text-sm text-muted-foreground">Retry to reload the saved run. Export remains unavailable until the approved snapshot can be verified.</p>
      <Button onClick={retry}>Try again</Button>
      <Link className="ml-4 text-sm text-accent" href="/">New research</Link>
    </main>
  );
}
