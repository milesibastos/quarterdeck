import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isIsoInstant } from "../providers/clock.ts";
import type { Runner } from "../providers/process.ts";

/**
 * The upstream boundary.
 *
 * A fleet snapshot arrives here as bytes and leaves as a checked value. Nothing
 * downstream re-checks it, so this file has to be strict: every field is
 * inspected, and anything unexpected throws rather than being coerced into
 * something renderable.
 *
 * The snapshot carries three of the panel's four lenses - the fleet (`tasks`),
 * the deck (`backlog`) and the landed lens (`backlog`'s completed rows and
 * `secondmate_landed`). It does not carry health: that is read from files
 * with no compatibility promise, which is why it lives behind `health.ts` and
 * degrades rather than refusing. Two reliability promises, two readers, and one
 * document with a status per lens.
 *
 * Upstream carries more than this parses - a task's endpoint, its status log,
 * the scout reports, the secondmate rows. Fields no lens reads are not parsed:
 * a value nobody renders is one the next reader has to guess the meaning of.
 *
 * Where the bytes come from is injected (`SnapshotSource`). Two are wired: a
 * committed synthetic fixture set, and a real fleet home. Which one runs is
 * configuration; see `src/config/index.ts`.
 *
 * ## Strict about structure, tolerant about prose
 *
 * Upstream's shape has two halves and they deserve different treatment. What it
 * computes - the schema identifier, the envelope, a task's reconciled state,
 * whether the backlog could be read at all - is a contract, and this file
 * refuses on anything it does not recognise. What it copies out of an operator's
 * hand-written backlog - a record's priority, when it started, who it waits on -
 * is free text that upstream itself parses out of markdown with a regular
 * expression. Refusing the whole deck because somebody typed `(priority: urgent)`
 * in a list item would be a worse panel, so those arrive here as the strings
 * they are and `src/domain/` maps them onto the document's own vocabulary.
 */

/**
 * The schema identifier this build understands, pinned. When upstream ships a
 * new snapshot shape it changes this string, and the panel then refuses instead
 * of rendering fields that have quietly changed meaning.
 */
export const SNAPSHOT_SCHEMA_ID = "fm-fleet-snapshot.v1";

/**
 * The command a fleet home publishes its snapshot through, relative to the home.
 *
 * Read-only by upstream's own contract: it takes no lock, drains nothing, arms
 * nothing and writes nothing. That is the whole reason the panel is allowed to
 * run it while claiming to be a reader.
 *
 * Exported because the panel offers it to the operator as well as running it:
 * the snapshot badge says how old the picture is and, in the same breath, what
 * makes a newer one. It goes out relative, never joined to a home - an operator
 * recognises a fleet by its name, and a machine path in the markup is a path
 * that leaks. See `src/ui/snapshot-badge.tsx`.
 */
const SNAPSHOT_COMMAND = "bin/fm-fleet-snapshot.sh";

/** Asks for the structured surface rather than the human one. */
const SNAPSHOT_ARGS = ["--json"];

/** The whole line, as an operator would type it in the fleet home. */
export const SNAPSHOT_REBUILD = [SNAPSHOT_COMMAND, ...SNAPSHOT_ARGS].join(" ");

/**
 * Where a fleet home keeps the files whose changes mean the snapshot has moved
 * on: the per-worker records, and the backlog the deck is drawn from. Watched,
 * never read - the snapshot command is the only reader of a fleet's internals,
 * and these are just the things to listen to.
 *
 * Both, because they move independently. A worker changing state touches the
 * first and a captain queuing an item touches the second, and watching only the
 * first leaves the deck showing yesterday's backlog until some unrelated worker
 * happens to move.
 */
const FLEET_ACTIVITY_DIRS = ["state", "data"];

/**
 * Upstream's state vocabulary, which is its own. The projection maps it onto
 * the document's, which is what lets upstream rename `parked` without a
 * component changing.
 *
 * Two groups, and the difference matters when this list next needs editing.
 * The first seven are what a live fleet was observed to emit. The rest name
 * finer positions the document can draw but a reconciled snapshot does not
 * currently produce; they are what the fixture fleets use to exercise the whole
 * lifecycle rail. See docs/contract.md - the upstream snapshot.
 */
