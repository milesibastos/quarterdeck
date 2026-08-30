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
 * Where the bytes come from is injected (`SnapshotSource`). In this skeleton the
 * only wired source is the fixture loader below.
 */

/**
 * The schema identifier this build understands, pinned. When upstream ships a
 * new snapshot shape it changes this string, and the panel then refuses instead
 * of rendering fields that have quietly changed meaning.
 */
export const SNAPSHOT_SCHEMA_ID = "fm-fleet-snapshot.v1";

export type SnapshotWorkerState =
  | "working"
  | "idle"
  | "held"
  | "queued"
  | "done"
  | "failed";

export type SnapshotWorkerKind = "implement" | "review" | "research" | "chore";

export interface SnapshotWorker {
  readonly id: string;
  readonly project: string;
  readonly kind: SnapshotWorkerKind;
  readonly state: SnapshotWorkerState;
  readonly since: string;
}

export interface FleetSnapshot {
  readonly schema: typeof SNAPSHOT_SCHEMA_ID;
  readonly generatedAt: string;
  readonly workers: readonly SnapshotWorker[];
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
  constructor(
    readonly expected: string,
    readonly found: unknown,
    readonly source: string,
  ) {
    super(
      `Fleet snapshot schema mismatch: expected "${expected}", found ${JSON.stringify(found)} (from ${source}). ` +
        `Quarterdeck refuses to render a snapshot it does not understand. ` +
        `Update SNAPSHOT_SCHEMA_ID in src/adapters/contract.ts and the parser below to match the new shape, ` +
        `then record the change in docs/contract.md.`,
    );
  }
}

/** The snapshot was not readable as the pinned schema. */
export class ContractParseError extends ContractError {
  override readonly name = "ContractParseError";
  constructor(
    readonly detail: string,
    readonly source: string,
  ) {
    super(`Fleet snapshot could not be parsed (from ${source}): ${detail}`);
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

const WORKER_STATES: ReadonlySet<string> = new Set([
  "working",
  "idle",
  "held",
  "queued",
  "done",
  "failed",
]);

const WORKER_KINDS: ReadonlySet<string> = new Set([
  "implement",
  "review",
  "research",
  "chore",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  path: string,
  source: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractParseError(`${path} must be a non-empty string`, source);
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

  if (!isRecord(value)) {
    throw new ContractParseError("top level must be an object", source);
  }
  if (value.schema !== SNAPSHOT_SCHEMA_ID) {
    throw new ContractIdentifierError(SNAPSHOT_SCHEMA_ID, value.schema, source);
  }

  const generatedAt = requireInstant(value.generatedAt, "generatedAt", source);
  if (!Array.isArray(value.workers)) {
    throw new ContractParseError("workers must be an array", source);
  }

  const workers = value.workers.map((entry, i): SnapshotWorker => {
    const at = `workers[${i}]`;
    if (!isRecord(entry)) {
      throw new ContractParseError(`${at} must be an object`, source);
    }
    return {
      id: requireString(entry.id, `${at}.id`, source),
      project: requireString(entry.project, `${at}.project`, source),
      kind: requireMember<SnapshotWorkerKind>(entry.kind, WORKER_KINDS, `${at}.kind`, source),
      state: requireMember<SnapshotWorkerState>(entry.state, WORKER_STATES, `${at}.state`, source),
      since: requireInstant(entry.since, `${at}.since`, source),
    };
  });

  return { schema: SNAPSHOT_SCHEMA_ID, generatedAt, workers };
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
 * `fixtureSet` is a config value, so switching between the healthy, empty,
 * stale, mismatched and malformed fleets is a restart rather than a code change.
 */
export function fixtureSource(fixtureRoot: string, fixtureSet: string): SnapshotSource {
  const file = join(fixtureRoot, fixtureSet, "snapshot.json");
  return {
    description: `fixture:${fixtureSet}`,
    read: (signal) => readFile(file, { encoding: "utf8", signal }),
  };
}
