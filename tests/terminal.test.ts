import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { REPO_ROOT, startPanel, until, type Panel } from "./lib/server.ts";

/**
 * The worker's terminal, on demand.
 *
 * The claim this file exists to hold is the cost rule: a card nobody has
 * expanded reads nothing. That is not something markup can show, so the fleet
 * home here publishes a peek command that records every call it receives, and
 * the tests assert on that record - first that it does not exist, then that
 * expanding a card put exactly one line in it.
 *
 * The second claim is that the three ways a session can fail to produce lines
 * stay three different facts on the way out. A session that is gone, one that
 * could not be read and one that has said nothing yet each come back as
 * themselves, from both sources: a real fleet's command, and a committed
 * fixture set.
 *
 * Three things are demonstrated in a browser rather than here, for the reason
 * `docs/ARCHITECTURE.md` already gives for the other three: that an expanded
 * terminal is still expanded and still scrolled where it was after an update
 * lands, and that a two-hundred-column line scrolls inside its own box rather
 * than pushing the page sideways. What this file can hold of that claim - that
 * the server never re-reads a session on a refresh - is the last test below.
 */

const nextPort = portsFor(import.meta.filename);

/** The rendered page, with React's text-node markers removed. */
async function body(panel: Panel): Promise<string> {
  const response = await fetch(panel.url);
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** How many rows the deck lens drew. Used to notice a refresh has landed. */
function deckItems(html: string): number {
  return (html.match(/data-deck-item="/g) ?? []).length;
}

interface Tail {
  worker: string;
  asOf: string;
  reading:
    | { read: "ok"; lines: string[] }
    | { read: "silent" }
    | { read: "no-session"; detail: string }
    | { read: "unreadable"; detail: string };
}

interface Read {
  readonly status: number;
  readonly tail: Tail;
}

async function readTerminal(panel: Panel, query: string): Promise<Read> {
  const response = await fetch(`${panel.url}/api/terminal?${query}`);
  return { status: response.status, tail: (await response.json()) as Tail };
}

/* --------------------------------------------------------- the fleet home */

/**
 * Where the peek command writes down that it was called. Outside `state/` and
 * `data/` deliberately: those are watched, and a witness that triggered a
 * refresh would be measuring itself.
 */
const CALLS = "peek-calls";

/** Every call the peek command has received, one `<worker> <lines>` per line. */
async function peekCalls(home: string): Promise<string[]> {
  const path = join(home, CALLS);
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf8"))
    .split("\n")
    .filter((line) => line.length > 0);
}

/**
 * The pane the peek command prints for an ordinary worker.
 *
 * Deliberately not clean: a window title sequence, colour, a progress bar
 * redrawn over itself with carriage returns, tabs, a stray bell, and one line
 * far wider than the column it will be drawn in. A capture from a real worker
 * looks like this, and the panel is not a terminal emulator.
 */
const ESC = "\u001b";
const BEL = "\u0007";
const PANE = [
  `${ESC}]0;wi-tidewater-501${BEL}${ESC}[1;32m==>${ESC}[0m rebasing onto main`,
  `${ESC}[2K\rfetching  10%\rfetching  72%\rfetching 100%`,
  "step\tstatus\tseconds",
  `${ESC}[31mreview\tholding\t41${ESC}[0m`,
  `trace: ${"quarterdeck/src/runtime/fleet.ts:".repeat(120)}`,
  "waiting for the reviewer",
  "",
  "",
].join("\n");

/**
 * A fleet home: the snapshot command, the peek command, and the two watched
 * directories. The peek records every call before answering it, and answers
 * three named workers with the three ways a session produces no lines.
 */
async function fakeFleetHome(fixtureSet: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "quarterdeck-terminal-"));
  await mkdir(join(home, "bin"), { recursive: true });
  await mkdir(join(home, "state"), { recursive: true });
  await mkdir(join(home, "data"), { recursive: true });
  await copyFile(
    join(REPO_ROOT, "fixtures", fixtureSet, "snapshot.json"),
    join(home, "snapshot.json"),
  );
  await writeFile(join(home, "pane.txt"), PANE);

  const snapshot = join(home, "bin", "fm-fleet-snapshot.sh");
  await writeFile(
    snapshot,
    [
      "#!/bin/sh",
      'test "$1" = "--json" || { echo "expected --json" >&2; exit 64; }',
      'exec cat "$FM_HOME/snapshot.json"',
      "",
    ].join("\n"),
  );
  await chmod(snapshot, 0o755);

  const peek = join(home, "bin", "fm-peek.sh");
  await writeFile(
    peek,
    [
      "#!/bin/sh",
      // The witness. Written before anything is answered, so a call that
      // fails is still a call that happened.
      `printf '%s %s\\n' "$1" "$2" >> "$FM_HOME/${CALLS}"`,
      'case "$1" in',
      // A worker that has been dispatched and has not printed anything.
      "  wi-lamplight-502) printf '\\n   \\n\\n' ;;",
      // Upstream's own words when there is nothing to read from.
      '  wi-saltmarsh-503) echo "error: no metadata for $1 in $FM_HOME/state" >&2; exit 1 ;;',
      // Something wrong with the machinery rather than with the worker.
      '  wi-cordage-504) echo "error: tmux: command not found" >&2; exit 127 ;;',
      '  *) cat "$FM_HOME/pane.txt" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  await chmod(peek, 0o755);
  return home;
}

/* ------------------------------------------------- nothing on the first paint */

describe("a card nobody has opened", () => {
  let home: string;
  let panel: Panel;

  before(async () => {
    home = await fakeFleetHome("upstream-shape");
    panel = await startPanel({
      port: nextPort(),
      now: "2099-01-01T09:15:30.000Z",
      env: { QUARTERDECK_FLEET_HOME: home },
    });
  });

  after(async () => {
    await panel.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("offers a terminal on every worker card", async () => {
    const html = await body(panel);
    assert.equal(
      (html.match(/data-terminal="/g) ?? []).length,
      8,
      "one disclosure per worker",
    );
  });

  test("reads no session to draw the page", async () => {
    await body(panel);
    await body(panel);
    assert.deepEqual(
      await peekCalls(home),
      [],
      "the page was rendered twice and no worker's session was read",
    );
  });

  test("puts no lines in the markup", async () => {
    const html = await body(panel);
    assert.ok(
      !html.includes("data-terminal-lines"),
      "a collapsed card carries no tail, not even a hidden one",
    );
    assert.ok(
      !html.includes("rebasing onto main"),
      "and none of the pane's text",
    );
  });
});

/* ------------------------------------------------------ reading a real session */

describe("expanding a card on a real fleet", () => {
  let home: string;
  let panel: Panel;

  before(async () => {
    home = await fakeFleetHome("upstream-shape");
    panel = await startPanel({
      port: nextPort(),
      now: "2099-01-01T09:15:30.000Z",
      env: { QUARTERDECK_FLEET_HOME: home },
    });
    // The first paint, so every assertion below is about what expanding did.
    await body(panel);
  });

  after(async () => {
    await panel.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("reads the worker's session, once, and asks for fifteen lines", async () => {
    const before = (await peekCalls(home)).length;
    const { status, tail } = await readTerminal(
      panel,
      "worker=wi-tidewater-501",
    );

    assert.equal(status, 200);
    assert.equal(tail.worker, "wi-tidewater-501");
    assert.equal(tail.asOf, "2099-01-01T09:15:30.000Z");
    assert.deepEqual(
      (await peekCalls(home)).slice(before),
      ["wi-tidewater-501 15"],
      "one call, naming the worker and the bound",
    );
  });

  test("hands back what the pane said, made printable", async () => {
    const { tail } = await readTerminal(panel, "worker=wi-tidewater-505");
    assert.equal(tail.reading.read, "ok");
    assert.ok(tail.reading.read === "ok");

    const text = tail.reading.lines.join("\n");
    assert.ok(!text.includes(ESC), "no escape sequences survive into the page");
    assert.ok(!text.includes(BEL), "and no stray control characters");
    assert.ok(
      text.includes("==> rebasing onto main"),
      "the words themselves do",
    );
    assert.ok(
      text.includes("step\tstatus\tseconds"),
      "and the tabs a worker meant",
    );
  });

  test("shows only what a redrawn line ended up saying", async () => {
    const { tail } = await readTerminal(panel, "worker=wi-tidewater-505");
    assert.ok(tail.reading.read === "ok");
    const progress = tail.reading.lines.find((line) =>
      line.includes("fetching"),
    );
    assert.equal(
      progress,
      "fetching 100%",
      "a carriage return means the rest was drawn over what came before it",
    );
  });

  test("bounds a very long line without breaking the frame", async () => {
    const { tail } = await readTerminal(panel, "worker=wi-tidewater-505");
    assert.ok(tail.reading.read === "ok");
    const trace = tail.reading.lines.find((line) => line.startsWith("trace:"));
    assert.ok(trace, "the long line is still there");
    assert.ok(trace.length <= 2_001, `a line is bounded, got ${trace.length}`);
    assert.ok(
      trace.endsWith("…"),
      "and says it was cut rather than pretending",
    );
  });

  test("carries no more than fifteen lines, and no trailing blank ones", async () => {
    const { tail } = await readTerminal(panel, "worker=wi-tidewater-505");
    assert.ok(tail.reading.read === "ok");
    assert.ok(tail.reading.lines.length <= 15, "fifteen is the bound");
    assert.equal(
      tail.reading.lines.at(-1),
      "waiting for the reviewer",
      "the blank rows a capture ends with are not lines the worker said",
    );
  });

  test("a worker that has said nothing yet says so", async () => {
    const { status, tail } = await readTerminal(
      panel,
      "worker=wi-lamplight-502",
    );
    assert.equal(status, 200);
    assert.deepEqual(tail.reading, { read: "silent" });
  });

  test("a session that is gone is not the same answer", async () => {
    const { status, tail } = await readTerminal(
      panel,
      "worker=wi-saltmarsh-503",
    );
    assert.equal(status, 200);
    assert.equal(tail.reading.read, "no-session");
    assert.ok(tail.reading.read === "no-session");
    assert.match(tail.reading.detail, /no metadata for wi-saltmarsh-503/);
  });

  test("a session that could not be read is a third answer, in its own words", async () => {
    const { status, tail } = await readTerminal(panel, "worker=wi-cordage-504");
    assert.equal(status, 200);
    assert.equal(tail.reading.read, "unreadable");
    assert.ok(tail.reading.read === "unreadable");
    assert.match(
      tail.reading.detail,
      /command not found/,
      "the command's own standard error, not a generic failure",
    );
  });

  test("the three absences are three different readings", async () => {
    const reads = await Promise.all(
      ["wi-lamplight-502", "wi-saltmarsh-503", "wi-cordage-504"].map((worker) =>
        readTerminal(panel, `worker=${worker}`),
      ),
    );
    assert.deepEqual(
      reads.map(({ tail }) => tail.reading.read),
      ["silent", "no-session", "unreadable"],
      "never merged into one blank box",
    );
  });
});

/* ----------------------------------------------------- what it will not read */

describe("what the read path refuses", () => {
  let home: string;
  let panel: Panel;

  before(async () => {
    home = await fakeFleetHome("upstream-shape");
    panel = await startPanel({
      port: nextPort(),
      now: "2099-01-01T09:15:30.000Z",
      env: { QUARTERDECK_FLEET_HOME: home },
    });
    await body(panel);
  });

  after(async () => {
    await panel.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("a worker this fleet never published", async () => {
    const before = await peekCalls(home);
    const { status, tail } = await readTerminal(
      panel,
      "worker=wi-elsewhere-999",
    );

    assert.equal(status, 404);
    assert.equal(tail.reading.read, "unreadable");
    assert.deepEqual(
      await peekCalls(home),
      before,
      "and no command was started",
    );
  });

  test("a selector that would reach past this fleet's own workers", async () => {
    // Upstream's peek treats anything containing a colon as a raw session
    // target, which would read any window on the machine.
    const before = await peekCalls(home);
    for (const worker of ["firstmate:mail", "../../etc/passwd", "-h", ""]) {
      const { status } = await readTerminal(
        panel,
        `worker=${encodeURIComponent(worker)}`,
      );
      assert.equal(status, 400, `refused: ${JSON.stringify(worker)}`);
    }
    assert.deepEqual(
      await peekCalls(home),
      before,
      "and none of them started a command",
    );
  });

  test("every method but GET", async () => {
    const before = await peekCalls(home);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await fetch(
        `${panel.url}/api/terminal?worker=wi-tidewater-501`,
        {
          method,
          body: method === "DELETE" ? undefined : "lines=1000",
        },
      );
      assert.equal(response.status, 405, `${method} is not a read`);
    }
    assert.deepEqual(
      await peekCalls(home),
      before,
      "nothing was read, and nothing sent",
    );
  });
});

/* ------------------------------------------------- an update under the reader */

describe("a refresh with a terminal open", () => {
  let home: string;
  let panel: Panel;

  before(async () => {
    home = await fakeFleetHome("upstream-shape");
    panel = await startPanel({
      port: nextPort(),
      now: "2099-01-01T09:15:30.000Z",
      env: { QUARTERDECK_FLEET_HOME: home },
    });
    await body(panel);
  });

  after(async () => {
    await panel.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("never re-reads the session the operator is looking at", async () => {
    await readTerminal(panel, "worker=wi-tidewater-501");
    const afterOpening = await peekCalls(home);
    assert.equal(afterOpening.length, 1);

    // The fleet moves, and the page re-renders the way a live refresh makes it.
    const snapshot = JSON.parse(
      await readFile(join(home, "snapshot.json"), "utf8"),
    );
    snapshot.backlog.records.push({
      order: 9,
      state: "queued",
      structured: true,
      id: "wi-northreach-530",
      title: "Sound the north channel",
      priority: "2",
      hold_reason: null,
      hold_kind: null,
      hold_until: null,
      blocked_by_ids: [],
      blocked_reason: null,
      since: "2099-01-01",
      captain_actionable: false,
    });
    await writeFile(
      join(home, "snapshot.json"),
      JSON.stringify(snapshot, null, 2),
    );
    await writeFile(
      join(home, "data", "backlog.md"),
      "- [ ] wi-northreach-530\n",
    );

    const rows = deckItems(await body(panel));
    await until(
      () => body(panel),
      (html) => deckItems(html) > rows,
    );

    assert.deepEqual(
      await peekCalls(home),
      afterOpening,
      "the update landed and no session was read again: the lines on screen are " +
        "the ones the operator asked for, and nothing moved underneath them",
    );
  });
});

/* --------------------------------------------------------- the fixture fleets */

describe("a fixture fleet's terminals", () => {
  let panel: Panel;

  before(async () => {
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: "healthy:crowded",
      now: "2099-01-01T09:15:30.000Z",
    });
  });

  after(async () => {
    await panel.stop();
  });

  test("behaves exactly as a fleet does, escapes and all", async () => {
    const { tail } = await readTerminal(
      panel,
      "fleet=healthy&worker=wi-tidewater-118",
    );
    assert.ok(tail.reading.read === "ok");
    const text = tail.reading.lines.join("\n");
    assert.ok(
      !text.includes(ESC),
      "the same normalising a real capture goes through",
    );
    assert.ok(text.includes("==> rebasing onto main"));
    assert.ok(
      tail.reading.lines.some((line) => line === "fetching 100%"),
      "a redrawn line shows what it ended up saying",
    );
  });

  test("cuts a long scrollback to the last fifteen lines", async () => {
    const { tail } = await readTerminal(
      panel,
      "fleet=healthy&worker=wi-lamplight-207",
    );
    assert.ok(tail.reading.read === "ok");
    assert.equal(tail.reading.lines.length, 15);
    assert.equal(tail.reading.lines.at(-1), "line 22 of the scrollback");
    assert.equal(tail.reading.lines[0], "line 08 of the scrollback");
  });

  test("carries all four readings, one worker each", async () => {
    const reads = await Promise.all(
      [
        "wi-tidewater-114",
        "wi-lamplight-211",
        "wi-saltmarsh-305",
        "wi-saltmarsh-302",
      ].map((worker) => readTerminal(panel, `fleet=healthy&worker=${worker}`)),
    );
    assert.deepEqual(
      reads.map(({ tail }) => tail.reading.read),
      ["ok", "silent", "no-session", "unreadable"],
    );
  });

  test("a worker the set records no session for says so, not nothing", async () => {
    const { status, tail } = await readTerminal(
      panel,
      "fleet=healthy&worker=wi-cordage-401",
    );
    assert.equal(status, 200);
    assert.equal(tail.reading.read, "no-session");
    assert.ok(tail.reading.read === "no-session");
    assert.match(tail.reading.detail, /records no session for wi-cordage-401/);
  });

  test("a set with no terminal file records no sessions at all", async () => {
    const { tail } = await readTerminal(
      panel,
      "fleet=crowded&worker=wi-tidewater-100",
    );
    assert.equal(tail.reading.read, "no-session");
    assert.ok(tail.reading.read === "no-session");
    assert.match(tail.reading.detail, /records no sessions/);
  });

  test("answers about the fleet it was asked about, not the one on screen", async () => {
    // The two fleets share no worker ids, so an answer out of the wrong one
    // would be a `no-session` rather than the tail below.
    const { tail } = await readTerminal(
      panel,
      "fleet=healthy&worker=wi-tidewater-114",
    );
    assert.equal(tail.reading.read, "ok");
  });
});