export type SnapshotTaskState =
  | "working"
  | "parked"
  | "blocked"
  | "done"
  | "failed"
  | "paused"
  | "unknown"
  | "dispatched"
  | "validating"
  | "pr_open"
  | "in_review"
  | "waiting_external"
  | "landed";

/**
 * The states a worker is in while it is still on the track, in upstream's
 * spelling: the six of `SnapshotTaskState` that are places on the rail rather
 * than reasons for leaving it.
 *
 * Its own type because `last_active_state` may only ever be one of these. A
 * worker's last ACTIVE stage is a place on the track, and `blocked` is not a
 * place on the track - accepting one there would let upstream answer "where was
 * it standing" with "it had stopped", which is not an answer.
 */
export type SnapshotActiveState =
  | "dispatched"
  | "working"
  | "validating"
  | "pr_open"
  | "in_review"
  | "landed";

export type SnapshotRecordState = "queued" | "in_flight" | "done";

/** A path upstream reports, with whether it was there when upstream looked. */
export interface SnapshotPath {
  readonly path: string;
  readonly present: boolean;
}

/**
 * The reconciled current state of one worker.
 *
 * `detail` is where the fine step lives, in upstream's own words - "validating
 * (running)", "parked at review: 1 finding(s)". Upstream returns every worker
 * fully reconciled in this one read, so there is no second, finer read and no
 * "not sharpened yet" for the document to carry.
 */
export interface SnapshotCurrentState {
  readonly state: SnapshotTaskState;
  readonly detail: string;
  readonly observed_at: string;
  /**
   * The coarse stage the worker was in before it stopped, or `null` when
   * upstream published none - which is every worker a live fleet reports today.
   *
   * Accepted, not required, and the same arrangement `branch`, `model`, `effort`
   * and `brief` already have. The difference is worth stating: those three are
   * recorded at dispatch and merely not carried out, whereas no fleet records
   * this anywhere at all - firstmate reconciles a worker to seven coarse states
   * and has no vocabulary for `pr_open` or `in_review` in its own tree. So this
   * is a slot a finer upstream can fill without the parser changing, rather
   * than a field waiting to be plumbed through. The evidence, and the commands
   * it was checked with, are in `docs/quality.md`.
   *
   * Present, it is refused like any other computed field: it is upstream's own
   * assertion about a position, not prose lifted out of a hand-written record,
   * and a spelling this build does not recognise is a meaning it would be
   * guessing at.
   */
  readonly last_active_state: SnapshotActiveState | null;
}

/**
 * What a run of a pull request's checks came out as. Computed by whatever read
 * the forge, so it is a closed set and refused when it is not one of these.
 */
export type SnapshotCheckOutcome = "pending" | "passing" | "failing";

/**
 * A forge reading, as upstream would publish it once something reads the forge.
 *
 * Present with `read: "ok"` means it was asked and answered; present with
 * `read: "unreadable"` means it was asked and could not answer. The field being
 * absent altogether means nobody asked, which the projection turns into
 * `not-looked-up` - the ordinary case, because the forge read is deliberately
 * opt-in and off the first paint.
 */
export type SnapshotChecks =
  | {
      readonly read: "ok";
      readonly outcome: SnapshotCheckOutcome;
      readonly finished: number;
      readonly total: number;
      readonly as_of: string;
    }
  | { readonly read: "unreadable"; readonly detail: string };

export type SnapshotReview =
  | { readonly read: "ok"; readonly comments: number; readonly as_of: string }
  | { readonly read: "unreadable"; readonly detail: string };

/**
 * A worker's pull request. `url` is null when upstream found none, which it
 * reports as a present object rather than by leaving the field out.
 *
 * `checks` and `review` are `null` when the field was absent - nobody read the
 * forge - which is every worker a live fleet reports today. See
 * `docs/quality.md`.
 */
