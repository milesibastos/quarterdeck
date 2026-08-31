import type {
  Brief,
  ChecksSignal,
  Dispatch,
  PathRef,
  PullRequest,
  ReviewSignal,
  Worker,
} from "@/types/document.ts";
import { Card, CardContent } from "@/ui/components/card";
import { LifecycleRail, StageChip, stageAccent } from "@/ui/fleet/lifecycle-rail";
import { WorkerTerminal, type TerminalReader } from "@/ui/fleet/worker-terminal";
import { ago } from "@/ui/lib/age";
import { cn } from "@/ui/lib/utils";

/**
 * One piece of work under way.
 *
 * The card answers, without being clicked: what this is, whose project,
 * research or build, whether it is fine, where the work physically is, what the
 * worker was told to do, and - when there is one - what its pull request is
 * doing. The one thing a click away is the instructions in full, which is worth
 * having open on one card and is noise on eleven - and, separately, the
 * worker's own terminal, which is read only when it is opened and costs a
 * closed card nothing at all.
 *
 * The rule the whole card is written to: an absence is drawn, never skipped. A
 * field upstream did not record says "not recorded" rather than leaving a gap
 * that reads as "none", and a forge nobody asked says so rather than being
 * silently indistinguishable from a forge that answered and had nothing to
 * report. Those are the two ambiguities the document's shapes exist to remove;
 * collapsing either here would throw the distinction away at the last step.
 */

const KIND_LABEL = { build: "build", research: "research" } as const;

/** What an unrecorded dispatch field says. One wording, so it reads as one fact. */
const NOT_RECORDED = "not recorded";

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
 * One thing recorded when the worker was dispatched, or the statement that it
 * was not.
 *
 * Both halves are always drawn. A row that simply disappeared when upstream
 * recorded nothing would leave the operator unable to tell "this worker is on
 * no branch" from "nobody wrote the branch down", and only the second is true -
 * see `Dispatch` in the document, where every null means that one thing.
 */
function Recorded({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {/* Only a recorded value truncates. "not recorded" is short and fixed,
          and clipping it to "not recorde" at a narrow width would turn the
          statement this row exists to make into something unreadable. */}
      <span
        className={cn(
          value === null
            ? "shrink-0 text-muted-foreground italic"
            : "min-w-0 truncate font-mono text-foreground",
        )}
        title={value ?? undefined}
      >
        {value ?? NOT_RECORDED}
      </span>
    </span>
  );
}

/**
 * Where the work physically is and what is doing it.
 *
 * Wrapped rather than laid out in columns: three of these fit on one line at a
 * comfortable width and stack at a narrow one, and a grid would have to pick a
 * column width for values that range from `high` to a full branch name.
 */
function DispatchBlock({ dispatch }: { dispatch: Dispatch }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      <Recorded label="branch" value={dispatch.branch} />
      <Recorded label="runtime" value={dispatch.runtime} />
      <Recorded label="model" value={dispatch.model} />
      <Recorded label="effort" value={dispatch.effort} />
    </div>
  );
}

/**
 * What a run of checks came out as, as a redundant tone.
 *
 * The word beside it is what carries the meaning; this only makes a column of
 * cards scannable. Deliberately not applied to the text: `--warn` is below AA
 * as text in the light theme (see `docs/quality.md`), and a pip has no contrast
 * obligation because nothing has to be read out of it.
 */
const OUTCOME_PIP = {
  passing: "bg-online",
  failing: "bg-danger",
  pending: "bg-warn",
} as const;

/**
 * What the checks say, or why the panel is not saying.
 *
 * Four renderings for three readings, because the `ok` arm splits: a forge that
 * answered "there are no checks on this pull request" is not a run in progress,
 * and `0 of 0 checks` with an outcome word attached would read as one. The
 * count is the honest thing to branch on - it is what the forge actually said.
 */
