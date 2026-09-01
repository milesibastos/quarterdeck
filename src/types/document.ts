/**
 * The panel's own document: the single shape `src/ui/` renders.
 *
 * This file is the head of the layer order and imports nothing, deliberately.
 * Anything the UI needs to show has to arrive here first, which is what stops
 * a component from reaching back into the fleet to fetch one missing field.
 *
 * Four regions, each with its own envelope entry rather than sharing one -
 * fleet, deck, landed and shipshape - plus one statement about the page as a
 * whole, `omissions`. See `docs/contract.md` for the shape in prose and
 * `docs/decisions/2026-08-30-the-document-seam.md` for why the choices below
 * are the way they are.
 *
 * Version history lives in docs/contract.md.
 */

/** Bumped when this shape changes in a way a reader must notice. */
export const DOCUMENT_VERSION = 5;

/* -------------------------------------------------------- the envelope */

/**
 * How much a lens's content can be trusted, per lens.
 *
 * There is deliberately no single `degraded` flag on the document. Fleet,
 * deck and landed arrive from one upstream contract that either parses or
 * refuses; health is read from files that carry no compatibility promise and
 * may simply have moved. Two reliability promises meeting in one document is
 * the whole reason the shipshape lens can go dark while the other three keep
 * working, and a document-wide flag would throw that away.
 */
export type LensStatus =
  /** Read cleanly, and current as of `asOf`. */
  | { readonly state: "fresh"; readonly asOf: string }
  /** Read cleanly but too long ago to trust. `content` is still worth showing. */
  | {
      readonly state: "stale";
      /** ISO-8601 instant the content was current as of. */
      readonly asOf: string;
      /** How far past the freshness window it is. */
      readonly ageMs: number;
      /** One line, written for the operator, naming the policy that was breached. */
      readonly detail: string;
    }
  /**
   * Could not be read at all. `content` is whatever the lens last had - which
   * may be nothing - and the panel says so rather than showing a blank area.
   */
  | {
      readonly state: "unreadable";
      /** ISO-8601 instant the panel noticed. */
      readonly observedAt: string;
      /** One line, written for the operator, naming the concrete problem. */
      readonly detail: string;
    };

/** One lens's content and how much of it can be trusted. */
export interface Lens<T> {
  readonly content: T;
  readonly status: LensStatus;
}

export interface PanelDocument {
  readonly version: number;
  /** ISO-8601 instant this document was assembled. Per-lens ages are in `status`. */
  readonly generatedAt: string;
  readonly fleet: Lens<readonly Worker[]>;
  readonly deck: Lens<readonly DeckItem[]>;
  /**
   * Work that finished, including what a second mate landed in its own home.
   *
   * Its own lens rather than a corner of the deck: the deck is what is still
   * coming, by the rule below it, and landed work arrives partly from homes the
   * deck knows nothing about. A home that could not be read costs an entry in
   * `omissions`, not the lens.
   */
  readonly landed: Lens<readonly LandedItem[]>;
  readonly health: Lens<Health>;
  /**
   * Everything this document does not carry, and why.
   *
   * Not a lens - it is a statement about the page rather than a part of it, and
   * it is deliberately on the document rather than assembled in a component, so
   * that an absence cannot be introduced by a reader that forgets to mention
   * it. Empty means nothing was left out, which is itself a fact worth being
   * able to state.
   */
  readonly omissions: readonly Omission[];
}

/**
 * Why something the wireframe asks for is not on the page.
 *
 * Three reasons, and they are not interchangeable. `not-shown` is a deliberate
 * bound - a list cut to a length, a filter the operator set. `not-looked-up` is
 * work nobody has done yet, which is a thing that could still be done.
 * `unreadable` is a read that was attempted and failed. Folding them into one
 * "missing" would let a bound and a failure look alike, which is the exact
 * ambiguity the disclosure bar exists to remove.
 */
export type OmissionReason = "not-shown" | "not-looked-up" | "unreadable";

export interface Omission {
  /** What is missing, named the way an operator would name it. */
  readonly what: string;
  readonly reason: OmissionReason;
  /** One line, concrete: which bound, which read, which home. */
  readonly detail: string;
}

/* ------------------------------------------------------------ the fleet */

