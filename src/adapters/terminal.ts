import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CommandError, type Runner } from "../providers/process.ts";
import { TERMINAL_LINES, type TerminalReading } from "../types/terminal.ts";

/**
 * The worker's terminal, on demand.
 *
 * The fourth adapter, and the fourth thing the panel reads. It is its own file
 * rather than a corner of one of the other three because it is a third
 * reliability class: `contract.ts` refuses when the shape moves, `health.ts`
 * degrades when a path moves, and this one degrades *per worker* and is only
 * ever asked when somebody opens a card. Folding it into either would put an
 * on-demand read behind a module the first paint waits on.
 *
 * ## Read only, and structurally so
 *
 * Nothing here writes, and nothing here can. Reading a real fleet's session
 * means starting a process, which happens the only way any file in `src/` may:
 * through the single spawn door in `src/providers/process.ts`, which takes a
 * command path and an argument list, opens no shell, offers no stdin, and hands
 * back standard output. The command is the fleet's own published peek - the
 * same class of thing as the snapshot command, read-only by upstream's own
 * contract - and the argument is a work item id checked against
 * `WORKER_ID` before anything is started. See
 * `docs/decisions/2026-08-31-the-worker-terminal.md`.
 *
 * ## Nothing on the first paint
 *
 * This module is not reachable from the document. `src/domain/` does not import
 * it, the runtime does not read it on a pass, and the only caller is the route
 * a card asks when the operator expands it.
 */

/**
 * The command a fleet home publishes a bounded pane capture through, relative
 * to the home.
 *
 * Read-only by upstream's own contract: it resolves the worker's recorded
 * session target and prints the tail of it. It sends nothing, takes no lock and
 * writes nothing, which is what makes running it compatible with the panel's
 * claim to be a reader. Relative to the home for the same reason
 * `SNAPSHOT_COMMAND` is: no file outside the quarantined module names a machine
 * path, and the home itself arrives from configuration.
 */
const PEEK_COMMAND = "bin/fm-peek.sh";

/**
 * What a work item id may look like before it is passed to a command.
 *
 * Narrow on purpose, and the narrowness is the safety argument. Upstream's peek
 * resolves any selector containing a colon as a raw session target, so an id
 * carrying one would reach past this fleet's own workers to any window on the
 * machine; a leading dash would be read as an option rather than a target. The
 * route checks membership in the fleet as well - this is the check that holds
 * even if a later caller forgets to.
 */
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isWorkerId(value: string): boolean {
  return WORKER_ID.test(value);
}

/**
 * How much of one line is worth carrying.
 *
 * A pane can hold a line thousands of characters long - a stack trace, a base64
 * blob, a progress bar redrawn without a newline. The frame survives it either
 * way, because the tail scrolls inside its own box, but the response should not
 * carry a megabyte to show fifteen lines.
 */
const MAX_LINE_LENGTH = 2_000;

/* ------------------------------------------------------ making it printable */

/**
 * An operating system command sequence: `ESC ]` up to a bell or a string
 * terminator. Terminals use these to set a window title, which is not output.
 * Stripped first, because its payload can contain what looks like a CSI.
 */
const OSC_SEQUENCE = /\u001b\][\s\S]*?(?:\u0007|\u001b\\|$)/g;

/** A control sequence: colours, cursor moves, erases. `ESC [` to a final byte. */
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

/** Everything else introduced by an escape, including the two-byte forms. */
const OTHER_ESCAPE = /\u001b(?:[@-Z\\-_]|[ -/]*[0-~])?/g;

/**
 * The control characters left once the escapes are gone. Tab survives, because
 * it is layout a worker meant; the rest are machinery.
 */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/**
 * One captured line, made safe to put in a page.
 *
 * A carriage return in a pane means the rest of the line was drawn over what
 * came before it - which is how every progress bar in the world works - so only
 * what follows the last one is what the worker is actually showing. Escapes go
 * because the panel is not a terminal emulator and rendering them as glyphs
 * would be noise; remaining control characters go because they are not text.
 */
