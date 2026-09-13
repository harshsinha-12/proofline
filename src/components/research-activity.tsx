"use client";

import type { ExecutionEvent, ResearchRun } from "@/schemas/run";
import { STAGE_LABELS } from "@/lib/labels";

export function ResearchActivity({ run, events, polling }: { run: ResearchRun; events: ExecutionEvent[]; polling: boolean }) {
  const recent = events.slice(-30).reverse();
  return (
    <section className="overflow-hidden rounded-md border border-border bg-zinc-950 text-zinc-200" aria-label="Live research activity">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 font-mono text-xs">
        <span>Research activity</span>
        <span className="flex items-center gap-2 text-zinc-400"><span className={`size-2 rounded-full ${polling ? "bg-emerald-400 motion-safe:animate-pulse" : "bg-zinc-500"}`} />{polling ? "Live · refreshes every 2s" : "Saved activity"}</span>
      </header>
      <div className="max-h-80 overflow-y-auto p-4 font-mono text-xs leading-6">
        <p role="status" className="mb-3 text-amber-200">&gt; {run.stage === "failed" ? `Stopped: ${run.fatalError?.message ?? "Research failed"}` : polling ? `Working: ${STAGE_LABELS[run.stage]}${run.retryAfter ? " · waiting for scheduled retry" : ""}` : STAGE_LABELS[run.stage]}</p>
        {recent.length === 0 ? <p className="text-zinc-400">Waiting for the first checkpoint…</p> : null}
        <ol className="space-y-3">
          {recent.map((event) => (
            <li key={event.id} className="break-words border-t border-zinc-800 pt-2">
              <p className="text-zinc-500">{event.at} · {event.type.replace(/_/g, " ")}</p>
              <p>{event.message}</p>
              {event.data ? <dl className="text-zinc-400">{Object.entries(event.data).map(([key, value]) => <div key={key} className="[overflow-wrap:anywhere]"><dt className="inline text-zinc-500">{key}: </dt><dd className="inline">{typeof value === "string" && /^https:\/\//.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline underline-offset-2">{value}</a> : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl> : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