/**
 * What kind of work a worker was dispatched to do. Researching and building are
 * different kinds of work and the panel shows them differently.
 */
export type WorkerKind = "build" | "research";

/**
 * How a worker's finished work is meant to reach the operator.
 *
 * Recorded when the worker is dispatched, never inferred, and - with `kind` -
 * the whole of what decides which stages a worker can ever reach. `validated`
 * runs the full pipeline and ends in a merged pull request; `direct-pr` skips
 * the pipeline and opens one anyway; `local` never opens one at all. Research
 * has no delivery contract: it produces a report, and a scout's `delivery` is
 * `null` for that reason rather than for want of a reading.
 *
 * `null` is also what an unrecognised contract reads as, and deliberately so.
 * A kind nobody recognised can safely fall back to building, because a worker
 * is always doing something; a delivery contract cannot, because the fallback
 * would be a rail with stages the work will never reach. A lens that does not
 * know the shape draws no shape.
 */
export type Delivery = "validated" | "direct-pr" | "local";

/**
 * Where the work physically is and what is doing it, as recorded when the
 * worker was dispatched.
 *
 * Every field is nullable and every null means the same single thing: upstream
 * did not record it. There is no second absence to distinguish here - these are
 * not read from the world and then found missing, they are either written down
 * at dispatch or they are not. See `docs/quality.md` for which of them a live
 * fleet publishes today.
 */
export interface Dispatch {
  /** The branch the isolated copy is on. */
  readonly branch: string | null;
  /** What is running the worker - the harness, in upstream's word. */
  readonly runtime: string | null;
  /** The model doing the work. */
  readonly model: string | null;
  /** How hard it was told to think. Free text; upstream sets the vocabulary. */
  readonly effort: string | null;
}

/** The stages a worker moves through while everything is going to plan. */
export type ActiveStage =
  | "dispatched"
  | "working"
  | "validating"
  | "pr-open"
  | "in-review"
  | "landed";

/** The stages a worker stops in. Off the track, each for a different reason. */
export type HaltedStage =
  /** Waiting on another work item. */
  | "blocked"
  /** Waiting for a person to decide something. */
  | "held"
  /** Waiting on something outside the fleet entirely. */
  | "waiting"
  | "failed";

/**
 * Not a position at all: the panel could not see this worker.
 *
 * Upstream says `unknown` when nothing answered for a worker - the worktree was
 * torn down, or no source of current state replied. That is a statement about
 * the panel's own sight, not about where the work got to, so it is neither an
 * active stage nor a halted one. Kept as its own group so that a reader folding
 * the stages into "running" and "stopped" has to decide what to do with it
 * rather than silently counting it as one of them.
 */
export type UnseenStage = "unseen";

export type Stage = ActiveStage | HaltedStage | UnseenStage;

/**
 * The validation pipeline's steps, in the order they run.
 *
 * This is the finer detail inside `validating`: the coarse stage says a worker
 * is being checked, and the step says which check is running.
 */
export type ValidationStep =
  | "intent"
  | "rebase"
  | "review"
  | "test"
  | "document"
  | "lint"
  | "push"
  | "pr"
  | "ci";

export interface Lifecycle {
  readonly stage: Stage;
  /**
   * The pipeline step named inside the stage, or `null` when the stage has no
   * finer detail to give.
   *
   * Not a "not known yet": upstream reconciles every worker in one read, so a
   * worker's fine detail arrives with its coarse stage or does not exist.
   */
  readonly step: ValidationStep | null;
  /**
   * The coarse stage the worker was in before it stopped, as upstream recorded
   * it - or `null` when upstream recorded none.
   *
   * The one question a rail exists to answer about a stopped worker: `stage`
   * says it stopped and why, and this says where it was standing when it did.
   * Without it a stop can only be placed where the panel can reason its way to
   * a position, which is the validation pipeline and nowhere else - so a worker
   * that stopped on a rail with no validating stage draws its rail correctly
   * and shows no position at all.
   *
   * Carried, never derived. Anything computable from `step` or from `detail`
   * would be a field computable from another field, which drifts the first time
   * the derivation changes - the reason the document seam refused a prior-stage
   * field in the first place. What changed is not that the derivation got
   * better; it is that the document now has a slot a finer upstream can assert
   * into. `null` is what every live fleet fills it with today, because upstream
   * publishes no such record and has no vocabulary for one; the evidence, and
   * the commands it was checked with, are in `docs/quality.md` and
   * `docs/decisions/2026-08-31-the-stage-a-stop-happened-in.md`.
   *
   * An active stage and never a halted one. "Where it stopped" is a place on
   * the track, and `blocked` is not a place on the track - a worker that was
   * held and is now blocked has not moved along the rail, so a halted value
   * here would say nothing the `stage` beside it does not already say.
   */
  readonly lastActiveStage: ActiveStage | null;
  /**
   * Upstream's own words for what is happening inside the stage, one line.
   *
   * This is where a halted worker's reason lives - `stage` says it stopped,
   * this says why, in language an operator can act on.
   */
  readonly detail: string;
  /** ISO-8601 instant this reading was taken. */
  readonly observedAt: string;
}