function printableLine(line: string): string {
  const shown = line.slice(line.lastIndexOf("\r") + 1);
  const stripped = shown
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(OTHER_ESCAPE, "")
    .replace(CONTROL_CHARACTER, "");
  return stripped.length > MAX_LINE_LENGTH
    ? `${stripped.slice(0, MAX_LINE_LENGTH)}…`
    : stripped;
}

/**
 * Captured bytes to a reading.
 *
 * Both sources come through here, so a fixture and a fleet cannot disagree
 * about what fifteen lines of a noisy pane look like - which is the same claim
 * the fixture sets make everywhere else in this panel.
 *
 * Trailing blank lines are dropped before anything is counted. A pane capture
 * routinely ends in them, and a tail that is nothing but blank rows is a worker
 * that has said nothing, not a worker whose last fifteen lines are empty. That
 * is why `ok` can never carry an empty list: it would be `silent`.
 */
export function readingOfCapture(captured: string): TerminalReading {
  const lines = captured.split("\n").map(printableLine);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0) return { read: "silent" };
  return { read: "ok", lines: lines.slice(-TERMINAL_LINES) };
}

/* ---------------------------------------------------------------- a source */

/**
 * Where a worker's tail comes from. Injected the way `SnapshotSource` is, so
 * the whole path can be driven from committed fixtures with no fleet present.
 */
export interface TerminalSource {
  /** Named in the reading's detail, so a failure says which source produced it. */
  readonly description: string;
  read(worker: string, signal: AbortSignal): Promise<TerminalReading>;
}

/**
 * A reading for an id this module will not put on a command line.
 *
 * `unreadable` rather than `no-session`: the panel did not look, so it has
 * nothing to say about whether a session exists.
 */
function refuseId(worker: string): TerminalReading {
  return {
    read: "unreadable",
    detail: `"${worker}" is not a work item id this panel will read a session for.`,
  };
}

/* -------------------------------------------------------- the fixture source */

/**
 * A fixture set's terminal file: one entry per worker, in the panel's own
 * shape.
 *
 * The same arrangement `health.json` has, and for the same reason. There is no
 * upstream contract for a pane capture, so a synthetic fleet has to be able to
 * state each of the outcomes a real one produces - including the failures,
 * which is what a fixture that could only hold text could not do. An `ok` entry
 * carries raw captured text rather than clean lines, escapes and all, so the
 * fixtures exercise the same normalising a fleet's own bytes go through.
 */
type TerminalFixtureEntry =
  | { readonly read: "ok"; readonly text: string }
  | { readonly read: "no-session"; readonly detail: string }
  | { readonly read: "unreadable"; readonly detail: string };

const TERMINAL_FIXTURE_FILE = "terminal.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One fixture entry, read leniently.
 *
 * A fixture set is committed to this repository and checked by the suite, so
 * this is not the place for the strictness `contract.ts` needs; an entry that
 * does not parse becomes an unreadable reading naming the file, which is a
 * state the lens has to draw anyway.
 */
function readingOfEntry(value: unknown, set: string, worker: string): TerminalReading {
  if (!isRecord(value)) {
    return {
      read: "unreadable",
      detail: `${set}/${TERMINAL_FIXTURE_FILE} holds no readable entry for ${worker}.`,
    };
  }
  const entry = value as TerminalFixtureEntry;
  if (entry.read === "ok" && typeof entry.text === "string") {
    return readingOfCapture(entry.text);
  }
  if (
    (entry.read === "no-session" || entry.read === "unreadable") &&
    typeof entry.detail === "string" &&
    entry.detail.length > 0
  ) {
    return { read: entry.read, detail: entry.detail };
  }
  return {
    read: "unreadable",
    detail: `${set}/${TERMINAL_FIXTURE_FILE} holds no readable entry for ${worker}.`,
  };
}