export interface SnapshotPullRequest {
  readonly url: string | null;
  readonly checks: SnapshotChecks | null;
  readonly review: SnapshotReview | null;
}

export interface SnapshotTask {
  readonly id: string;
  /**
   * Where the worker is working, as upstream records it - a path in a live
   * fleet. The projection reduces it to a name; nothing renders this verbatim.
   */
  readonly project: string;
  /**
   * What the worker was dispatched to do, in upstream's words. Free text with a
   * default rather than a closed set: it is copied from the worker's own
   * dispatch record.
   */
  readonly kind: string;
  /**
   * What is running the worker - upstream's `harness`. Free text with the same
   * promise `kind` has: copied from the worker's own dispatch record.
   */
  readonly harness: string | null;
  /**
   * The delivery contract the worker was dispatched under - upstream's `mode`.
   * A live fleet writes `no-mistakes`, `direct-PR`, `local-only` and
   * `secondmate`; the projection maps the three that are delivery contracts.
   */
  readonly mode: string | null;
  /**
   * The branch, the model and the effort the worker was dispatched with.
   *
   * A live fleet records all three when it dispatches a worker but publishes
   * none of them in this snapshot, so all three are absent from every real read
   * today and the fixture fleets are what exercise them. Accepted here rather
   * than left out so that a finer upstream fills them without this parser
   * changing - the same arrangement the finer lifecycle states already have.
   * See `docs/quality.md` for the evidence.
   */
  readonly branch: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  /**
   * The dispatch instructions' own text, summarised and in full.
   *
   * Both `null` for a live fleet, which publishes no brief text and no brief
   * path - `paths.meta` points at the dispatch record, not at the brief. Same
   * arrangement as the three fields above.
   */
  readonly brief: {
    readonly summary: string | null;
    readonly text: string | null;
  };
  readonly paths: {
    /** The dispatch record upstream points at for this worker. */
    readonly meta: SnapshotPath;
    /** The isolated copy of the repository it is working in. */
    readonly worktree: SnapshotPath;
  };
  readonly current_state: SnapshotCurrentState;
  readonly pr: SnapshotPullRequest;
  /**
   * How the worker's own backlog row was closed, from the row upstream joins
   * onto the task - `backlog.completion.verb`, one of `merged`, `reported` or
   * `done`, and null while the row is still open.
   *
   * Parsed because it is the only structural fact that separates a finished run
   * whose pull request was merged from one whose checks merely went green.
   * Upstream's reconciled state says `done` for both.
   */
  readonly completion: string | null;
}

/**
 * One work item on the deck.
 *
 * Everything but `id`, `state` and `captain_actionable` is text upstream lifted
 * out of a hand-written backlog, so it arrives as written. `null` throughout
 * means the row did not say - which for `repo`, `kind` and `since` is the
 * common case rather than the odd one, because a captain writing a queue line
 * annotates what is worth annotating and leaves the rest.
 */
export interface SnapshotRecord {
  readonly id: string;
  readonly title: string;
  /** The project the row names, upstream's own word for it: `(repo: ...)`. */
  readonly repo: string | null;
  /** What kind of work the row asks for: `ship`, `scout`, or whatever was typed. */
  readonly kind: string | null;
  readonly state: SnapshotRecordState;
  readonly priority: string | null;
  readonly since: string | null;
  readonly blocked_by_ids: readonly string[];
  readonly blocked_reason: string | null;
  readonly hold_kind: string | null;
  readonly hold_reason: string | null;
  readonly hold_until: string | null;
  readonly captain_actionable: boolean;
  /**
   * The full address of the pull request the row landed as, or `null`.
   *
   * Read for the landed lens rather than the deck's: a `done` row is not a deck
   * item, and the address is what turns "it finished" into something an
   * operator can open.
   */
  readonly pr_url: string | null;
  /**
   * How the row closed and when - `{ verb, date }`, both prose. `null` when the
   * row carries no completion block at all, which is every row still open.
   */
  readonly completion: SnapshotCompletion | null;
}

/** How a work item closed, in the hand-written record's own words. */
export interface SnapshotCompletion {
  readonly verb: string | null;
  readonly date: string | null;
}

