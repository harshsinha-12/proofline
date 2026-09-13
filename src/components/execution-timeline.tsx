"use client";

import type { ExecutionEvent } from "@/schemas/run";

export function ExecutionTimeline({ events, fixtureMode }: { events: ExecutionEvent[]; fixtureMode: boolean }) {
  return (
    <ol className="space-y-3">
      {fixtureMode ? (
        <li className="border border-accent/40 bg-secondary/40 px-4 py-3 text-sm text-accent">
          Fixture mode is active. This ledger is read-only demo data, not a live Redis run.
        </li>
      ) : null}
      {events.length === 0 ? (
        <li className="text-sm text-muted-foreground">No execution events have been recorded yet.</li>
      ) : events.slice().reverse().map((event) => (
        <li key={event.id} className="border border-border px-4 py-3">
          <p className="font-mono text-[0.65rem] tracking-[0.16em] text-muted-foreground uppercase">
            {event.stage.replace(/_/g, " ")} · {event.type.replace(/_/g, " ")}
          </p>
          <p className="mt-1 text-sm text-foreground">{event.message}</p>
          <p className="mt-1 font-mono text-[0.65rem] text-muted-foreground">{event.at}</p>
          {event.data ? (
            <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {Object.entries(event.data).map(([key, value]) => (
                <div key={key}>
                  <dt className="font-mono uppercase tracking-wide">{key}</dt>
                  <dd>{Array.isArray(value) ? value.join("; ") : String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
