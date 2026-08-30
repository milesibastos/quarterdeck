import type { FleetDocument } from "@/types/document.ts";
import { Card, CardContent } from "@/ui/components/card";
import { ago } from "@/ui/lib/age";
import { StateBadge } from "@/ui/state-badge";

/**
 * The fleet lens, in its skeletal form: every worker in the document with its
 * state.
 *
 * This component - and everything under `src/ui/` - can only see the document.
 * It cannot read a fleet, so it cannot grow a "just fetch this one extra field"
 * shortcut, and the whole panel stays replaceable.
 */
export function FleetPanel({
  document,
  nowMs,
}: {
  document: FleetDocument;
  /** Chosen by the composition point, so the ages agree with the projection. */
  nowMs: number;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="font-display text-3xl tracking-wide text-foreground">
          Quarterdeck
        </h1>
        <p className="font-mono text-xs text-muted-foreground">
          fleet &middot; generated {ago(document.generatedAt, nowMs)}
        </p>
      </header>

      {document.degraded && (
        <div
          role="status"
          data-degraded={document.degraded.reason}
          className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-foreground"
        >
          <p className="font-medium">
            {document.degraded.reason === "stale-snapshot"
              ? "Showing a stale snapshot"
              : "Showing the last snapshot that read cleanly"}
          </p>
          <p className="mt-0.5 text-muted-foreground">{document.degraded.detail}</p>
        </div>
      )}

      {document.workers.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-base font-medium text-foreground">No workers on deck</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The fleet read cleanly and reported nothing running.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {document.workers.map((worker) => (
            <li key={worker.id}>
              <Card className="py-0">
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <StateBadge state={worker.state} />
                  <span className="font-mono text-sm text-foreground">{worker.id}</span>
                  <span className="text-sm text-muted-foreground">{worker.project}</span>
                  <span className="ms-auto flex items-baseline gap-3 text-xs text-muted-foreground">
                    <span className="uppercase tracking-wide">{worker.kind}</span>
                    <span className="font-mono">{ago(worker.since, nowMs)}</span>
                  </span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <footer className="font-mono text-xs text-muted-foreground">
        document v{document.version} &middot; {document.workers.length}{" "}
        {document.workers.length === 1 ? "worker" : "workers"}
      </footer>
    </main>
  );
}