/**
 * One piece of work a second mate landed in its own home.
 *
 * Upstream rolls these up per registered home; the home is stamped onto each
 * record so a reader never has to know which list it came out of. There is no
 * `repo` here - upstream's roll-up does not carry one - so a second mate's
 * landed work names no project, honestly.
 */
export interface SnapshotSecondmateLandedRecord {
  readonly id: string;
  readonly title: string;
  readonly home: string | null;
  readonly pr_url: string | null;
  readonly completion: SnapshotCompletion | null;
}

/**
 * The second mates' landed work, and every reason a piece of it is not here.
 *
 * The three lists beside `records` are upstream telling the panel what it did
 * not get, and each is a different reason: `truncated` is a bound upstream
 * applied, `unreadable` is a home that did not answer, `partial` is a home that
 * answered but not with something fully trusted. They become the document's
 * `omissions`, which is the whole reason they are parsed - an absence upstream
 * declared and the panel then dropped would be an absence nobody names.
 */
export interface SnapshotSecondmateLanded {
  readonly records: readonly SnapshotSecondmateLandedRecord[];
  readonly truncated: readonly string[];
  readonly unreadable: readonly string[];
  readonly partial: readonly string[];
}

/**
 * The deck. `present: false` is upstream saying the backlog itself could not be
 * read - which is a deck-lens problem and nothing to do with the fleet.
 */
export interface SnapshotBacklog {
  readonly present: boolean;
  readonly records: readonly SnapshotRecord[];
}

export interface FleetSnapshot {
  readonly schema: typeof SNAPSHOT_SCHEMA_ID;
  /** ISO-8601 instant upstream observed the fleet. Freshness is measured from it. */
  readonly generated: string;
  /**
   * The home this snapshot describes, or `null` when it did not say.
   *
   * The landed lens stamps it onto work that landed here, so that this home's
   * work and a second mate's are told apart by the same field rather than by
   * which list they arrived in.
   */
  readonly fm_home: string | null;
  readonly tasks: readonly SnapshotTask[];
  readonly backlog: SnapshotBacklog;
  readonly secondmate_landed: SnapshotSecondmateLanded;
}

/** Base for every refusal at this boundary, so callers can catch the family. */
class ContractError extends Error {}

/**
 * The snapshot announced a schema this build does not understand.
 *
 * Separate from `ContractParseError` because the recovery differs: a malformed
 * snapshot may be a half-written file that will be whole a moment later, but a
 * changed schema will still be changed on the next read. The runtime falls back
 * to last-known-good for the first and refuses outright for this one.
 */
export class ContractIdentifierError extends ContractError {
  override readonly name = "ContractIdentifierError";
  readonly expected: string;
  readonly found: unknown;
  readonly source: string;

  // Written out rather than declared as constructor parameters: the test suite
  // runs TypeScript through Node's strip-only loader, which cannot erase a
  // parameter property, and this file is imported directly by tests.
  constructor(expected: string, found: unknown, source: string) {
    super(
      `Fleet snapshot schema mismatch: expected "${expected}", found ${JSON.stringify(found)} (from ${source}). ` +
        `Quarterdeck refuses to render a snapshot it does not understand. ` +
        `Update SNAPSHOT_SCHEMA_ID in src/adapters/contract.ts and the parser below to match the new shape, ` +
        `then record the change in docs/contract.md.`,
    );
    this.expected = expected;
    this.found = found;
    this.source = source;
  }
}

/** The snapshot was not readable as the pinned schema. */
export class ContractParseError extends ContractError {
  override readonly name = "ContractParseError";
  readonly detail: string;
  readonly source: string;

  constructor(detail: string, source: string) {
    super(`Fleet snapshot could not be parsed (from ${source}): ${detail}`);
    this.detail = detail;
    this.source = source;
  }
}

/**
 * Where snapshot bytes come from. Injected so the panel can be driven by
 * fixtures or by a real fleet without the parser knowing the difference.
 */
export interface SnapshotSource {
  /** Named in every error message, so a refusal says which source produced it. */
  readonly description: string;
  read(signal: AbortSignal): Promise<string>;
}