function Checks({ checks, nowMs }: { checks: ChecksSignal; nowMs: number }) {
  if (checks.read === "not-looked-up") {
    return (
      <span data-checks="not-looked-up" className="text-muted-foreground italic">
        checks not looked up
      </span>
    );
  }
  if (checks.read === "unreadable") {
    return (
      <span data-checks="unreadable" className="wrap-anywhere text-muted-foreground">
        <span className="text-danger">checks unreadable</span>
        {` - ${checks.detail}`}
      </span>
    );
  }
  if (checks.total === 0) {
    return (
      <span data-checks="none" className="text-muted-foreground">
        no checks on this pull request
      </span>
    );
  }
  return (
    <span data-checks={checks.outcome} className="flex items-baseline gap-1.5">
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 self-center rounded-full", OUTCOME_PIP[checks.outcome])}
      />
      <span className="text-foreground">
        {`${checks.finished} of ${checks.total} checks · ${checks.outcome}`}
      </span>
      <span className="shrink-0 font-mono text-muted-foreground">{ago(checks.asOf, nowMs)}</span>
    </span>
  );
}

/**
 * Whether a person has commented, or why the panel is not saying.
 *
 * `comments: 0` and `not-looked-up` get different words on purpose, and it is
 * the whole reason `ReviewSignal` has three arms: one says the forge was asked
 * and nobody is waiting on the operator, the other says nobody has asked. An
 * operator deciding whether to open the pull request needs to know which.
 */
function Review({ review, nowMs }: { review: ReviewSignal; nowMs: number }) {
  if (review.read === "not-looked-up") {
    return (
      <span data-review="not-looked-up" className="text-muted-foreground italic">
        comments not looked up
      </span>
    );
  }
  if (review.read === "unreadable") {
    return (
      <span data-review="unreadable" className="wrap-anywhere text-muted-foreground">
        <span className="text-danger">comments unreadable</span>
        {` - ${review.detail}`}
      </span>
    );
  }
  return (
    <span data-review={review.comments === 0 ? "none" : "some"} className="flex items-baseline gap-1.5">
      <span className={review.comments === 0 ? "text-muted-foreground" : "text-foreground"}>
        {review.comments === 0
          ? "nobody has commented"
          : `${review.comments} comment${review.comments === 1 ? "" : "s"} from a person`}
      </span>
      <span className="shrink-0 font-mono text-muted-foreground">{ago(review.asOf, nowMs)}</span>
    </span>
  );
}

/**
 * The pull request, when there is one.
 *
 * The whole address is on the card rather than hidden behind a word: an
 * operator reading a fleet needs to know which pull request this is - which
 * repository, which number - before deciding to open it, and a link reading
 * "pull request open" answers none of that. It wraps rather than truncating,
 * because the tail is the part that identifies it.
 */
