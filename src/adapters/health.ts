import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isIsoInstant, type Clock } from "../providers/clock.ts";
import type {
  Disagreement,
  DriftSignal,
  Health,
  Overdue,
  OverdueSignal,
  SupervisorSignal,
  Unreadable,
} from "../types/document.ts";

/**
 * THE QUARANTINED MODULE.
 *
 * This is the only file permitted to name fleet-internal paths (invariant 4).
 * Those paths are an implementation detail of the fleet supervisor and carry no
 * compatibility promise: they get renamed, moved, and restructured without
 * notice. Confining them here means that when upstream moves, exactly one
 * file's tests fail and exactly one file needs editing.
 *
 * The rule that comes with that privilege: **this module degrades, it does not
 * throw.** A path that has moved must produce an unreadable reading, never an
 * exception that takes the panel down. That is also why the shipshape lens gets
 * its own status in the document: the fleet snapshot either parses or refuses,
 * but health can simply go dark while the other two lenses keep working.
 *
 * The health file's shape is the panel's own, not upstream's - nothing upstream
 * publishes these signals, so there is no contract to pin and nothing to guess.
 */

export type HealthReading =
  | {
      readonly read: "ok";
      /** ISO-8601 instant the reading was taken. */
      readonly asOf: string;
      readonly health: Health;
    }
  | { readonly read: "unreadable"; readonly detail: string };

/**
 * Thrown and caught inside this file only. The module's whole contract is that
 * nothing escapes it, so this type is not exported.
 */
class HealthParseError extends Error {}

