import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isIsoInstant } from "../providers/clock.ts";

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
 * Where the bytes come from is injected (`SnapshotSource`). In this skeleton the
 * only wired source is the fixture loader below.
 */

/**
 * The schema identifier this build understands, pinned. When upstream ships a
 * new snapshot shape it changes this string, and the panel then refuses instead
 * of rendering fields that have quietly changed meaning.
 */
export const SNAPSHOT_SCHEMA_ID = "fm-fleet-snapshot.v1";

/** Upstream's word for what a worker was dispatched to do. */
export type SnapshotTaskKind = "ship" | "scout";

/**
 * Upstream's state vocabulary, which is its own. The projection maps it onto
 * the document's, which is what lets upstream rename `parked` without a
 * component changing.
 */
export type SnapshotTaskState =
  | "dispatched"
  | "working"
  | "validating"
  | "pr_open"
  | "in_review"
  | "landed"
  | "blocked"
  | "parked"
  | "waiting_external"
  | "failed";

export type SnapshotRecordState = "queued" | "in_flight" | "done";

export type SnapshotPriority = "now" | "next" | "later";

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

export interface SnapshotPullRequest {
  readonly url: string;
}

export interface SnapshotTask {
  readonly id: string;
  readonly project: string;
  readonly kind: SnapshotTaskKind;
  readonly paths: {
    /** The instructions the worker was dispatched with. */
    readonly meta: SnapshotPath;
    /** The isolated copy of the repository it is working in. */
    readonly worktree: SnapshotPath;
  };
  readonly current_state: SnapshotCurrentState;
  readonly pr: SnapshotPullRequest | null;
}

export interface SnapshotRecord {
  readonly id: string;
  readonly title: string;
  readonly state: SnapshotRecordState;
  readonly priority: SnapshotPriority;
  readonly since: string;
  readonly blocked_by_ids: readonly string[];
  readonly blocked_reason: string | null;
  readonly hold_kind: string | null;
  readonly hold_reason: string | null;
  /** A calendar date, not an instant: a deferral is to a day, not to a moment. */
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
  readonly generated_at: string;
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
 * fixtures, and later by a real fleet, without the parser knowing the difference.
 */
export interface SnapshotSource {
  /** Named in every error message, so a refusal says which source produced it. */
  readonly description: string;
  read(signal: AbortSignal): Promise<string>;
}

const TASK_KINDS: ReadonlySet<string> = new Set(["ship", "scout"]);

const TASK_STATES: ReadonlySet<string> = new Set([
  "dispatched",
  "working",
  "validating",
  "pr_open",
  "in_review",
  "landed",
  "blocked",
  "parked",
  "waiting_external",
  "failed",
]);

const RECORD_STATES: ReadonlySet<string> = new Set(["queued", "in_flight", "done"]);

const PRIORITIES: ReadonlySet<string> = new Set(["now", "next", "later"]);

/** A calendar date, `YYYY-MM-DD`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function optionalDate(value: unknown, path: string, source: string): string | null {
  const text = optionalString(value, path, source);
  if (text === null) return null;
  if (!ISO_DATE.test(text) || Number.isNaN(Date.parse(text))) {
    throw new ContractParseError(`${path} must be a YYYY-MM-DD date, got "${text}"`, source);
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
  const pr = entry.pr === null || entry.pr === undefined
    ? null
    : requireRecord(entry.pr, `${at}.pr`, source);

  return {
    id: requireString(entry.id, `${at}.id`, source),
    project: requireString(entry.project, `${at}.project`, source),
    kind: requireMember<SnapshotTaskKind>(entry.kind, TASK_KINDS, `${at}.kind`, source),
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
    pr: pr === null ? null : { url: requireString(pr.url, `${at}.pr.url`, source) },
  };
}

function parseRecord(value: unknown, at: string, source: string): SnapshotRecord {
  const entry = requireRecord(value, at, source);
  return {
    id: requireString(entry.id, `${at}.id`, source),
    title: requireString(entry.title, `${at}.title`, source),
    state: requireMember<SnapshotRecordState>(
      entry.state,
      RECORD_STATES,
      `${at}.state`,
      source,
    ),
    priority: requireMember<SnapshotPriority>(
      entry.priority,
      PRIORITIES,
      `${at}.priority`,
      source,
    ),
    since: requireInstant(entry.since, `${at}.since`, source),
    blocked_by_ids: requireStringArray(
      entry.blocked_by_ids ?? [],
      `${at}.blocked_by_ids`,
      source,
    ),
    blocked_reason: optionalString(entry.blocked_reason, `${at}.blocked_reason`, source),
    hold_kind: optionalString(entry.hold_kind, `${at}.hold_kind`, source),
    hold_reason: optionalString(entry.hold_reason, `${at}.hold_reason`, source),
    hold_until: optionalDate(entry.hold_until, `${at}.hold_until`, source),
    captain_actionable: requireBoolean(
      entry.captain_actionable,
      `${at}.captain_actionable`,
      source,
    ),
  };
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
    generated_at: requireInstant(top.generated_at, "generated_at", source),
    tasks: requireArray(top.tasks, "tasks", source).map((entry, i) =>
      parseTask(entry, `tasks[${i}]`, source),
    ),
    backlog: {
      present,
      records: requireArray(backlog.records ?? [], "backlog.records", source).map(
        (entry, i) => parseRecord(entry, `backlog.records[${i}]`, source),
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
 * The one wired source: a committed, synthetic fixture set.
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
