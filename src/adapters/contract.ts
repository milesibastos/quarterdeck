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
 * The snapshot carries two of the panel's three lenses - the fleet (`tasks`)
 * and the deck (`backlog`). It does not carry health: that is read from files
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
 */
const SNAPSHOT_COMMAND = "bin/fm-fleet-snapshot.sh";

/** Asks for the structured surface rather than the human one. */
const SNAPSHOT_ARGS = ["--json"];

/**
 * Where a fleet home keeps the per-worker files whose changes mean the snapshot
 * has moved on. Watched, never read: the snapshot command is the only reader of
 * a fleet's internals, and this is just the thing to listen to.
 */
const FLEET_ACTIVITY_DIR = "state";

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
}

/**
 * A worker's pull request. `url` is null when upstream found none, which it
 * reports as a present object rather than by leaving the field out.
 */
export interface SnapshotPullRequest {
  readonly url: string | null;
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
  readonly paths: {
    /** The instructions the worker was dispatched with. */
    readonly meta: SnapshotPath;
    /** The isolated copy of the repository it is working in. */
    readonly worktree: SnapshotPath;
  };
  readonly current_state: SnapshotCurrentState;
  readonly pr: SnapshotPullRequest;
}

/**
 * One work item on the deck.
 *
 * Everything but `id`, `state` and `captain_actionable` is text upstream lifted
 * out of a hand-written backlog, so it arrives as written. `null` throughout
 * means the row did not say.
 */
export interface SnapshotRecord {
  readonly id: string;
  readonly title: string;
  readonly state: SnapshotRecordState;
  readonly priority: string | null;
  readonly since: string | null;
  readonly blocked_by_ids: readonly string[];
  readonly blocked_reason: string | null;
  readonly hold_kind: string | null;
  readonly hold_reason: string | null;
  readonly hold_until: string | null;
  readonly captain_actionable: boolean;
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
  readonly tasks: readonly SnapshotTask[];
  readonly backlog: SnapshotBacklog;
}

/** Base for every refusal at this boundary, so callers can catch the family. */
export class ContractError extends Error {}

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

const RECORD_STATES: ReadonlySet<string> = new Set(["queued", "in_flight", "done"]);

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
function optionalString(value: unknown, path: string, source: string): string | null {
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
    throw new ContractParseError(`${path} must be an ISO-8601 instant, got "${text}"`, source);
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
  const current = requireRecord(entry.current_state, `${at}.current_state`, source);
  const pr = requireRecord(entry.pr, `${at}.pr`, source);

  return {
    id: requireString(entry.id, `${at}.id`, source),
    // Upstream reports a worker with no recorded project as an empty string
    // rather than by leaving the field out, and that is a fact about the
    // worker rather than a broken snapshot.
    project: proseString(entry.project) ?? "",
    kind: proseString(entry.kind) ?? "",
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
      detail: requireString(current.detail, `${at}.current_state.detail`, source),
      observed_at: requireInstant(
        current.observed_at,
        `${at}.current_state.observed_at`,
        source,
      ),
    },
    pr: { url: optionalString(pr.url, `${at}.pr.url`, source) },
  };
}

function parseRecord(value: unknown, at: string, source: string): SnapshotRecord {
  const entry = requireRecord(value, at, source);
  return {
    id: requireString(entry.id, `${at}.id`, source),
    title: proseString(entry.title) ?? "",
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
        .map(([entry, i]) => parseRecord(entry, `backlog.records[${i}]`, source)),
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
export function fixtureSource(fixtureRoot: string, fixtureSet: string): SnapshotSource {
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
    read: (signal) => runner.run(command, SNAPSHOT_ARGS, { env: childEnv, signal }),
  };
}

/**
 * The directory whose changes mean a fleet has moved on.
 *
 * Here rather than in the runtime because it is knowledge about upstream's
 * layout, and this file is where the panel keeps that - one file to correct
 * when upstream moves, which is the same argument invariant 4 makes for the
 * health module.
 */
export function fleetWatchDir(fleetHome: string): string {
  return join(fleetHome, FLEET_ACTIVITY_DIR);
}
