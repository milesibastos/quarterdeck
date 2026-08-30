import type {
  FleetSnapshot,
  SnapshotRecord,
  SnapshotRecordState,
  SnapshotTask,
  SnapshotTaskState,
} from "../adapters/contract.ts";
import type { HealthReading } from "../adapters/health.ts";
import { isIsoInstant, type Clock } from "../providers/clock.ts";
import {
  DOCUMENT_VERSION,
  type DeckItem,
  type DeckState,
  type Health,
  type Lens,
  type LensStatus,
  type PanelDocument,
  type Priority,
  type Stage,
  type ValidationStep,
  type Worker,
  type WorkerKind,
} from "../types/document.ts";

/**
 * The projection: a parsed snapshot and a health reading become the document
 * the UI renders.
 *
 * Pure by construction. The only imports from `adapters` are type-only ones, so
 * nothing in this file can reach a filesystem or a process even by accident,
 * and the whole projection can be exercised against fixtures with no fleet
 * anywhere near the test.
 *
 * The two sources arrive with different promises - the snapshot either parses
 * or refuses, health may simply be gone - so each lens gets its own status
 * rather than the document carrying one flag for all three.
 */

/**
 * Upstream's state vocabulary is not ours. Mapping here rather than in the UI
 * means upstream can rename `parked` without a component changing.
 *
 * Upstream reconciles a worker to one of seven states; the document draws
 * more positions than that, and the extra ones are reached from the fixture
 * fleets rather than from a live read. Three of the seven need a word said
 * about where they land:
 *
 * - `done` is a worker whose run finished, and upstream says it for both a
 *   merged pull request and one whose checks merely went green. Those are
 *   different places to be, so `finishedStage` below asks the worker's own
 *   backlog row which it was rather than treating every finished run as landed.
 *   The entry here is the fallback for a worker with no pull request at all.
 * - `paused` is a worker deliberately idling on a wait it expects to clear -
 *   an upstream release, a rate limit - which is exactly `waiting`.
 * - `unknown` is upstream saying it could not tell: the worktree is gone, or no
 *   source of current state answered. It lands on `waiting` as the one halted
 *   stage that asserts no cause inside the fleet, and the detail carries
 *   upstream's own words for what it could not see. That is the least wrong
 *   position in the frozen vocabulary rather than a good one; see
 *   docs/contract.md - open assumptions.
 */
const STAGE: Readonly<Record<SnapshotTaskState, Stage>> = {
  working: "working",
  parked: "held",
  blocked: "blocked",
  done: "landed",
  failed: "failed",
  paused: "waiting",
  unknown: "waiting",
  dispatched: "dispatched",
  validating: "validating",
  pr_open: "pr-open",
  in_review: "in-review",
  waiting_external: "waiting",
  landed: "landed",
};

/**
 * A worker's kind is free text upstream copies from its dispatch record, so
 * this maps the one value that means research and treats everything else -
 * including a kind this build has never seen - as building. The alternative,
 * refusing a snapshot over a word in a dispatch record, would take the whole
 * fleet lens down for a worker the panel could otherwise draw.
 */
const RESEARCH_KIND = "scout";

function kindOf(kind: string): WorkerKind {
  return kind.trim().toLowerCase() === RESEARCH_KIND ? "research" : "build";
}

/**
 * Upstream copies a record's priority out of a hand-written backlog, so the
 * words are whatever the operator wrote. Two spellings are recognised: the
 * document's own, and the numeric ranks a fleet writes in practice.
 */
const PRIORITY: Readonly<Record<string, Priority>> = {
  "1": "now",
  now: "now",
  "2": "next",
  next: "next",
  "3": "later",
  later: "later",
};

/**
 * An unrecognised or absent priority is `later` rather than `now`: a row that
 * did not say how urgent it is has not claimed the top of the deck, and
 * promoting it would push something that did say down the list.
 */
function priorityOf(priority: string | null): Priority {
  return (priority && PRIORITY[priority.trim().toLowerCase()]) || "later";
}

/** A calendar date, `YYYY-MM-DD`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A record's start, as an instant.
 *
 * Upstream reports it as the operator wrote it: usually a calendar date, which
 * widens to midnight UTC, occasionally a full instant, and sometimes nothing at
 * all. A row that did not say falls back to the moment upstream looked, which
 * reads as an age of zero - the honest shape of "this has not been waiting as
 * far as anyone can tell", and better than dropping the item off the deck.
 */