const TASK_STATES: ReadonlySet<string> = new Set([
  "working",
  "parked",
  "blocked",
  "done",
  "failed",
  "paused",
  "unknown",
  "dispatched",
  "validating",
  "pr_open",
  "in_review",
  "waiting_external",
  "landed",
]);

/** The six of `TASK_STATES` that are places on the track. */
const ACTIVE_STATES: ReadonlySet<string> = new Set([
  "dispatched",
  "working",
  "validating",
  "pr_open",
  "in_review",
  "landed",
]);

const RECORD_STATES: ReadonlySet<string> = new Set([
  "queued",
  "in_flight",
  "done",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  path: string,
  source: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ContractParseError(`${path} must be an object`, source);
  }
  return value;
}

function requireString(value: unknown, path: string, source: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractParseError(`${path} must be a non-empty string`, source);
  }
  return value;
}

/** Absent and `null` both mean "upstream has nothing to say here". */
function optionalString(
  value: unknown,
  path: string,
  source: string,
): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, path, source);
}

/**
 * Text upstream copied out of a hand-written record. Never refuses: an empty
 * cell and a missing one both mean the row did not say, and a row that says
 * something unexpected is the operator's business rather than the parser's.
 */
function proseString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length === 0 ? null : text;
}

function requireBoolean(value: unknown, path: string, source: string): boolean {
  if (typeof value !== "boolean") {
    throw new ContractParseError(`${path} must be a boolean`, source);
  }
  return value;
}

function requireInstant(value: unknown, path: string, source: string): string {
  const text = requireString(value, path, source);
  if (!isIsoInstant(text)) {
    throw new ContractParseError(
      `${path} must be an ISO-8601 instant, got "${text}"`,
      source,
    );
  }
  return text;
}

function requireMember<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  source: string,
): T {
  const text = requireString(value, path, source);
  if (!allowed.has(text)) {
    throw new ContractParseError(
      `${path} must be one of ${[...allowed].join(", ")}, got "${text}"`,
      source,
    );
  }
  return text as T;
}

/**
 * A closed set upstream may leave out entirely.
 *
 * Absent and `null` are a fleet with nothing to say, which is not a snapshot to
 * refuse; a value that is present and unrecognised is, because it is a computed
 * field whose meaning this build would otherwise be guessing at.
 */
function optionalMember<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  source: string,
): T | null {
  if (value === null || value === undefined) return null;
  return requireMember<T>(value, allowed, path, source);
}

function requireArray(value: unknown, path: string, source: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ContractParseError(`${path} must be an array`, source);
  }
  return value;
}

function requireStringArray(
  value: unknown,
  path: string,
  source: string,
): readonly string[] {
  return requireArray(value, path, source).map((entry, i) =>
    requireString(entry, `${path}[${i}]`, source),
  );
}

const CHECK_OUTCOMES: ReadonlySet<string> = new Set([
  "pending",
  "passing",
  "failing",
]);

function requireCount(value: unknown, path: string, source: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ContractParseError(
      `${path} must be a whole number of zero or more`,
      source,
    );
  }
  return value;
}

/**
 * A forge reading, when there is one.
 *
 * Absent is not an error and not a shape - it is nobody having read the forge,
 * which the projection reports as `not-looked-up`. Present, though, is
 * something upstream computed, so it is refused like any other computed field:
 * a checks block that says `passing` with no count is a block whose meaning we
 * would be guessing at.
 */
function parseForgeRead<T>(
  value: unknown,
  path: string,
  source: string,
  ok: (entry: Record<string, unknown>) => T,
): T | { readonly read: "unreadable"; readonly detail: string } | null {
  if (value === null || value === undefined) return null;
  const entry = requireRecord(value, path, source);
  const read = requireMember<"ok" | "unreadable">(
    entry.read,
    new Set(["ok", "unreadable"]),
    `${path}.read`,
    source,
  );
  if (read === "unreadable") {
    return {
      read: "unreadable",
      detail: requireString(entry.detail, `${path}.detail`, source),
    };
  }
  return ok(entry);
}

