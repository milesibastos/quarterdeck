/**
 * The panel's own document: the single shape `src/ui/` renders.
 *
 * This file is the head of the layer order and imports nothing, deliberately.
 * Anything the UI needs to show has to arrive here first, which is what stops
 * a component from reaching back into the fleet to fetch one missing field.
 *
 * Three lenses read it - fleet, deck, shipshape - and each gets its own
 * envelope entry rather than sharing one. See `docs/contract.md` for the shape
 * in prose and `docs/decisions/2026-08-30-the-document-seam.md` for why the
 * choices below are the way they are.
 *
 * Version history lives in docs/contract.md.
 */

/** Bumped when this shape changes in a way a reader must notice. */
export const DOCUMENT_VERSION = 3;

/* -------------------------------------------------------- the envelope */

/**
 * How much a lens's content can be trusted, per lens.
 *
 * There is deliberately no single `degraded` flag on the document. Fleet and
 * deck arrive from one upstream contract that either parses or refuses; health
 * is read from files that carry no compatibility promise and may simply have
 * moved. Two reliability promises meeting in one document is the whole reason
 * the shipshape lens can go dark while the other two keep working, and a
 * document-wide flag would throw that away.
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
  readonly health: Lens<Health>;
}

/* ------------------------------------------------------------ the fleet */

/**
 * What kind of work a worker was dispatched to do. Researching and building are
 * different kinds of work and the panel shows them differently.
 */
export type WorkerKind = "build" | "research";

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

export type PullRequestState = "open" | "landed";

/**
 * What a pull request's checks say.
 *
 * `unknown` is the honest answer while nothing reads the forge: upstream's
 * snapshot carries a pull request's address but not its checks, so the value is
 * `unknown` for every worker today. See docs/contract.md - open assumptions.
 */
export type ChecksState = "pending" | "passing" | "failing" | "unknown";

export interface PullRequest {
  readonly url: string;
  readonly state: PullRequestState;
  readonly checks: ChecksState;
}

export interface Worker {
  /** The work item the worker was dispatched on. Stable, and the UI's React key. */
  readonly id: string;
  readonly project: string;
  readonly kind: WorkerKind;
  /** A pointer to the instructions the worker was dispatched with. */
  readonly brief: PathRef;
  /** The isolated copy of the repository the worker is working in. */
  readonly worktree: PathRef;
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
   * ISO-8601 instant the item entered `state`, or `null` when no start date was
   * recorded. A hold's age is measured from here.
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

export interface Health {
  readonly supervisor: SupervisorSignal;
  readonly overdue: OverdueSignal;
  readonly drift: DriftSignal;
}