/**
 * A durable pointer to something on disk, with whether it was still there when
 * upstream looked. A pointer that has stopped resolving is worth showing as
 * such rather than as a working link.
 */
export interface PathRef {
  readonly ref: string;
  readonly present: boolean;
}

/**
 * The instructions a worker was dispatched with: where they are, and what they
 * say.
 *
 * A path alone is what a card can only offer a path for. `summary` is the one
 * line a collapsed card shows and `text` is the full instructions behind it,
 * and each is `null` on its own when that much was not carried. A summary with
 * no text behind it is an ordinary shape, not a broken one - a card can have a
 * line to show and nothing behind the click - so a reader must not take a
 * present `summary` as a promise that `text` is there too.
 *
 * `ref` is upstream's own pointer for the worker and is not necessarily the
 * brief file: a live fleet points it at the dispatch record. See
 * `docs/quality.md`.
 */
export interface Brief {
  readonly ref: string;
  readonly present: boolean;
  /** One line, for the card that has not been opened. */
  readonly summary: string | null;
  /** The instructions in full. */
  readonly text: string | null;
}

export type PullRequestState = "open" | "landed";

/** What a run of checks came out as, once somebody has looked. */
export type CheckOutcome = "pending" | "passing" | "failing";

/**
 * What a pull request's checks say, or why the panel is not saying.
 *
 * Three readings, and the first two are the whole point of the shape. Nobody
 * has asked the forge (`not-looked-up`) and the forge was asked and answered
 * (`read: "ok"`) are different facts, and so are a green run and a run nobody
 * looked at. A single string could not hold that: `"unknown"` had to stand for
 * both "we did not ask" and "we asked and could not tell", and a lens reading
 * it could only guess which it was looking at.
 *
 * Reading the forge is a network call, so it is opt-in and off the first paint
 * by design - which makes `not-looked-up` the ordinary answer rather than the
 * exceptional one, and makes it worth being able to state plainly.
 */
export type ChecksSignal =
  /** Nobody has asked the forge. Not a failure; the read is opt-in. */
  | { readonly read: "not-looked-up" }
  /** The forge was asked and could not answer. */
  | { readonly read: "unreadable"; readonly detail: string }
  | {
      readonly read: "ok";
      readonly outcome: CheckOutcome;
      /** How many checks have finished, of how many there are. */
      readonly finished: number;
      readonly total: number;
      /** ISO-8601 instant the forge was last asked. */
      readonly asOf: string;
    };

/**
 * Whether a person has commented on the pull request.
 *
 * The same three readings, for the same reason, and the middle one is what the
 * count exists for: `comments: 0` is a forge that was asked and said nobody has
 * commented, which the panel must never render as the same thing as not having
 * asked. Those are different facts about whether anyone is waiting on the
 * operator.
 */
export type ReviewSignal =
  | { readonly read: "not-looked-up" }
  | { readonly read: "unreadable"; readonly detail: string }
  | {
      readonly read: "ok";
      /** Comments a person left. Zero means the forge said so. */
      readonly comments: number;
      /** ISO-8601 instant the forge was last asked. */
      readonly asOf: string;
    };

