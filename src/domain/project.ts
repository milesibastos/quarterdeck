import type {
  FleetSnapshot,
  SnapshotRecord,
  SnapshotRecordState,
  SnapshotTask,
  SnapshotTaskKind,
  SnapshotTaskState,
} from "../adapters/contract.ts";
import type { HealthReading } from "../adapters/health.ts";
import type { Clock } from "../providers/clock.ts";
import {
  DOCUMENT_VERSION,
  type DeckItem,
  type DeckState,
  type Health,
  type Lens,
  type LensStatus,
  type PanelDocument,
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
 */
const STAGE: Readonly<Record<SnapshotTaskState, Stage>> = {
  dispatched: "dispatched",
  working: "working",
  validating: "validating",
  pr_open: "pr-open",
  in_review: "in-review",
  landed: "landed",
  blocked: "blocked",
  parked: "held",
  waiting_external: "waiting",
  failed: "failed",
};

const KIND: Readonly<Record<SnapshotTaskKind, WorkerKind>> = {
  ship: "build",
  scout: "research",
};

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

function projectWorker(task: SnapshotTask): Worker {
  const stage = STAGE[task.current_state.state];
  return {
    id: task.id,
    project: task.project,
    kind: KIND[task.kind],
    brief: { ref: task.paths.meta.path, present: task.paths.meta.present },
    worktree: { ref: task.paths.worktree.path, present: task.paths.worktree.present },
    lifecycle: {
      stage,
      step: stepOf(stage, task.current_state.detail),
      detail: task.current_state.detail,
      observedAt: task.current_state.observed_at,
    },
    pullRequest:
      task.pr === null
        ? null
        : {
            url: task.pr.url,
            state: stage === "landed" ? "landed" : "open",
            // Upstream's snapshot carries a pull request's address but not what
            // its checks say. Nothing reads the forge yet, so `unknown` is the
            // honest answer rather than a cheerful default.
            checks: "unknown",
          },
  };
}

function projectDeckItem(record: SnapshotRecord): DeckItem {
  return {
    id: record.id,
    title: record.title,
    // `done` is filtered out before this runs; the deck is what is still coming.
    state: DECK_STATE[record.state as Exclude<SnapshotRecordState, "done">],
    priority: record.priority,
    since: record.since,
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
            deferredTo: record.hold_until,
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
  const asOf = snapshot.generated_at;
  const deck = snapshot.backlog.records
    .filter((record) => record.state !== "done")
    .map(projectDeckItem);

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