function sinceOf(since: string | null, generated: string): string {
  if (since === null) return generated;
  if (ISO_DATE.test(since) && !Number.isNaN(Date.parse(since))) {
    return `${since}T00:00:00.000Z`;
  }
  return isIsoInstant(since) ? since : generated;
}

/**
 * A deferral is to a day. Anything else in the field is prose rather than a
 * date the panel can measure a wait against, so it is not carried as one.
 */
function deferredTo(holdUntil: string | null): string | null {
  return holdUntil !== null && ISO_DATE.test(holdUntil) ? holdUntil : null;
}

/**
 * Upstream records where a worker is working as a path. The document carries a
 * name, so the last segment is what a reader sees - and the machine-specific
 * part of an operator's directory layout never reaches a rendered page.
 */
function projectOf(project: string): string {
  return project.split("/").filter(Boolean).at(-1) ?? "";
}

const DECK_STATE: Readonly<Record<Exclude<SnapshotRecordState, "done">, DeckState>> = {
  queued: "queued",
  in_flight: "in-flight",
};

/** The pipeline's own step names, which is why they can be found in its prose. */
const STEPS: ReadonlySet<string> = new Set([
  "intent",
  "rebase",
  "review",
  "test",
  "document",
  "lint",
  "push",
  "pr",
  "ci",
]);

const HALTED: ReadonlySet<Stage> = new Set(["blocked", "held", "waiting", "failed"]);

/**
 * The fine step inside a stage, read out of upstream's own words.
 *
 * Upstream reports one reconciled state per worker with a prose `detail` - so
 * the step is in there ("parked at review: 1 finding(s)") or there is no step
 * to name ("validating (running)"). The first pipeline word in the detail wins.
 *
 * Only looked for while validating, or while stopped: the pipeline is what
 * produces these words, and outside it "review" means a person reading a pull
 * request rather than the pipeline's review step.
 */
function stepOf(stage: Stage, detail: string): ValidationStep | null {
  if (stage !== "validating" && !HALTED.has(stage)) return null;
  for (const word of detail.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (STEPS.has(word)) return word as ValidationStep;
  }
  return null;
}

/**
 * Upstream's word for a backlog row closed by a merge, as opposed to one
 * reported or ticked off without one.
 */
const MERGED = "merged";

/**
 * Where a finished run leaves the worker.
 *
 * Upstream reconciles both "the pull request merged" and "the checks went green
 * and it is waiting to be read" to `done`. The first is the end of the on-track
 * sequence; the second is a pull request somebody still has to look at, and
 * showing it as landed is how an operator comes to skip the one thing asking
 * for their attention. The worker's own backlog row says which, so this asks it
 * rather than reading the prose in `detail`.
 */
function finishedStage(task: SnapshotTask): Stage {
  if (task.completion === MERGED) return "landed";
  return task.pr.url === null ? "landed" : "pr-open";
}

function projectWorker(task: SnapshotTask): Worker {
  const state = task.current_state.state;
  const stage = state === "done" ? finishedStage(task) : STAGE[state];
  return {
    id: task.id,
    project: projectOf(task.project),
    kind: kindOf(task.kind),
    brief: { ref: task.paths.meta.path, present: task.paths.meta.present },
    worktree: { ref: task.paths.worktree.path, present: task.paths.worktree.present },
    lifecycle: {
      stage,
      step: stepOf(stage, task.current_state.detail),
      detail: task.current_state.detail,
      observedAt: task.current_state.observed_at,
    },
    pullRequest:
      task.pr.url === null
        ? null
        : {
            url: task.pr.url,
            // Only a merge lands a pull request. A worker that has stopped for
            // any other reason still has one somebody can open.
            state: stage === "landed" ? "landed" : "open",
            // Upstream's snapshot carries a pull request's address but not what
            // its checks say. Nothing reads the forge yet, so `unknown` is the
            // honest answer rather than a cheerful default.
            checks: "unknown",
          },
  };
}

