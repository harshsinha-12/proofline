import { cn } from "@/lib/utils";

function Pulse({ className }: { className: string }) {
  return <div aria-hidden="true" className={cn("bg-muted motion-safe:animate-pulse", className)} />;
}

export function ResearchLoader() {
  return (
    <main aria-busy="true" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <p className="font-mono text-[0.68rem] tracking-[0.2em] text-muted-foreground uppercase">Evidence ledger</p>
        <Pulse className="mt-3 h-8 w-56" />
      </header>

      <section className="border border-border bg-card px-5 py-4" role="status" aria-live="polite">
        <div className="flex items-center gap-3 text-sm">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-full border-2 border-border border-t-accent motion-safe:animate-spin"
          />
          <span>Opening the report</span>
        </div>
        <div className="mt-3 h-0.5 overflow-hidden bg-border">
          <div className="h-full w-1/3 bg-accent motion-safe:animate-ledger-scan" />
        </div>
      </section>

      <section aria-hidden="true" className="border border-border bg-card px-5 py-4">
        <Pulse className="h-3 w-28" />
        <Pulse className="mt-4 h-5 w-2/5" />
        <Pulse className="mt-2 h-4 w-3/5" />
        <div className="mt-4 h-2 w-full bg-muted" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Pulse className="h-4 w-3/4" />
          <Pulse className="h-4 w-2/3" />
          <Pulse className="h-4 w-4/5" />
          <Pulse className="h-4 w-1/2" />
        </div>
      </section>

      <section aria-hidden="true" className="overflow-hidden rounded-md border border-border bg-zinc-950 px-4 py-4">
        <Pulse className="h-3 w-36 bg-zinc-800" />
        <div className="mt-4 space-y-3">
          <Pulse className="h-3 w-full bg-zinc-800/80" />
          <Pulse className="h-3 w-5/6 bg-zinc-800/80" />
          <Pulse className="h-3 w-2/3 bg-zinc-800/80" />
        </div>
      </section>
    </main>
  );
}