function parseChecks(
  value: unknown,
  path: string,
  source: string,
): SnapshotChecks | null {
  return parseForgeRead(value, path, source, (entry) => ({
    read: "ok" as const,
    outcome: requireMember<SnapshotCheckOutcome>(
      entry.outcome,
      CHECK_OUTCOMES,
      `${path}.outcome`,
      source,
    ),
    finished: requireCount(entry.finished, `${path}.finished`, source),
    total: requireCount(entry.total, `${path}.total`, source),
    as_of: requireInstant(entry.as_of, `${path}.as_of`, source),
  }));
}

function parseReview(
  value: unknown,
  path: string,
  source: string,
): SnapshotReview | null {
  return parseForgeRead(value, path, source, (entry) => ({
    read: "ok" as const,
    comments: requireCount(entry.comments, `${path}.comments`, source),
    as_of: requireInstant(entry.as_of, `${path}.as_of`, source),
  }));
}

/** `{ verb, date }`, both prose, or `null` for a row that carries no block. */
function parseCompletion(
  value: unknown,
  path: string,
  source: string,
): SnapshotCompletion | null {
  if (value === null || value === undefined) return null;
  const entry = requireRecord(value, path, source);
  return { verb: proseString(entry.verb), date: proseString(entry.date) };
}

/**
 * The second mates' landed roll-up, or an empty one.
 *
 * Absent means this build is reading an upstream that does not publish the
 * roll-up, which is a fleet with nothing to say about second mates rather than
 * a snapshot to refuse - the same tolerance every other optional block here
 * gets. Present, the four lists are structural and refused when they are not
 * what they claim to be.
 */
function parseSecondmateLanded(
  value: unknown,
  source: string,
): SnapshotSecondmateLanded {
  const empty = {
    records: [],
    truncated: [],
    unreadable: [],
    partial: [],
  } as const;
  if (value === null || value === undefined) return empty;
  const at = "secondmate_landed";
  const entry = requireRecord(value, at, source);
  return {
    records: requireArray(entry.records ?? [], `${at}.records`, source).map(
      (row, i) => {
        const path = `${at}.records[${i}]`;
        const record = requireRecord(row, path, source);
        return {
          id: requireString(record.id, `${path}.id`, source),
          title: proseString(record.title) ?? "",
          home: proseString(record.home),
          pr_url: proseString(record.pr_url),
          completion: parseCompletion(
            record.completion,
            `${path}.completion`,
            source,
          ),
        };
      },
    ),
    truncated: requireStringArray(
      entry.truncated ?? [],
      `${at}.truncated`,
      source,
    ),
    unreadable: requireStringArray(
      entry.unreadable ?? [],
      `${at}.unreadable`,
      source,
    ),
    partial: requireStringArray(entry.partial ?? [], `${at}.partial`, source),
  };
}

function parsePath(value: unknown, path: string, source: string): SnapshotPath {
  const entry = requireRecord(value, path, source);
  return {
    path: requireString(entry.path, `${path}.path`, source),
    present: requireBoolean(entry.present, `${path}.present`, source),
  };
}