export interface PullRequest {
  /** The full address, always. Never a bare number. */
  readonly url: string;
  readonly state: PullRequestState;
  readonly checks: ChecksSignal;
  readonly review: ReviewSignal;
}

export interface Worker {
  /** The work item the worker was dispatched on. Stable, and the UI's React key. */
  readonly id: string;
  readonly project: string;
  readonly kind: WorkerKind;
  /**
   * How the work is meant to ship, or `null` when upstream recorded no contract
   * this build recognises. With `kind`, this is what says which rail a worker
   * even has - an investigation never reaches a pull request, and local-only
   * work never reaches a review.
   */
  readonly delivery: Delivery | null;
  /** The instructions the worker was dispatched with, and the pointer upstream
   * gives for it - which is not always the brief file itself. See `Brief`. */
  readonly brief: Brief;
  /** The isolated copy of the repository the worker is working in. */
  readonly worktree: PathRef;
  /** The rest of what was fixed at dispatch: branch, runtime, model, effort. */
  readonly dispatch: Dispatch;
  readonly lifecycle: Lifecycle;
  readonly pullRequest: PullRequest | null;
}

/* ------------------------------------------------------------- the deck */

/** Where a work item sits. Blocked and held are orthogonal to this; see below. */
export type DeckState = "queued" | "in-flight";

export type Priority = "now" | "next" | "later";

/**
 * Blocked and held are not states but overlays: an item can be queued and held,
 * or in flight and blocked. Upstream keeps them orthogonal and so does this.
 */
export interface Blocked {
  /** The work items it waits on. Never empty; an item with none is not blocked. */
  readonly ids: readonly string[];
  /** One line, upstream's words, or `null` when it said what but not why. */
  readonly reason: string | null;
}

export interface Hold {
  /** Who it waits on. A role, never a person. */
  readonly waitingOn: string;
  /** One line, upstream's words, or `null` when it said who but not why. */
  readonly reason: string | null;
  /** ISO-8601 date it was deferred to, or `null` when it was not deferred. */
  readonly deferredTo: string | null;
}

export interface DeckItem {
  readonly id: string;
  readonly title: string;
  /**
   * The project the work belongs to, or `null` when the row did not say.
   *
   * Enough to recognise a piece of work by, which is what a queue is read for:
   * two rows titled "wire the reader" are different jobs, and the project is
   * what tells them apart.
   */
  readonly project: string | null;
  /**
   * Research or build, or `null` when the row did not say.
   *
   * Nullable where a worker's is not: a worker is dispatched with a kind, and a
   * backlog row is written by hand and often omits it. Guessing `build` for a
   * row that said nothing would put research work under the wrong word.
   */
  readonly kind: WorkerKind | null;
  readonly state: DeckState;
  readonly priority: Priority;
  /**
   * When the item entered `state`, at the precision the record carries: a
   * calendar day, `YYYY-MM-DD`, or a full ISO-8601 instant. `null` when no
   * start date was recorded. A hold's age is measured from here.
   *
   * Two forms, declared rather than incidental, and a reader must tell them
   * apart before phrasing an age. A backlog line usually says `(since
   * 2026-08-31)` and carries no time; widening that to midnight would let the
   * page count hours from a moment the record never stated and print a number
   * that looks measured - see `agoAtPrecision` in `src/ui/lib/age.ts`.
   * `Hold.deferredTo` and `LandedItem.landedOn` carry a day the same way.
   *
   * Nullable because a hand-written backlog row often carries no date at all,
   * and the alternative - stamping it with whenever upstream happened to look -
   * makes every such row read as having just arrived.
   */
  readonly since: string | null;
  readonly blocked: Blocked | null;
  readonly hold: Hold | null;
  /**
   * Waiting on a person right now: queued or held for them, unblocked, and past
   * any deferral date. Upstream's own fold, carried rather than recomputed -
   * two implementations of this would disagree the day the rules change.
   */
  readonly actionable: boolean;
}

/* ----------------------------------------------------------- the landed */

/**
 * Whose home a piece of finished work landed in.
 *
 * Work a second mate landed in its own home is still the operator's work, and
 * prior boards lost it by only ever looking at one home. Carrying which home it
 * was is what stops the two being silently merged into a single list where the
 * operator cannot tell whose fleet did what.
 */