function projectDeckItem(record: SnapshotRecord, generated: string): DeckItem {
  return {
    id: record.id,
    // Upstream cleans a row's prose down to its title, which can leave nothing
    // when the row was only an id. The id is then the only name it has.
    title: record.title || record.id,
    // `done` is filtered out before this runs; the deck is what is still coming.
    state: DECK_STATE[record.state as Exclude<SnapshotRecordState, "done">],
    priority: priorityOf(record.priority),
    since: sinceOf(record.since, generated),
    blocked:
      record.blocked_by_ids.length === 0
        ? null
        : { ids: record.blocked_by_ids, reason: record.blocked_reason },
    hold:
      record.hold_kind === null
        ? null
        : {
            waitingOn: record.hold_kind,
            reason: record.hold_reason,
            deferredTo: deferredTo(record.hold_until),
          },
    actionable: record.captain_actionable,
  };
}

export interface ProjectOptions {
  readonly clock: Clock;
  /** Content older than this is still shown, but marked stale. */
  readonly staleAfterMs: number;
}

/**
 * Fresh or stale, for content that was read cleanly.
 *
 * States the policy that was breached rather than the age. How old the content
 * is is already in `asOf` and `ageMs`; phrasing it for a reader is the UI's job.
 */
function freshness(asOf: string, { clock, staleAfterMs }: ProjectOptions): LensStatus {
  const ageMs = clock.nowMs() - Date.parse(asOf);
  if (ageMs <= staleAfterMs) return { state: "fresh", asOf };
  return {
    state: "stale",
    asOf,
    ageMs,
    detail: `Older than the ${Math.round(staleAfterMs / 1000)}s freshness window; the fleet may have moved on.`,
  };
}

function unreadable(detail: string, clock: Clock): LensStatus {
  return { state: "unreadable", observedAt: clock.now(), detail };
}

/** Every signal dark, with the same one-line reason. */
function darkHealth(detail: string): Health {
  const signal = { read: "unreadable", detail } as const;
  return { supervisor: signal, overdue: signal, drift: signal };
}

/**
 * The health lens, projected on its own.
 *
 * Separate from the fleet and deck because it comes from a different reader
 * with a different promise: a snapshot that will not parse leaves the fleet on
 * last-known-good, while health simply goes dark. Either can happen without the
 * other, which is what the per-lens status exists to express.
 */
export function projectHealth(reading: HealthReading, options: ProjectOptions): Lens<Health> {
  if (reading.read === "unreadable") {
    return {
      content: darkHealth(reading.detail),
      status: unreadable(reading.detail, options.clock),
    };
  }
  return { content: reading.health, status: freshness(reading.asOf, options) };
}

export function projectDocument(
  snapshot: FleetSnapshot,
  health: HealthReading,
  options: ProjectOptions,
): PanelDocument {
  const asOf = snapshot.generated;
  const deck = snapshot.backlog.records
    .filter((record) => record.state !== "done")
    .map((record) => projectDeckItem(record, asOf));

  return {
    version: DOCUMENT_VERSION,
    generatedAt: options.clock.now(),
    fleet: { content: snapshot.tasks.map(projectWorker), status: freshness(asOf, options) },
    deck: {
      content: snapshot.backlog.present ? deck : [],
      status: snapshot.backlog.present
        ? freshness(asOf, options)
        : unreadable("Upstream could not read the backlog.", options.clock),
    },
    health: projectHealth(health, options),
  };
}

/**
 * Re-label the lenses the snapshot fills, keeping what the panel is still
 * showing, after a read failed.
 *
 * The alternative - replacing them with an error - throws away the only useful
 * thing on screen at the moment the operator most wants to look at it. Health
 * is re-projected from its own fresh reading rather than carried over: the two
 * readers fail independently, so one being down says nothing about the other.
 *
 * `previous` is null on the first read of a process, where there is nothing to
 * fall back to. The panel still renders - two empty lenses that say why they
 * are empty, and a health lens that may be perfectly fine.
 */
export function withSnapshotUnreadable(
  previous: PanelDocument | null,
  detail: string,
  health: HealthReading,
  options: ProjectOptions,
): PanelDocument {
  const status = unreadable(detail, options.clock);
  return {
    version: DOCUMENT_VERSION,
    generatedAt: options.clock.now(),
    fleet: { content: previous?.fleet.content ?? [], status },
    deck: { content: previous?.deck.content ?? [], status },
    health: projectHealth(health, options),
  };
}