function parseTask(value: unknown, at: string, source: string): SnapshotTask {
  const entry = requireRecord(value, at, source);
  const paths = requireRecord(entry.paths, `${at}.paths`, source);
  const current = requireRecord(
    entry.current_state,
    `${at}.current_state`,
    source,
  );
  const pr = requireRecord(entry.pr, `${at}.pr`, source);

  return {
    id: requireString(entry.id, `${at}.id`, source),
    // Upstream reports a worker with no recorded project as an empty string
    // rather than by leaving the field out, and that is a fact about the
    // worker rather than a broken snapshot.
    project: proseString(entry.project) ?? "",
    kind: proseString(entry.kind) ?? "",
    harness: proseString(entry.harness),
    mode: proseString(entry.mode),
    branch: proseString(entry.branch),
    model: proseString(entry.model),
    effort: proseString(entry.effort),
    brief: parseBrief(entry.brief),
    paths: {
      meta: parsePath(paths.meta, `${at}.paths.meta`, source),
      worktree: parsePath(paths.worktree, `${at}.paths.worktree`, source),
    },
    current_state: {
      state: requireMember<SnapshotTaskState>(
        current.state,
        TASK_STATES,
        `${at}.current_state.state`,
        source,
      ),
      detail: requireString(
        current.detail,
        `${at}.current_state.detail`,
        source,
      ),
      observed_at: requireInstant(
        current.observed_at,
        `${at}.current_state.observed_at`,
        source,
      ),
      last_active_state: optionalMember<SnapshotActiveState>(
        current.last_active_state,
        ACTIVE_STATES,
        `${at}.current_state.last_active_state`,
        source,
      ),
    },
    pr: {
      url: optionalString(pr.url, `${at}.pr.url`, source),
      checks: parseChecks(pr.checks, `${at}.pr.checks`, source),
      review: parseReview(pr.review, `${at}.pr.review`, source),
    },
    completion: parseTaskCompletion(entry.backlog, `${at}.backlog`, source),
  };
}

/**
 * The brief's own words. Prose throughout and never a refusal: a worker with no
 * brief block, an empty one, or one carrying only a summary are all workers
 * whose instructions this panel simply does not have all of.
 */
function parseBrief(value: unknown): SnapshotTask["brief"] {
  if (!isRecord(value)) return { summary: null, text: null };
  return { summary: proseString(value.summary), text: proseString(value.text) };
}

/**
 * Absent for a worker with no backlog row of its own, which is a fact about
 * the worker rather than a snapshot this build cannot read. A backlog row
 * upstream did join in is its own computation, though, and its shape is
 * refused like any other structural field; only the verb inside it is prose.
 */
function parseTaskCompletion(
  value: unknown,
  path: string,
  source: string,
): string | null {
  if (value === null || value === undefined) return null;
  const backlog = requireRecord(value, path, source);
  const completion = requireRecord(
    backlog.completion,
    `${path}.completion`,
    source,
  );
  return proseString(completion.verb);
}

function parseRecord(
  value: unknown,
  at: string,
  source: string,
): SnapshotRecord {
  const entry = requireRecord(value, at, source);
  return {
    id: requireString(entry.id, `${at}.id`, source),
    title: proseString(entry.title) ?? "",
    repo: proseString(entry.repo),
    kind: proseString(entry.kind),
    state: requireMember<SnapshotRecordState>(
      entry.state,
      RECORD_STATES,
      `${at}.state`,
      source,
    ),
    priority: proseString(entry.priority),
    since: proseString(entry.since),
    blocked_by_ids: requireStringArray(
      entry.blocked_by_ids ?? [],
      `${at}.blocked_by_ids`,
      source,
    ),
    blocked_reason: proseString(entry.blocked_reason),
    hold_kind: proseString(entry.hold_kind),
    hold_reason: proseString(entry.hold_reason),
    hold_until: proseString(entry.hold_until),
    captain_actionable: requireBoolean(
      entry.captain_actionable,
      `${at}.captain_actionable`,
      source,
    ),
    pr_url: proseString(entry.pr_url),
    completion: parseCompletion(entry.completion, `${at}.completion`, source),
  };
}

/**
 * Upstream preserves every non-empty line of the backlog's sections, marking
 * the ones it could read as a work item `structured: true` and keeping the rest
 * verbatim. An unstructured line has no id, no title and no state to show, so
 * it is not a deck item; that a backlog contains one is a health finding rather
 * than something for the deck lens to draw.
 */
function isStructured(value: unknown): boolean {
  return isRecord(value) && value.structured === true;
}

/**
 * Parse raw snapshot text. The schema identifier is checked before anything
 * else, so a shape change is reported as a shape change rather than as whatever
 * field happens to be missing.
 */