export function fixtureTerminalSource(
  fixtureRoot: string,
  fixtureSet: string,
): TerminalSource {
  const file = join(fixtureRoot, fixtureSet, TERMINAL_FIXTURE_FILE);
  return {
    description: `fixture:${fixtureSet}`,
    async read(worker, signal) {
      if (!isWorkerId(worker)) return refuseId(worker);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(file, { encoding: "utf8", signal }));
      } catch (error) {
        // A set with no terminal file at all is a synthetic fleet that records
        // no sessions, which is the same fact as one that records none for this
        // worker - not a failure of the machinery. Anything else that went
        // wrong reading it is.
        if ((error as { code?: unknown }).code === "ENOENT") {
          return {
            read: "no-session",
            detail: `the ${fixtureSet} fleet records no sessions.`,
          };
        }
        return {
          read: "unreadable",
          detail: `could not read ${fixtureSet}/${TERMINAL_FIXTURE_FILE}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      if (!isRecord(parsed)) {
        return {
          read: "unreadable",
          detail: `${fixtureSet}/${TERMINAL_FIXTURE_FILE} is not an object of work item ids.`,
        };
      }
      // A set that names no session for this worker is a fleet whose worker has
      // none, which is one of the states the card has to be able to draw.
      if (!(worker in parsed)) {
        return {
          read: "no-session",
          detail: `the ${fixtureSet} fleet records no session for ${worker}.`,
        };
      }
      return readingOfEntry(parsed[worker], fixtureSet, worker);
    },
  };
}

/* ----------------------------------------------------------- the fleet source */

/**
 * What upstream's peek says when the thing it was asked to read is not there.
 *
 * Matched on its own words, which is a soft dependency and is meant to be: a
 * phrasing this build does not recognise falls through to `unreadable`, which
 * is honest - the panel asked, something went wrong, and it is saying what.
 * Nothing is inferred that would let a missing session read as a working one.
 */
const NO_SESSION_STDERR = /no metadata for|no backend target recorded|no window named/i;

/**
 * A failed peek, turned into the reading it actually is.
 *
 * `CommandError` carries the exit code and what the command said on standard
 * error, and that is what an operator needs: "no metadata for wi-x-1" and
 * "no such file or directory" call for entirely different corrections, and a
 * bare "could not be read" gives them neither.
 */
function readingOfFailure(error: unknown): TerminalReading {
  if (error instanceof CommandError) {
    const said = error.stderr || error.message;
    if (NO_SESSION_STDERR.test(error.stderr)) return { read: "no-session", detail: said };
    return { read: "unreadable", detail: said };
  }
  return {
    read: "unreadable",
    detail: error instanceof Error ? error.message : String(error),
  };
}

/**
 * A real fleet, read through the bounded capture command it publishes.
 *
 * The home is configuration and arrives as an argument, so nothing here knows a
 * machine path. The environment is passed through for the same reason the
 * snapshot command's is - it needs a `PATH` to find the session tool it uses -
 * with `FM_HOME` set, which is how upstream is told which fleet to look in.
 */
export function fleetTerminalSource(
  fleetHome: string,
  runner: Runner,
  env: Readonly<Record<string, string | undefined>>,
): TerminalSource {
  const command = join(fleetHome, PEEK_COMMAND);
  const childEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[name] = value;
  }
  childEnv.FM_HOME = fleetHome;

  return {
    description: `fleet:${fleetHome}`,
    async read(worker, signal) {
      // Before the spawn, never after: an id that does not pass is one no
      // command is ever started for.
      if (!isWorkerId(worker)) return refuseId(worker);
      try {
        return readingOfCapture(
          await runner.run(command, [worker, String(TERMINAL_LINES)], {
            env: childEnv,
            signal,
          }),
        );
      } catch (error) {
        return readingOfFailure(error);
      }
    },
  };
}