function PullRequestBlock({
  pullRequest,
  nowMs,
}: {
  pullRequest: PullRequest;
  nowMs: number;
}) {
  return (
    <div
      data-pull-request={pullRequest.state}
      className="flex flex-col gap-0.5 border-t border-border pt-1.5"
    >
      <span className="text-muted-foreground">
        {pullRequest.state === "landed" ? "pull request landed" : "pull request open"}
      </span>
      <a
        href={pullRequest.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 font-mono wrap-anywhere text-info underline-offset-2 hover:underline"
      >
        {pullRequest.url}
      </a>
      <Checks checks={pullRequest.checks} nowMs={nowMs} />
      <Review review={pullRequest.review} nowMs={nowMs} />
    </div>
  );
}

/**
 * What the worker was told to do.
 *
 * The summary is on the card unopened, because "what is this worker even
 * doing" is the question the card exists to answer and an operator should not
 * have to remember what they asked for. The full instructions are one click
 * behind it, and the pointer upstream gives goes inside that disclosure rather
 * than beside the summary - it is where to look when the words are not enough,
 * which is a different need from reading them.
 *
 * `summary` and `text` are independently absent, so this draws four shapes and
 * never infers one from the other: a summary with nothing behind it is an
 * ordinary worker, not a broken one.
 */
function BriefBlock({ brief }: { brief: Brief }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p
        data-brief={brief.summary === null ? "not-recorded" : "summary"}
        className={cn(
          "wrap-anywhere",
          brief.summary === null ? "text-muted-foreground italic" : "text-foreground",
        )}
      >
        {brief.summary ?? `instructions ${NOT_RECORDED}`}
      </p>

      {/*
        Native, so the browser keeps it open across a re-render: React
        reconciles the element rather than rebuilding it, and never sets
        `open`, so a card the operator has expanded stays expanded when the
        fleet moves underneath it.
      */}
      <details className="group/brief">
        <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground">
          dispatched with
          <span className="ms-1 inline-block group-open/brief:rotate-90">&rsaquo;</span>
        </summary>
        <div className="mt-1.5 flex flex-col gap-1.5 border-t border-border pt-1.5">
          {brief.text === null ? (
            <p data-brief-text="not-recorded" className="text-muted-foreground italic">
              The instructions themselves were not recorded; the pointer is below.
            </p>
          ) : (
            // Pre-wrapped, because instructions are written with their line
            // breaks meaning something. Scrolled rather than allowed to grow:
            // a long brief must not push every card below it off the column.
            <p
              data-brief-text="text"
              className="max-h-64 overflow-y-auto whitespace-pre-wrap text-foreground"
            >
              {brief.text}
            </p>
          )}
          <Pointer label="brief" path={brief} />
        </div>
      </details>
    </div>
  );
}

export function WorkerCard({
  worker,
  nowMs,
  terminal,
}: {
  worker: Worker;
  nowMs: number;
  /**
   * How this card reads its worker's session, when somebody opens it.
   *
   * The one thing on the card that is not the document, and it arrives from the
   * composition point for exactly that reason: `src/ui/` cannot read a fleet, so
   * the read it offers has to be handed to it as an address.
   */
  terminal: TerminalReader;
}) {
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
          {/* A heading, so the fleet column is a list a reader can jump
              through rather than one undifferentiated run of text. Truncated
              rather than wrapped: an id is scanned, and a second line of one
              costs a row of every card to save a tail nobody reads. */}
          <h3
            title={worker.id}
            className="min-w-0 flex-1 truncate font-mono text-sm font-normal text-foreground"
          >
            {worker.id}
          </h3>
        </header>

        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{worker.project}</span>
          <span className="tracking-wide uppercase">{KIND_LABEL[worker.kind]}</span>
          <span className="ms-auto font-mono">{ago(lifecycle.observedAt, nowMs)}</span>
        </p>

        {/* The rail is drawn from what was recorded at dispatch, so a card
            never shows a stage its work cannot reach. */}
        <LifecycleRail lifecycle={lifecycle} worker={worker} />

        {/*
          Upstream's own words. Always shown: for a worker on the track it is
          the finest detail there is, and for one that stopped it is the whole
          reason it stopped, which is the state an operator has to act on.
        */}
        <p className="text-xs wrap-anywhere text-muted-foreground">{lifecycle.detail}</p>

        <div className="flex flex-col gap-1 text-xs">
          <Pointer label="in" path={worker.worktree} />
          <DispatchBlock dispatch={worker.dispatch} />
          {/* Only with a pull request. A worker that has not opened one is not
              a worker whose pull request is missing, and an empty block would
              say it was. */}
          {worker.pullRequest !== null && (
            <PullRequestBlock pullRequest={worker.pullRequest} nowMs={nowMs} />
          )}
        </div>

        <BriefBlock brief={worker.brief} />

        {/*
          The worker's own words, fetched only when this is opened. Nothing
          about it touches the first paint; see `worker-terminal.tsx`.
        */}
        <WorkerTerminal worker={worker.id} reader={terminal} />
      </CardContent>
    </Card>
  );
}