function fail(detail: string): never {
  throw new HealthParseError(detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(`${path} must be an object`);
}

function text(value: unknown, path: string): string {
  return typeof value === "string" && value.length > 0
    ? value
    : fail(`${path} must be a non-empty string`);
}

function instant(value: unknown, path: string): string {
  const found = text(value, path);
  return isIsoInstant(found) ? found : fail(`${path} must be an ISO-8601 instant`);
}

function flag(value: unknown, path: string): boolean {
  return typeof value === "boolean" ? value : fail(`${path} must be a boolean`);
}

function list(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${path} must be an array`);
}

/**
 * `{ read: "unreadable", detail }` when the signal itself could not be read,
 * `null` when it was and the caller should read the rest of it.
 *
 * A signal being dark is different from the whole file being dark: the
 * supervisor can be readable while the drift check is not.
 */
function unreadableSignal(
  entry: Record<string, unknown>,
  path: string,
): { readonly read: "unreadable"; readonly detail: string } | null {
  const read = text(entry.read, `${path}.read`);
  if (read === "unreadable") {
    return { read: "unreadable", detail: text(entry.detail, `${path}.detail`) };
  }
  if (read !== "ok") fail(`${path}.read must be "ok" or "unreadable"`);
  return null;
}

function parseSupervisor(value: unknown): SupervisorSignal {
  const entry = record(value, "supervisor");
  return (
    unreadableSignal(entry, "supervisor") ?? {
      read: "ok",
      alive: flag(entry.alive, "supervisor.alive"),
      lastSeen: instant(entry.lastSeen, "supervisor.lastSeen"),
    }
  );
}

function parseOverdue(value: unknown): OverdueSignal {
  const entry = record(value, "overdue");
  const dark = unreadableSignal(entry, "overdue");
  if (dark) return dark;
  const overdue = list(entry.overdue, "overdue.overdue").map((item, i): Overdue => {
    const at = `overdue.overdue[${i}]`;
    const row = record(item, at);
    return {
      id: text(row.id, `${at}.id`),
      waitingSince: instant(row.waitingSince, `${at}.waitingSince`),
    };
  });
  return { read: "ok", overdue };
}

function parseDrift(value: unknown): DriftSignal {
  const entry = record(value, "drift");
  const dark = unreadableSignal(entry, "drift");
  if (dark) return dark;
  const disagreements = list(entry.disagreements, "drift.disagreements").map(
    (item, i): Disagreement => {
      const at = `drift.disagreements[${i}]`;
      const row = record(item, at);
      return {
        record: text(row.record, `${at}.record`),
        detail: text(row.detail, `${at}.detail`),
      };
    },
  );
  return { read: "ok", disagreements };
}

function parseHealth(raw: string): HealthReading {
  const top = record(JSON.parse(raw), "top level");
  return {
    read: "ok",
    asOf: instant(top.asOf, "asOf"),
    health: {
      supervisor: parseSupervisor(top.supervisor),
      overdue: parseOverdue(top.overdue),
      drift: parseDrift(top.drift),
    },
  };
}

/**
 * Read the health signals from `dir`, which is a fleet-internal location and so
 * may only be named here.
 *
 * Every failure - a missing file, a moved directory, a shape that changed under
 * us - comes back as an unreadable reading. Nothing escapes this function, and
 * that is the point: a quarantined module that can take the panel down is not
 * quarantined.
 */
export async function readHealth(dir: string, signal: AbortSignal): Promise<HealthReading> {
  try {
    return parseHealth(await readFile(join(dir, "health.json"), { encoding: "utf8", signal }));
  } catch (error) {
    return {
      read: "unreadable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ------------------------------------------------------ the fleet home */

/**
 * The signals, read from a running fleet's own files.
 *
 * Everything below names fleet-internal locations, which is why it is in this
 * file and can be in no other. None of it carries a compatibility promise: the
 * supervisor renames, moves and restructures these files without telling
 * anyone, so every read here is written to produce an unreadable signal rather
 * than an exception when what it expected is not there.
 *
 * Each signal is read independently. The beacon having moved says nothing about
 * whether the backlog can still be parsed, so one of the three going dark
 * leaves the other two working.
 */

/** The fleet's state directory, and the files inside it this reads. */
const STATE_DIR = "state";
/** Touched on every supervision poll. Its mtime is the whole liveness signal. */
const BEACON_FILE = ".last-watcher-beat";
/** One per worker the fleet has dispatched; its presence is what "live" means. */
const META_SUFFIX = ".meta";
/** One line of the fleet's semantic busy-state contract, per worker. */
const BUSY_STATE_SUFFIX = ".busy-state";
/** The incarnation token a busy-state record must present to be believed. */
const BUSY_GEN_SUFFIX = ".busy-gen";
/** A worker's append-only status event log. */
const STATUS_SUFFIX = ".status";
/** The durable work item record. */
const BACKLOG_DIR = "data";
const BACKLOG_FILE = "backlog.md";
/** How the two above are named to an operator when they disagree. */
const BACKLOG_RECORD = `${BACKLOG_DIR}/${BACKLOG_FILE}`;

/**
 * A beacon older than this means nobody is supervising, and a worker idle
 * longer than this is a possible wedge.
 *
 * Both are the fleet's own defaults, and both are policy the fleet can change
 * without telling us - which is exactly why they are quarantined here beside
 * the paths rather than exposed as panel configuration. A number that drifts
 * out of step with upstream makes the lens wrong, not configurable.
 */
const BEACON_GRACE_MS = 300_000;
const WEDGE_AFTER_MS = 240_000;

/** The declared waits. An idle worker that has declared one is not a wedge. */
const DECLARED_WAIT_VERBS: ReadonlySet<string> = new Set(["paused", "captain-held"]);

/** The verbs that open a keyed decision, and the two that close one. */
const OPENS_DECISION: ReadonlySet<string> = new Set(["needs-decision", "blocked"]);
const RESOLVED_VERB = "resolved";
const CAPTAIN_HELD_VERB = "captain-held";
const CLOSES_DECISION: ReadonlySet<string> = new Set([RESOLVED_VERB, CAPTAIN_HELD_VERB]);

/** A line with no stated key names this one, so a bare `resolved:` closes it. */
const DEFAULT_DECISION_KEY = "default";

/** The unbracketed correlation token the fleet's own tooling writes. */
const CORRELATION_TOKEN = /^corr=[0-9A-Fa-f]{16}$/;

/** `[key=<slug>]`, in either of the two positions the fleet documents. */
const KEY_SLUG = /^[A-Za-z0-9._-]+$/;

/**
 * One structured backlog row: `- [ ] <id> - <the rest>`, or the bold form the
 * record also carries. Group 1 or 2 is the work item, group 3 is the rest.
 */
const BACKLOG_ROW = /^[-*]\s+(?:\[[ xX]\]\s+(\S+)|\*\*([^*]+)\*\*)\s+-\s+(.*)$/;

/** `(hold: ...)`, `(hold-kind: ...)` or `(hold-until: ...)` on a row. */
const HOLD_METADATA = /\(\s*hold(?:-kind|-until)?:/;

function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dark(detail: string): Unreadable {
  return { read: "unreadable", detail };
}

/** The last line with anything on it, or `null` for an empty or absent log. */
function lastLine(text: string): string | null {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

/**
 * A status line's leading verb.
 *
 * The fleet's grammar: everything before the first colon, cut at the first
 * metadata tag, with correlation tokens dropped. Anything else left over stays,
 * so a line of prose matches no verb rather than the first word of the prose
 * being taken for one.
 */
function statusVerb(line: string): string {
  const head = line.split(":")[0].split("[")[0].trim();
  if (head.length === 0) return "";
  const words = head.split(/\s+/);
  return [words[0], ...words.slice(1).filter((w) => !CORRELATION_TOKEN.test(w))].join(" ");
}

/**
 * The decision a status line names.
 *
 * `[key=<slug>]` before the colon is the documented position; a complete token
 * at the head of the note is accepted as equivalent, because real workers write
 * it there. A malformed slug is not a stated key and not the default one
 * either: the line is skipped, so a typo can neither open nor close anything.
 */
function decisionKey(line: string): string | null {
  const [head, ...rest] = line.split(":");
  const beforeColon = /\[key=([^\]]*)\]/.exec(head);
  const noteHead = rest.length > 0 ? /^\s*\[key=([^\]]*)\]/.exec(rest.join(":")) : null;
  const stated = beforeColon?.[1] ?? noteHead?.[1];
  if (stated === undefined) return DEFAULT_DECISION_KEY;
  return KEY_SLUG.test(stated) ? stated : null;
}

/**
 * Fold a whole status log into where each of its decisions ended up.
 *
 * Last-line-wins cannot answer this: a later, unrelated `working:` line would
 * mask a decision still open. Only a line naming the key moves it, so the fold
 * is over the whole log and keyed, and every other line is an ordinary event
 * rather than a format that surprised us.
 */
function foldDecisions(text: string): ReadonlyMap<string, string> {
  const ended = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const key = decisionKey(line);
    if (key === null) continue;
    const verb = statusVerb(line);
    if (OPENS_DECISION.has(verb) || CLOSES_DECISION.has(verb)) ended.set(key, verb);
  }
  return ended;
}

/**
 * Does this log read as a decision answered, with nothing still open?
 *
 * `resolved` is an answer; `captain-held` is not. The second is the fleet's
 * verified transfer of a decision onto the durable record, which is precisely
 * what puts a legitimate hold there - so a log carrying one explains the hold
 * rather than disagreeing with it.
 */
function readsAsAnswered(log: string): boolean {
  const ended = [...foldDecisions(log).values()];
  if (ended.some((verb) => OPENS_DECISION.has(verb))) return false;
  if (ended.includes(CAPTAIN_HELD_VERB)) return false;
  return ended.includes(RESOLVED_VERB);
}

/** Read a fleet file, or `null` when it is not there in the shape expected. */
async function readMaybe(file: string, signal: AbortSignal): Promise<string | null> {
  try {
    return await readFile(file, { encoding: "utf8", signal });
  } catch {
    return null;
  }
}

/**
 * Is the supervision cycle alive, and when was it last seen?
 *
 * The beacon is touched on every poll and holds nothing, so its modification
 * time is the entire signal. No beacon at all is unreadable rather than dead:
 * the file having moved and the cycle having stopped look identical from here,
 * and reporting the wrong one of those two is worse than saying so.
 */
async function readSupervisor(stateDir: string, clock: Clock): Promise<SupervisorSignal> {
  const beacon = join(stateDir, BEACON_FILE);
  try {
    const { mtimeMs } = await stat(beacon);
    return {
      read: "ok",
      alive: clock.nowMs() - mtimeMs < BEACON_GRACE_MS,
      lastSeen: new Date(mtimeMs).toISOString(),
    };
  } catch (error) {
    return dark(`No supervision beacon at ${STATE_DIR}/${BEACON_FILE}: ${why(error)}`);
  }
}

/** The ids of the workers the fleet currently has out, from `state/*.meta`. */
async function liveWorkerIds(stateDir: string): Promise<readonly string[]> {
  const entries = await readdir(stateDir);
  return entries
    .filter((name) => name.endsWith(META_SUFFIX))
    .map((name) => name.slice(0, -META_SUFFIX.length))
    .sort();
}

/**
 * When a worker went idle, in epoch milliseconds, or `null` when the fleet is
 * not saying that it is.
 *
 * The record is one line: `v1 gen=<token> seq=<n> state=<busy|idle|unknown>
 * source=<token> event=<token> ts=<epoch>`, and it counts only while it carries
 * the incarnation token the fleet armed the worker with. Upstream's own rule is
 * that a missing, malformed or stale record is unknown and never idle, so every
 * surprise here answers `null` rather than being read as a worker gone quiet.
 */
async function idleSinceMs(
  stateDir: string,
  id: string,
  signal: AbortSignal,
): Promise<number | null> {
  const [record, gen] = await Promise.all([
    readMaybe(join(stateDir, `${id}${BUSY_STATE_SUFFIX}`), signal),
    readMaybe(join(stateDir, `${id}${BUSY_GEN_SUFFIX}`), signal),
  ]);
  if (record === null || gen === null) return null;

  const line = lastLine(record);
  if (line === null) return null;
  const words = line.trim().split(/\s+/);
  if (words[0] !== "v1") return null;

  const fields = new Map<string, string>();
  for (const word of words.slice(1)) {
    const at = word.indexOf("=");
    if (at > 0) fields.set(word.slice(0, at), word.slice(at + 1));
  }
  if (fields.get("gen") !== gen.trim()) return null;
  if (fields.get("state") !== "idle") return null;

  const seconds = Number(fields.get("ts"));
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/**
 * Has this worker declared that its wait is expected?
 *
 * `paused:` and `captain-held:` are the fleet's two declarations that an idle
 * worker is idle on purpose - waiting on an upstream release, or on a person.
 * Neither is a wedge, and reporting one as a problem would train an operator to
 * ignore the signal. `blocked:` and `needs-decision:` are deliberately not here:
 * a worker stopped for those is waiting on the machinery this lens watches.
 */
async function hasDeclaredWait(
  stateDir: string,
  id: string,
  signal: AbortSignal,
): Promise<boolean> {
  const log = await readMaybe(join(stateDir, `${id}${STATUS_SUFFIX}`), signal);
  if (log === null) return false;
  const line = lastLine(log);
  return line !== null && DECLARED_WAIT_VERBS.has(statusVerb(line));
}

/**
 * Is anything waiting longer than it should?
 *
 * One entry per worker the fleet has out that has been idle past the point the
 * fleet itself calls a possible wedge, with the declared waits left out.
 */
async function readOverdue(
  stateDir: string,
  clock: Clock,
  signal: AbortSignal,
): Promise<OverdueSignal> {
  let ids: readonly string[];
  try {
    ids = await liveWorkerIds(stateDir);
  } catch (error) {
    return dark(`Could not list the fleet's workers in ${STATE_DIR}/: ${why(error)}`);
  }

  const overdue: Overdue[] = [];
  for (const id of ids) {
    const since = await idleSinceMs(stateDir, id, signal);
    if (since === null || clock.nowMs() - since < WEDGE_AFTER_MS) continue;
    if (await hasDeclaredWait(stateDir, id, signal)) continue;
    overdue.push({ id, waitingSince: new Date(since).toISOString() });
  }
  return { read: "ok", overdue };
}

interface BacklogRow {
  readonly id: string;
  readonly inFlight: boolean;
  readonly held: boolean;
}

/**
 * The structured rows of the durable record, by the section they sit under.
 *
 * Free-form lines are ordinary in this file and are not a surprise: they are
 * skipped rather than treated as a format that changed. A row this cannot read
 * is a row this says nothing about.
 */
function parseBacklog(text: string): readonly BacklogRow[] {
  const rows: BacklogRow[] = [];
  let section: string | null = null;
  for (const line of text.split("\n")) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    const row = BACKLOG_ROW.exec(line);
    if (row === null || section === null || section === "Done") continue;
    rows.push({
      id: (row[1] ?? row[2]).trim(),
      inFlight: section === "In flight",
      held: HOLD_METADATA.test(row[3]),
    });
  }
  return rows;
}

/**
 * Does any durable record disagree with reality?
 *
 * Two disagreements, both of them a record that has stopped matching what the
 * fleet is actually doing: a work item the backlog has in flight with no worker
 * behind it, and a work item still held while its own status log records the
 * decision as answered. Both are invisible from inside the fleet - each half is
 * individually consistent - and both leave work stopped indefinitely.
 */
async function readDrift(
  home: string,
  stateDir: string,
  signal: AbortSignal,
): Promise<DriftSignal> {
  const backlog = await readMaybe(join(home, BACKLOG_DIR, BACKLOG_FILE), signal);
  if (backlog === null) return dark(`Could not read the work item record ${BACKLOG_RECORD}.`);

  let workers: ReadonlySet<string>;
  try {
    workers = new Set(await liveWorkerIds(stateDir));
  } catch (error) {
    return dark(`Could not list the fleet's workers in ${STATE_DIR}/: ${why(error)}`);
  }

  const disagreements: Disagreement[] = [];
  for (const row of parseBacklog(backlog)) {
    if (row.inFlight && !workers.has(row.id)) {
      disagreements.push({
        record: BACKLOG_RECORD,
        detail: `${row.id} is in flight with no worker behind it.`,
      });
    }
    if (!row.held) continue;
    const log = await readMaybe(join(stateDir, `${row.id}${STATUS_SUFFIX}`), signal);
    if (log === null) continue;
    if (readsAsAnswered(log)) {
      disagreements.push({
        record: `${STATE_DIR}/${row.id}${STATUS_SUFFIX}`,
        detail: `${row.id} is still held while its status log records the decision answered.`,
      });
    }
  }
  return { read: "ok", disagreements };
}

/**
 * Read the health signals from a running fleet's home.
 *
 * The reading is taken now, so `asOf` is now: these are live files, and the
 * only age worth reporting is each signal's own.
 *
 * The whole reading is unreadable only when the home itself is not there - the
 * one failure that says nothing about any individual signal. Everything past
 * that point degrades per signal, so a moved beacon leaves the other two
 * working. Nothing thrown from inside here escapes: a quarantined module that
 * can take the panel down is not quarantined.
 */
export async function readFleetHomeHealth(
  home: string,
  clock: Clock,
  signal: AbortSignal,
): Promise<HealthReading> {
  try {
    const entry = await stat(home);
    if (!entry.isDirectory()) return dark(`The fleet home is not a directory: ${home}`);
  } catch (error) {
    return dark(`Could not read the fleet home: ${why(error)}`);
  }

  const stateDir = join(home, STATE_DIR);
  const [supervisor, overdue, drift] = await Promise.all([
    readSupervisor(stateDir, clock),
    readOverdue(stateDir, clock, signal),
    readDrift(home, stateDir, signal),
  ]);
  return { read: "ok", asOf: clock.now(), health: { supervisor, overdue, drift } };
}