export type LandedWhere = "this-home" | "second-mate";

export interface LandedItem {
  /** The work item. Stable, and the UI's React key. */
  readonly id: string;
  readonly title: string;
  readonly where: LandedWhere;
  /**
   * The home it landed in, or `null` when upstream named none.
   *
   * Nullable rather than defaulted to the panel's own home: a record with no
   * home is a record whose provenance was not stated, and answering "here" for
   * it would attribute a second mate's work to the fleet being looked at.
   */
  readonly home: string | null;
  /** The project, or `null` when the record did not say. */
  readonly project: string | null;
  /** The full address of the pull request it landed as, or `null` for none. */
  readonly pullRequest: string | null;
  /**
   * How it closed, in upstream's own word - `merged`, `reported`, `done` - or
   * `null` when the record did not say. Free text, deliberately: it is copied
   * out of a hand-written record and a word this build has not seen is still
   * worth showing verbatim.
   */
  readonly closedAs: string | null;
  /**
   * The day it closed, `YYYY-MM-DD`, or `null`.
   *
   * `null` for a record that carried no date and for one whose date field held
   * something that is not a date - upstream lifts it out of a hand-written
   * record, and a live fleet has been seen writing a whole sentence there. The
   * same rule `Hold.deferredTo` gets, for the same reason: prose rendered where
   * the panel promised a date is a dishonest render.
   */
  readonly landedOn: string | null;
}

/* ----------------------------------------------------------- the health */

/**
 * A signal that could not be read.
 *
 * Health comes from files with no compatibility promise, so every signal has to
 * be able to say this. The quarantined module's contract is that it degrades
 * rather than throws, and this is the value that contract produces.
 */
export interface Unreadable {
  readonly read: "unreadable";
  /** One line naming what could not be read. */
  readonly detail: string;
}

/** Is the supervision cycle alive, and when was it last seen? */
export type SupervisorSignal =
  | {
      readonly read: "ok";
      readonly alive: boolean;
      /** ISO-8601 instant the cycle was last seen. */
      readonly lastSeen: string;
    }
  | Unreadable;

export interface Overdue {
  readonly id: string;
  /** ISO-8601 instant it started waiting. */
  readonly waitingSince: string;
}

/** Has anything been waiting longer than it should? Empty means nothing has. */
export type OverdueSignal =
  | { readonly read: "ok"; readonly overdue: readonly Overdue[] }
  | Unreadable;

export interface Disagreement {
  /** Which durable record disagrees. */
  readonly record: string;
  /** One line naming how it disagrees with reality. */
  readonly detail: string;
}

/** Does any durable record disagree with reality? Empty means none does. */
export type DriftSignal =
  | { readonly read: "ok"; readonly disagreements: readonly Disagreement[] }
  | Unreadable;

/**
 * Is the notification queue draining?
 *
 * A depth, not a verdict: a queue holding nothing is draining, and a queue that
 * has been holding four things is a fleet that has stopped delivering. Whether
 * a given depth is a problem is the lens's judgement, not this reading's.
 * `queued: 0` is a queue that was read and found empty, which is not the same
 * fact as a queue that could not be read - hence the `Unreadable` arm.
 */
export type QueueSignal =
  | { readonly read: "ok"; readonly queued: number }
  | Unreadable;

/**
 * Is away mode on, and is the home held by a session?
 *
 * One signal carrying two facts rather than two signals, because they are read
 * from the same directory in the same pass and fail together: whatever hides
 * one hides the other, and two signals would only be able to say so twice. The
 * shipshape strip draws them as two entries, which is the lens's business.
 *
 * `locked` is whether a lock is held, and nothing finer. Whether the holder is
 * still alive is the fleet's own liveness policy, and reimplementing that here
 * is exactly what the quarantine exists to refuse - see `docs/quality.md`.
 */
export type AttendanceSignal =
  | { readonly read: "ok"; readonly away: boolean; readonly locked: boolean }
  | Unreadable;

export interface Health {
  readonly supervisor: SupervisorSignal;
  readonly queue: QueueSignal;
  readonly attendance: AttendanceSignal;
  readonly overdue: OverdueSignal;
  readonly drift: DriftSignal;
}
