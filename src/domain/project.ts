import type {
  FleetSnapshot,
  SnapshotActiveState,
  SnapshotChecks,
  SnapshotRecord,
  SnapshotRecordState,
  SnapshotReview,
  SnapshotSecondmateLanded,
  SnapshotTask,
  SnapshotTaskState,
} from "../adapters/contract.ts";
import type { HealthReading } from "../adapters/health.ts";
import { isIsoInstant, type Clock } from "../providers/clock.ts";
import {
  DOCUMENT_VERSION,
  type ActiveStage,
  type ChecksSignal,
  type DeckItem,
  type DeckState,
  type Delivery,
  type Health,
  type LandedItem,
  type Lens,
  type LensStatus,
  type Omission,
  type PanelDocument,
  type Priority,
  type ReviewSignal,
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
 *   source of current state answered. It lands on `unseen`, which is the
 *   document's way of not answering either - it asserts no position on the
 *   track and no reason for stopping, and the detail carries upstream's own
 *   words for what it could not see.
 */
const STAGE: Readonly<Record<SnapshotTaskState, Stage>> = {
  working: "working",
  parked: "held",
  blocked: "blocked",
  done: "landed",
  failed: "failed",
  paused: "waiting",
  unknown: "unseen",
  dispatched: "dispatched",
  validating: "validating",
  pr_open: "pr-open",
  in_review: "in-review",
  waiting_external: "waiting",
  landed: "landed",
};

/**
 * A kind is free text - upstream copies a worker's from its dispatch record and
 * a deck row's from a `(kind: ...)` annotation - so this maps the one value
 * that means research and treats everything else, including a kind this build
 * has never seen, as building. A live fleet writes `ship`, `scout`, `task` and
 * `docs`; only the second is research. The alternative, refusing a snapshot
 * over a word somebody typed, would take a whole lens down for a row the panel
 * could otherwise draw.
 *
 * Absence is the caller's to decide. A worker always has a kind, so its empty
 * string reads as building; a deck row that named none says so instead.
 */
const RESEARCH_KIND = "scout";

function kindOf(kind: string): WorkerKind {
  return kind.trim().toLowerCase() === RESEARCH_KIND ? "research" : "build";
}

/**
 * Upstream's delivery contracts, in its own spelling.
 *
 * A live fleet writes `no-mistakes`, `direct-PR` and `local-only` for ship work
 * and `secondmate` for a persistent mate, which is a role rather than a
 * delivery contract and so maps to nothing.
 */
const DELIVERY: Readonly<Record<string, Delivery>> = {
  "no-mistakes": "validated",
  "direct-pr": "direct-pr",
  "local-only": "local",
};

/**
 * A contract this build does not recognise is `null`, not a default.
 *
 * Deliberately the opposite rule to `kindOf`, whose unknown falls back to
 * building. A worker with an unrecognised kind is still a worker doing
 * something, so guessing costs a word. A worker with an unrecognised delivery
 * contract has an unknown number of stages ahead of it, so guessing costs a
 * rail with steps the work will never reach - which is a drawing of progress
 * that cannot be true. A lens that does not know the shape draws no shape.
 */
function deliveryOf(mode: string | null): Delivery | null {
  return (mode && DELIVERY[mode.trim().toLowerCase()]) || null;
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
 * A record's start, at the precision the record carries, or `null` when there
 * is no start to give.
 *
 * Upstream reports it as the operator wrote it: usually a calendar date, which
 * stays a calendar date, occasionally a full instant, and often nothing at all.
 * The day is deliberately not widened to midnight. A backlog line reads
 * `(since 2026-08-31)` and carries no time, so a midnight it never stated is a
 * fact invented here, and a reader downstream counts hours from it and prints
 * an age that looks measured and is not - a row filed that morning read "14h
 * ago" in the evening, which was the distance from midnight rather than the age
 * of the work. `deferredTo` and `landedOn` below carry a day the same way.
 *
 * A row that did not say, or said something that is neither a day nor an
 * instant, gets `null` - not the moment upstream looked. The two are different
 * facts, and dating a row from the read makes an item that has been queued for
 * a month read as having just arrived.
 */
function sinceOf(since: string | null): string | null {
  if (since === null) return null;
  if (ISO_DATE.test(since) && !Number.isNaN(Date.parse(since))) return since;
  return isIsoInstant(since) ? since : null;
}

/**
 * A deferral is to a day. Anything else in the field is prose rather than a
 * date the panel can measure a wait against, so it is not carried as one.
 */
function deferredTo(holdUntil: string | null): string | null {
  return holdUntil !== null && ISO_DATE.test(holdUntil) ? holdUntil : null;
}

/**
 * When work landed is a day, and the same rule a deferral gets.
 *
 * Not a theoretical case: a live fleet's completion date is lifted out of a
 * hand-written record, and one real row was found carrying a whole sentence
 * there - a commit, a pull request address, and what is still needed from the
 * operator, all in the field the panel promises a date for. A sentence rendered
 * as a date is a dishonest render, and a hundred characters in a date-shaped
 * slot is the exact shape that bursts a lens frame sideways. The words are
 * still on the record; they are not a date, so the document does not carry
 * them as one.
 */
function landedOn(date: string | null): string | null {
  return date !== null && ISO_DATE.test(date) ? date : null;
}

/**
 * Upstream records where a worker is working as a path. The document carries a
 * name, so the last segment is what a reader sees - and the machine-specific
 * part of an operator's directory layout never reaches a rendered page.
 */
function projectOf(project: string): string {
  return project.split("/").filter(Boolean).at(-1) ?? "";
}

const DECK_STATE: Readonly<
  Record<Exclude<SnapshotRecordState, "done">, DeckState>
> = {
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

const HALTED: ReadonlySet<Stage> = new Set([
  "blocked",
  "held",
  "waiting",
  "failed",
]);

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
 * Upstream's six on-track states, mapped onto the document's spelling of them.
 *
 * A separate table from `STAGE` rather than a filtered view of it, because the
 * two answer different questions and only this one is closed to active stages.
 * The parser has already refused anything that is not one of these, so there is
 * no absent arm here: what arrives is a stage or it is `null`.
 */
const LAST_ACTIVE_STAGE: Readonly<Record<SnapshotActiveState, ActiveStage>> = {
  dispatched: "dispatched",
  working: "working",
  validating: "validating",
  pr_open: "pr-open",
  in_review: "in-review",
  landed: "landed",
};

/**
 * The stage a worker was in before it stopped, carried and never worked out.
 *
 * Deliberately not derived from `detail` or from the `step` beside it. The
 * document seam refused a prior-stage field precisely because anything it could
 * hold would be computable from the field next to it, and computing one here
 * would earn that refusal all over again - worse, it would let the document
 * assert `validating` for a worker whose delivery contract skips the pipeline,
 * because the projection cannot see which rail a worker has and so cannot tell
 * that its own answer is impossible. Upstream asserts this or nobody does.
 */
function lastActiveStageOf(
  state: SnapshotActiveState | null,
): ActiveStage | null {
  return state === null ? null : LAST_ACTIVE_STAGE[state];
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

/**
 * A forge reading upstream carried, or the honest statement that nobody looked.
 *
 * The absent case is `not-looked-up` and never `unreadable`: reading the forge
 * is opt-in and off the first paint, so a snapshot carrying no checks block is
 * a read nobody has done rather than a read that failed. Conflating the two
 * would report an ordinary fast page as a broken one.
 */
function checksOf(checks: SnapshotChecks | null): ChecksSignal {
  if (checks === null) return { read: "not-looked-up" };
  if (checks.read === "unreadable")
    return { read: "unreadable", detail: checks.detail };
  return {
    read: "ok",
    outcome: checks.outcome,
    finished: checks.finished,
    total: checks.total,
    asOf: checks.as_of,
  };
}

function reviewOf(review: SnapshotReview | null): ReviewSignal {
  if (review === null) return { read: "not-looked-up" };
  if (review.read === "unreadable")
    return { read: "unreadable", detail: review.detail };
  return { read: "ok", comments: review.comments, asOf: review.as_of };
}

function projectWorker(task: SnapshotTask): Worker {
  const state = task.current_state.state;
  const stage = state === "done" ? finishedStage(task) : STAGE[state];
  return {
    id: task.id,
    project: projectOf(task.project),
    kind: kindOf(task.kind),
    delivery: deliveryOf(task.mode),
    brief: {
      ref: task.paths.meta.path,
      present: task.paths.meta.present,
      summary: task.brief.summary,
      text: task.brief.text,
    },
    worktree: {
      ref: task.paths.worktree.path,
      present: task.paths.worktree.present,
    },
    // Carried exactly as recorded, nulls included. Nothing here is derived from
    // anything else on the worker: a branch guessed from an id, or a model
    // guessed from a harness, would be the panel stating a fact about where the
    // work is that nobody wrote down.
    dispatch: {
      branch: task.branch,
      runtime: task.harness,
      model: task.model,
      effort: task.effort,
    },
    lifecycle: {
      stage,
      step: stepOf(stage, task.current_state.detail),
      lastActiveStage: lastActiveStageOf(task.current_state.last_active_state),
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
            checks: checksOf(task.pr.checks),
            review: reviewOf(task.pr.review),
          },
  };
}

function projectDeckItem(record: SnapshotRecord): DeckItem {
  return {
    id: record.id,
    // Upstream cleans a row's prose down to its title, which can leave nothing
    // when the row was only an id. The id is then the only name it has.
    title: record.title || record.id,
    // Upstream's `repo` is already a name rather than a path - it is copied out
    // of a `(repo: ...)` annotation, not off disk - so it is carried as
    // written. A worker's `project` needs reducing; this does not.
    project: record.repo,
    // The same rule a worker's kind gets, and deliberately the same function: a
    // second reading of one upstream field would drift from the first. What
    // differs is the absence - a row that named no kind says so, where a
    // worker with no kind is still a worker doing something.
    kind: record.kind === null ? null : kindOf(record.kind),
    // `done` is filtered out before this runs; the deck is what is still coming.
    state: DECK_STATE[record.state as Exclude<SnapshotRecordState, "done">],
    priority: priorityOf(record.priority),
    since: sinceOf(record.since),
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

/* ------------------------------------------------------------------ the landed */

/**
 * Work that finished in the home being looked at.
 *
 * Drawn from the `done` rows of the same backlog the deck comes from - upstream
 * publishes no separate landed list for this home - and stamped with the home
 * the snapshot says it describes. `where` is the field a lens reads to tell
 * this home's work from a second mate's; the home name is what it says out
 * loud, and is `null` when the snapshot did not name one rather than defaulted
 * to "here", which would attribute unattributed work to the fleet on screen.
 */
function projectLandedHere(
  record: SnapshotRecord,
  home: string | null,
): LandedItem {
  return {
    id: record.id,
    title: record.title || record.id,
    where: "this-home",
    home,
    project: record.repo,
    pullRequest: record.pr_url,
    closedAs: record.completion?.verb ?? null,
    landedOn: landedOn(record.completion?.date ?? null),
  };
}

/**
 * Work a second mate landed in its own home.
 *
 * Upstream's roll-up carries no project per record, so `project` is `null` for
 * every one of these - honestly, rather than by borrowing the parent home's
 * name for work that did not happen there.
 */
function projectLandedElsewhere(
  landed: SnapshotSecondmateLanded,
): readonly LandedItem[] {
  return landed.records.map((record) => ({
    id: record.id,
    title: record.title || record.id,
    where: "second-mate" as const,
    home: record.home,
    project: null,
    pullRequest: record.pr_url,
    closedAs: record.completion?.verb ?? null,
    landedOn: landedOn(record.completion?.date ?? null),
  }));
}

/* --------------------------------------------------------- the omissions */

/**
 * Everything the document does not carry, and why.
 *
 * Assembled here rather than in a component so that an absence cannot be
 * introduced by a reader that forgets to declare it: the projection is the one
 * place that knows both what upstream sent and what it said it could not send.
 *
 * Three sources, and each keeps its own reason. Upstream's own declarations
 * about the second mates' homes travel through unchanged - a bound it applied
 * is `not-shown`, a home that did not answer is `unreadable`, and a home that
 * answered without full trust is `unreadable` too, because a partial read is a
 * read that did not fully succeed and calling it a bound would make it sound
 * deliberate. The backlog being unreadable is upstream's, and the forge not
 * having been read is the panel's own, which is the one absence on this page
 * that is nobody's failure.
 */
function omissionsOf(
  snapshot: FleetSnapshot,
  workers: readonly Worker[],
): readonly Omission[] {
  const omissions: Omission[] = [];

  if (!snapshot.backlog.present) {
    omissions.push({
      what: "queued and landed work",
      reason: "unreadable",
      detail:
        "Upstream could not read the backlog, so neither the deck nor this home's landed work is on this page.",
    });
  }

  const unreadChecks = workers.filter(
    (worker) =>
      worker.pullRequest !== null &&
      worker.pullRequest.checks.read === "not-looked-up",
  ).length;
  if (unreadChecks > 0) {
    omissions.push({
      what: "pull request checks",
      reason: "not-looked-up",
      detail: `Nothing has read the checks for ${unreadChecks} pull request${unreadChecks === 1 ? "" : "s"}; that read is opt-in and off the first paint.`,
    });
  }

  const unreadReview = workers.filter(
    (worker) =>
      worker.pullRequest !== null &&
      worker.pullRequest.review.read === "not-looked-up",
  ).length;
  if (unreadReview > 0) {
    omissions.push({
      what: "pull request review comments",
      reason: "not-looked-up",
      detail: `Nothing has read the review comments for ${unreadReview} pull request${unreadReview === 1 ? "" : "s"}; that read is opt-in and off the first paint.`,
    });
  }

  const landed = snapshot.secondmate_landed;
  for (const home of landed.truncated) {
    omissions.push({
      what: `landed work in ${home}`,
      reason: "not-shown",
      detail: `Upstream bounded how much of ${home}'s landed work it reports, and the rest is past that bound.`,
    });
  }
  for (const home of landed.unreadable) {
    omissions.push({
      what: `landed work in ${home}`,
      reason: "unreadable",
      detail: `${home} did not answer, so nothing it landed is on this page.`,
    });
  }
  for (const home of landed.partial) {
    omissions.push({
      what: `landed work in ${home}`,
      reason: "unreadable",
      detail: `${home} answered with a reading upstream does not fully trust, so what it landed may be incomplete.`,
    });
  }

  return omissions;
}

interface ProjectOptions {
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
function freshness(
  asOf: string,
  { clock, staleAfterMs }: ProjectOptions,
): LensStatus {
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
  return {
    supervisor: signal,
    queue: signal,
    attendance: signal,
    overdue: signal,
    drift: signal,
  };
}

/**
 * The health lens, projected on its own.
 *
 * Separate from the fleet and deck because it comes from a different reader
 * with a different promise: a snapshot that will not parse leaves the fleet on
 * last-known-good, while health simply goes dark. Either can happen without the
 * other, which is what the per-lens status exists to express.
 */
function projectHealth(
  reading: HealthReading,
  options: ProjectOptions,
): Lens<Health> {
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
    .map(projectDeckItem);
  // Second-mate work is rolled up separately from the backlog and survives the
  // backlog being unreadable, so it is added after the `present` gate rather
  // than inside it: a home this panel cannot read says nothing about a home it
  // can, and dropping a second mate's landed work over the parent's backlog is
  // exactly how a prior board lost it.
  const landed = [
    ...(snapshot.backlog.present
      ? snapshot.backlog.records
          .filter((record) => record.state === "done")
          .map((record) => projectLandedHere(record, snapshot.fm_home))
      : []),
    ...projectLandedElsewhere(snapshot.secondmate_landed),
  ];
  const workers = snapshot.tasks.map(projectWorker);

  return {
    version: DOCUMENT_VERSION,
    generatedAt: options.clock.now(),
    fleet: { content: workers, status: freshness(asOf, options) },
    deck: {
      content: snapshot.backlog.present ? deck : [],
      status: snapshot.backlog.present
        ? freshness(asOf, options)
        : unreadable("Upstream could not read the backlog.", options.clock),
    },
    // The landed lens shares the snapshot's promise, so it shares the deck's
    // status: both are dark when upstream could not read the backlog, and both
    // are as fresh as the read that produced them.
    landed: {
      content: landed,
      status: snapshot.backlog.present
        ? freshness(asOf, options)
        : unreadable("Upstream could not read the backlog.", options.clock),
    },
    health: projectHealth(health, options),
    omissions: omissionsOf(snapshot, workers),
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
    landed: { content: previous?.landed.content ?? [], status },
    health: projectHealth(health, options),
    // The read that would have said what is missing is the read that failed, so
    // the only honest list is the one the last good document carried. Inventing
    // a fresh one from a snapshot there is no snapshot for would be the
    // disclosure bar making a claim about a page it never saw.
    omissions: previous?.omissions ?? [],
  };
}
