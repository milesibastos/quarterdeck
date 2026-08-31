import type { PathRef, PullRequest, Worker } from "@/types/document.ts";
import { Card, CardContent } from "@/ui/components/card";
import { LifecycleRail, StageChip, stageAccent } from "@/ui/fleet/lifecycle-rail";
import { ago } from "@/ui/lib/age";
import { cn } from "@/ui/lib/utils";

/**
 * One piece of work under way.
 *
 * The card answers four things without being clicked - what this is, whose
 * project, research or build, and whether it is fine - and holds one thing a
 * disclosure away. That one thing is the instructions it was dispatched with:
 * worth having when the operator is asking "what is this worker even doing",
 * noise on eleven cards at once.
 */

const KIND_LABEL = { build: "build", research: "research" } as const;

/**
 * A pointer to something on disk, and whether it was still there.
 *
 * A pointer that has stopped resolving is drawn as broken rather than as a
 * working one - a worktree that has been swept up is exactly the thing an
 * operator needs to know before going looking for it.
 */
function Pointer({ label, path }: { label: string; path: PathRef }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate font-mono",
          path.present ? "text-foreground" : "text-danger line-through decoration-danger/60",
        )}
        title={path.ref}
      >
        {path.ref}
      </span>
      {!path.present && <span className="shrink-0 text-danger">gone</span>}
    </span>
  );
}

/**
 * The pull request, when there is one.
 *
 * The address is in the link rather than on the page: it is long, the column is
 * narrow, and what the operator is reading for is whether there is one and what
 * it is doing. `checks` is `unknown` for every worker today - nothing reads the
 * forge - and saying so is more use than a silence that reads as "no news".
 */
function PullRequestLine({ pullRequest }: { pullRequest: PullRequest }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <a
        href={pullRequest.url}
        target="_blank"
        rel="noreferrer"
        title={pullRequest.url}
        className="text-info underline-offset-2 hover:underline"
      >
        {pullRequest.state === "landed" ? "pull request landed" : "pull request open"}
      </a>
      {pullRequest.checks === "unknown" && (
        <span className="text-muted-foreground">checks unknown</span>
      )}
    </span>
  );
}

export function WorkerCard({ worker, nowMs }: { worker: Worker; nowMs: number }) {
  const { lifecycle } = worker;
  return (
    <Card
      data-worker={worker.id}
      data-stage={lifecycle.stage}
      data-step={lifecycle.step ?? "none"}
      size="sm"
      className={cn("gap-2.5 border-l-4 py-3", stageAccent(lifecycle.stage))}
    >
      <CardContent className="flex flex-col gap-2.5">
        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <StageChip stage={lifecycle.stage} />
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
            {worker.id}
          </span>
        </header>

        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{worker.project}</span>
          <span className="tracking-wide uppercase">{KIND_LABEL[worker.kind]}</span>
          <span className="ms-auto font-mono">{ago(lifecycle.observedAt, nowMs)}</span>
        </p>

        <LifecycleRail lifecycle={lifecycle} />

        {/*
          Upstream's own words. Always shown: for a worker on the track it is
          the finest detail there is, and for one that stopped it is the whole
          reason it stopped, which is the state an operator has to act on.
        */}
        <p className="text-xs text-muted-foreground">{lifecycle.detail}</p>

        <div className="flex flex-col gap-1 text-xs">
          <Pointer label="in" path={worker.worktree} />
          {worker.pullRequest !== null && <PullRequestLine pullRequest={worker.pullRequest} />}
        </div>

        {/*
          Native, so the browser keeps it open across a re-render: React
          reconciles the element rather than rebuilding it, and never sets
          `open`, so a card the operator has expanded stays expanded when the
          fleet moves underneath it.
        */}
        <details className="group/brief text-xs">
          <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground">
            dispatched with
            <span className="ms-1 inline-block group-open/brief:rotate-90">&rsaquo;</span>
          </summary>
          <div className="mt-1.5 border-t border-border pt-1.5">
            <Pointer label="brief" path={worker.brief} />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
