"use client";

import type { Claim } from "@/schemas/claim";
import type { Source } from "@/schemas/source";
import { FETCH_LABELS } from "@/lib/labels";

export function SourceTable({ sources, claims }: { sources: Source[]; claims: Claim[] }) {
  return (
    <div className="overflow-x-auto border border-border">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead className="bg-secondary/60 font-mono text-[0.68rem] tracking-[0.14em] text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-3 py-2 font-medium">Fetch</th>
            <th className="px-3 py-2 font-medium">Query</th>
            <th className="px-3 py-2 font-medium">Claims</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => {
            const linked = claims.filter((claim) => claim.originSourceIds.includes(source.id) ||
              claim.check1?.evidence.some((item) => item.sourceId === source.id) ||
              claim.check2?.evidence.some((item) => item.sourceId === source.id));
            return (
              <tr key={source.id} className="border-t border-border align-top">
                <td className="px-3 py-3">
                  <a className="text-foreground underline-offset-2 hover:underline" href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                  <p className="mt-1 text-xs text-muted-foreground">{source.publisher ?? source.canonicalUrl}</p>
                  <p className="mt-1 font-mono text-[0.65rem] text-muted-foreground">{new Date(source.retrievedAt).toUTCString()}</p>
                  {source.suspectedOriginId ? (
                    <p className="mt-1 text-xs text-accent">Suspected shared origin: {source.suspectedOriginId}</p>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-muted-foreground">{source.sourceKind.replace(/_/g, " ")}</td>
                <td className="px-3 py-3 text-muted-foreground"><p className="font-mono text-[0.7rem] uppercase">{FETCH_LABELS[source.fetchStatus]}</p>{source.notes.map((note) => <p key={note} className="mt-1 text-xs">{note}</p>)}</td>
                <td className="px-3 py-3 text-muted-foreground">{source.discoveryQuery}</td>
                <td className="px-3 py-3 text-muted-foreground">{linked.length ? linked.map((claim) => claim.id).join(", ") : "None linked"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