export function parseSnapshot(raw: string, source: string): FleetSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new ContractParseError(
      `not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      source,
    );
  }

  const top = requireRecord(value, "top level", source);
  if (top.schema !== SNAPSHOT_SCHEMA_ID) {
    throw new ContractIdentifierError(SNAPSHOT_SCHEMA_ID, top.schema, source);
  }

  const backlog = requireRecord(top.backlog, "backlog", source);
  const present = requireBoolean(backlog.present, "backlog.present", source);

  return {
    schema: SNAPSHOT_SCHEMA_ID,
    generated: requireInstant(top.generated, "generated", source),
    fm_home: proseString(top.fm_home),
    secondmate_landed: parseSecondmateLanded(top.secondmate_landed, source),
    tasks: requireArray(top.tasks, "tasks", source).map((entry, i) =>
      parseTask(entry, `tasks[${i}]`, source),
    ),
    backlog: {
      present,
      records: requireArray(backlog.records ?? [], "backlog.records", source)
        // Indexed against the whole array, so a refusal names the row upstream
        // named rather than a position that counts only what survived.
        .map((entry, i) => [entry, i] as const)
        .filter(([entry]) => isStructured(entry))
        .map(([entry, i]) =>
          parseRecord(entry, `backlog.records[${i}]`, source),
        ),
    },
  };
}

export async function readSnapshot(
  source: SnapshotSource,
  signal: AbortSignal,
): Promise<FleetSnapshot> {
  return parseSnapshot(await source.read(signal), source.description);
}

/**
 * A committed, synthetic fixture set.
 *
 * `fixtureSet` is a config value, so switching between the fixture fleets is a
 * restart rather than a code change. See fixtures/README.md for the sets.
 */
export function fixtureSource(
  fixtureRoot: string,
  fixtureSet: string,
): SnapshotSource {
  const file = join(fixtureRoot, fixtureSet, "snapshot.json");
  return {
    description: `fixture:${fixtureSet}`,
    read: (signal) => readFile(file, { encoding: "utf8", signal }),
  };
}

/**
 * A real fleet, read through the command it publishes its snapshot with.
 *
 * The home is configuration and arrives as an argument; nothing here knows a
 * machine path. The command is run with the home in its environment because
 * that is how upstream is told which fleet to report on, and with an otherwise
 * inherited environment because it needs a `PATH` to find the tools it uses.
 */
export function fleetSource(
  fleetHome: string,
  runner: Runner,
  env: Readonly<Record<string, string | undefined>>,
): SnapshotSource {
  const command = join(fleetHome, SNAPSHOT_COMMAND);
  const childEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[name] = value;
  }
  childEnv.FM_HOME = fleetHome;

  return {
    description: `fleet:${fleetHome}`,
    read: (signal) =>
      runner.run(command, SNAPSHOT_ARGS, { env: childEnv, signal }),
  };
}

/**
 * The directories whose changes mean a fleet has moved on.
 *
 * Here rather than in the runtime because it is knowledge about upstream's
 * layout, and this file is where the panel keeps that - one file to correct
 * when upstream moves, which is the same argument invariant 4 makes for the
 * health module.
 *
 * ## Why the build is told to leave this join alone
 *
 * Turbopack reads a `join` it cannot resolve statically as a possible module
 * root, and answers by tracing the entire project into the server output -
 * `src`, `tests`, `docs`, `fixtures` and all - because any of it might turn out
 * to be what gets required. With `output: standalone` that is what ships:
 * measured before this comment, 45MB and 1506 files, including this
 * repository's own test suite and decision records.
 *
 * Of the three escapes Next names, two do not apply. The path cannot be scoped
 * to a subfolder - it is rooted at an operator's fleet home, which is
 * configuration and is not known until the panel starts - and it cannot be
 * restricted to development, because reading a real fleet is the production
 * path. So the opt-out is the honest one rather than the quick one: the premise
 * behind the warning is false here. This join builds a directory to hand to
 * `fs.watch`, it is never a specifier, and nothing is ever imported from what it
 * returns. There is no module for the tracer to miss.
 */
export function fleetWatchDirs(fleetHome: string): readonly string[] {
  return FLEET_ACTIVITY_DIRS.map((dir) =>
    join(/* turbopackIgnore: true */ fleetHome, dir),
  );
}
