import { ResearchIntake } from "@/components/research-intake";

export default function HomePage() {
  return (
    <main className="relative flex flex-1 justify-center px-6 py-14 sm:py-20">
      <div className="pointer-events-none absolute inset-y-0 left-[max(1.5rem,calc(50%-28rem))] hidden w-px bg-border sm:block" />
      <article className="w-full max-w-2xl border border-border bg-card px-8 py-10 sm:px-12 sm:py-14">
        <p className="font-mono text-[0.68rem] tracking-[0.22em] text-muted-foreground uppercase">
          Public presence diagnostic
        </p>
        <h1 className="mt-5 text-4xl leading-tight text-foreground sm:text-5xl">Proofline</h1>
        <p className="mt-3 text-lg text-accent">Evidence before narrative.</p>
        <div className="mt-8 h-px bg-border" />
        <p className="mt-8 max-w-xl text-[1.05rem] leading-7 text-foreground/90">
          Paste a public LinkedIn URL. Proofline researches public sources, splits findings into atomic claims, and verifies each claim twice. Weak or derived statements stay out of the diagnostic.
        </p>
        <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">
          Public sources only. No login scraping, no outreach, and no client-ready export until a human approves the evidence ledger.
        </p>
        <ResearchIntake />
      </article>
    </main>
  );
}
