import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  ContractIdentifierError,
  ContractParseError,
  fleetSource,
  fleetWatchDirs,
  parseSnapshot,
  readSnapshot,
} from "../src/adapters/contract.ts";
import { readHealth } from "../src/adapters/health.ts";
import { fleetById, loadConfig } from "../src/config/index.ts";
import { projectDocument } from "../src/domain/project.ts";
import { fixedClock } from "../src/providers/clock.ts";
import type { Logger } from "../src/providers/logger.ts";
import type { RunOptions, Runner } from "../src/providers/process.ts";
import { FleetRuntime } from "../src/runtime/fleet.ts";
import { REPO_ROOT } from "./lib/server.ts";

/**
 * Reading a real fleet, without one.
 *
 * The fleet source runs a command; a command is a `Runner`, and a `Runner` is
 * an interface. That is the whole reason the provider door exists as one: every
 * claim below - the refusals, the timeout, the coalescing, the last-known-good -
 * is asserted against a stub that answers the way a fleet home would, on a
 * machine with no fleet anywhere near it.
 *
 * What the fleet's own snapshot actually looks like is asserted separately, by
 * the `upstream-shape` fixture set in `tests/document.test.ts`: a synthetic
 * fleet in upstream's real shape and real vocabulary.
 */

const FIXTURES = join(REPO_ROOT, "fixtures");

/** A fleet home. Invented, like every path in this repository. */
const FLEET_HOME = "/anchorage/fleet";
/** A second one, for the panel that can see more than one. */
const OTHER_HOME = "/anchorage/harbour";
/** A third, sharing its last segment with the first. */
const TWIN_HOME = "/moorings/fleet";

const OPTIONS = {
  clock: fixedClock("2099-01-01T09:15:30.000Z"),
  staleAfterMs: 60_000,
};

function fixtureText(set: string): string {
  return readFileSync(join(FIXTURES, set, "snapshot.json"), "utf8");
}

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * A fleet home that answers however the test needs it to, and records what it
 * was asked. `answer` returning a promise that never settles is a hung read.
 */
function stubRunner(answer: (call: Call) => Promise<string>): Runner & {
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    run(command: string, args: readonly string[], options: RunOptions) {
      const call = { command, args, env: options.env };
      calls.push(call);
      return new Promise<string>((resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(new Error("the read was aborted")),
        );
        answer(call).then(resolve, reject);
      });
    },
  };
}

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** Waits for something the runtime does off the caller's turn - starting a read. */
async function settles(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("the runtime never got there");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** The error a call threw, so a test can assert on more than its type. */
function thrownBy(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal, got a value");
}

function runtimeOn(
  source: { description: string; read(signal: AbortSignal): Promise<string> },
  readTimeoutMs = 5_000,
): FleetRuntime {
  return new FleetRuntime({
    config: {
      fleets: [
        {
          id: "healthy",
          label: "healthy",
          source: { kind: "fixture", set: "healthy" },
          intentDir: null,
        },
      ],
      fixtureRoot: FIXTURES,
      host: "127.0.0.1",
      port: 0,
      staleAfterMs: OPTIONS.staleAfterMs,
      debounceMs: 10,
      readTimeoutMs,
      now: "2099-01-01T09:15:30.000Z",
    },
    source,
    clock: OPTIONS.clock,
    logger: silentLogger,
    watchDirs: [join(FIXTURES, "healthy")],
    healthDir: join(FIXTURES, "healthy"),
    // null, not FLEET_HOME: this suite stubs the snapshot source directly, and
    // a fleet home here would redirect health to `readFleetHomeHealth`, which
    // has no real directory to read - `healthDir` above is what these tests
    // mean by "health reads for itself".
    fleetHome: null,
  });
}

/**
 * An environment to parse. Next augments `NodeJS.ProcessEnv` with a required
 * `NODE_ENV`, so a bare object literal is not one.
 */
function env(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}

describe("which fleets to read is configuration", () => {
  test("no fleet home means the fixture set, exactly as before", () => {
    const config = loadConfig(REPO_ROOT, env());
    assert.deepEqual(config.fleets, [
      {
        id: "healthy",
        label: "healthy",
        source: { kind: "fixture", set: "healthy" },
        intentDir: null,
      },
    ]);
  });

  test("a fleet home is taken from the environment, never from the code", () => {
    const config = loadConfig(REPO_ROOT, env({ QUARTERDECK_FLEET_HOME: FLEET_HOME }));
    assert.deepEqual(config.fleets, [
      { id: "fleet", label: "fleet", source: { kind: "home", home: FLEET_HOME }, intentDir: null },
    ]);
  });

  test("a trailing separator does not become a doubled one downstream", () => {
    const config = loadConfig(REPO_ROOT, env({ QUARTERDECK_FLEET_HOME: `${FLEET_HOME}/` }));
    assert.deepEqual(config.fleets[0].source, { kind: "home", home: FLEET_HOME });
  });

  test("a relative home is refused at the boundary rather than resolved later", () => {
    assert.throws(
      () => loadConfig(REPO_ROOT, env({ QUARTERDECK_FLEET_HOME: "fleet" })),
      /QUARTERDECK_FLEET_HOME must be an absolute path/,
    );
  });

  test("several homes are several fleets, in the order they were written", () => {
    const config = loadConfig(
      REPO_ROOT,
      env({ QUARTERDECK_FLEET_HOME: `${FLEET_HOME}:${OTHER_HOME}` }),
    );
    assert.deepEqual(
      config.fleets.map((fleet) => fleet.source),
      [
        { kind: "home", home: FLEET_HOME },
        { kind: "home", home: OTHER_HOME },
      ],
    );
    assert.deepEqual(
      config.fleets.map((fleet) => fleet.label),
      ["fleet", "harbour"],
    );
  });

  test("two homes with the same name still get distinct ids", () => {
    const config = loadConfig(
      REPO_ROOT,
      env({ QUARTERDECK_FLEET_HOME: `${FLEET_HOME}:${TWIN_HOME}` }),
    );
    assert.deepEqual(
      config.fleets.map((fleet) => fleet.id),
      ["fleet", "fleet-2"],
      "a cookie naming one of them must not be able to mean the other",
    );
  });

  test("a name that collides with an already-suffixed id still gets its own", () => {
    const config = loadConfig(
      REPO_ROOT,
      env({ QUARTERDECK_FIXTURE_SET: "foo:foo-3:foo" }),
    );
    const ids = config.fleets.map((fleet) => fleet.id);
    assert.equal(
      new Set(ids).size,
      ids.length,
      "a cookie naming one of them must not be able to mean another",
    );
  });

  test("several fixture sets are several fleets", () => {
    const config = loadConfig(
      REPO_ROOT,
      env({ QUARTERDECK_FIXTURE_SET: "healthy:fleet-only" }),
    );
    assert.deepEqual(
      config.fleets.map((fleet) => fleet.id),
      ["healthy", "fleet-only"],
    );
  });

  test("a fleet home wins over the fixture sets, as it always has", () => {
    const config = loadConfig(
      REPO_ROOT,
      env({ QUARTERDECK_FLEET_HOME: FLEET_HOME, QUARTERDECK_FIXTURE_SET: "healthy:stale" }),
    );
    assert.deepEqual(config.fleets.map((fleet) => fleet.source), [
      { kind: "home", home: FLEET_HOME },
    ]);
  });

  test("a fixture set that is not a directory name is refused at the boundary", () => {
    assert.throws(
      () => loadConfig(REPO_ROOT, env({ QUARTERDECK_FIXTURE_SET: "healthy:../escape" })),
      /QUARTERDECK_FIXTURE_SET must be a lowercase fixture directory name/,
    );
  });

  test("no intent dir configured leaves every fleet's spool closed", () => {
    const config = loadConfig(
      REPO_ROOT,
      env({ QUARTERDECK_FIXTURE_SET: "healthy:fleet-only" }),
    );
    assert.deepEqual(
      config.fleets.map((fleet) => fleet.intentDir),
      [null, null],
    );
  });

  test("a single intent dir names only the first fleet's spool, never every fleet's", () => {
    const config = loadConfig(
      REPO_ROOT,
      env({
        QUARTERDECK_FIXTURE_SET: "healthy:fleet-only",
        QUARTERDECK_INTENT_DIR: "/spool/one",
      }),
    );
    assert.deepEqual(
      config.fleets.map((fleet) => fleet.intentDir),
      ["/spool/one", null],
      "broadcasting one directory across every fleet would let an answer meant for one land in another's",
    );
  });

  test("intent dirs line up positionally with the configured fleet list", () => {
    const config = loadConfig(
      REPO_ROOT,
      env({
        QUARTERDECK_FIXTURE_SET: "healthy:fleet-only:stale",
        QUARTERDECK_INTENT_DIR: ":/spool/two:/spool/three",
      }),
    );
    assert.deepEqual(
      config.fleets.map((fleet) => fleet.intentDir),
      [null, "/spool/two", "/spool/three"],
      "an empty slot leaves that one fleet's spool closed rather than shifting the rest",
    );
  });
});

describe("a remembered selection names one of the configured fleets", () => {
  const config = loadConfig(REPO_ROOT, env({ QUARTERDECK_FIXTURE_SET: "healthy:stale" }));

  test("the fleet it names", () => {
    assert.equal(fleetById(config, "stale").id, "stale");
  });

  test("the first one when it names nothing", () => {
    assert.equal(fleetById(config, null).id, "healthy");
    assert.equal(fleetById(config, undefined).id, "healthy");
  });

  test("the first one when it names a fleet the panel no longer has", () => {
    assert.equal(
      fleetById(config, "a-fleet-that-was-removed").id,
      "healthy",
      "a setting can change under a remembered choice; falling back beats refusing",
    );
  });
});

describe("the fleet source runs the command upstream publishes", () => {
  test("under the configured home, asking for the structured surface", async () => {
    const runner = stubRunner(async () => fixtureText("upstream-shape"));
    const source = fleetSource(FLEET_HOME, runner, { PATH: "/usr/bin" });

    const snapshot = await readSnapshot(source, AbortSignal.timeout(5_000));

    assert.equal(runner.calls.length, 1);
    assert.equal(runner.calls[0].command, `${FLEET_HOME}/bin/fm-fleet-snapshot.sh`);
    assert.deepEqual(runner.calls[0].args, ["--json"]);
    assert.equal(runner.calls[0].env.FM_HOME, FLEET_HOME, "the home it is to report on");
    assert.equal(runner.calls[0].env.PATH, "/usr/bin", "the tools it needs to find");
    assert.equal(snapshot.tasks.length, 8);
  });

  test("a refusal names the fleet it came from, not just a file", async () => {
    const runner = stubRunner(async () => fixtureText("mismatched"));
    const source = fleetSource(FLEET_HOME, runner, {});

    await assert.rejects(
      () => readSnapshot(source, AbortSignal.timeout(5_000)),
      (error: unknown) =>
        error instanceof ContractIdentifierError && error.source === `fleet:${FLEET_HOME}`,
    );
  });

  test("what is watched comes from the home, and only from the home", () => {
    // Both, because a worker moving and a captain queuing an item touch
    // different directories, and the deck would otherwise never refresh.
    assert.deepEqual(fleetWatchDirs(FLEET_HOME), [
      `${FLEET_HOME}/state`,
      `${FLEET_HOME}/data`,
    ]);
  });
});

describe("a snapshot this build does not understand is refused, loudly", () => {
  test("a changed schema identifier names both identifiers", () => {
    const error = thrownBy(() =>
      parseSnapshot(fixtureText("mismatched"), `fleet:${FLEET_HOME}`),
    );
    assert.ok(error instanceof ContractIdentifierError);
    assert.equal(error.expected, "fm-fleet-snapshot.v1");
    assert.equal(error.found, "fm-fleet-snapshot.v2");
    assert.match(error.message, /refuses to render a snapshot it does not understand/);
  });

  test("a truncated snapshot is refused rather than half-parsed", () => {
    assert.throws(
      () => parseSnapshot(fixtureText("malformed"), "fleet:test"),
      (error: unknown) =>
        error instanceof ContractParseError && /not valid JSON/.test(error.detail),
    );
  });

  test("a state this build has no position for names the value it found", () => {
    const snapshot = JSON.parse(fixtureText("upstream-shape"));
    snapshot.tasks[0].current_state.state = "reticulating";
    assert.throws(
      () => parseSnapshot(JSON.stringify(snapshot), "fleet:test"),
      (error: unknown) =>
        error instanceof ContractParseError &&
        error.detail.includes("tasks[0].current_state.state") &&
        error.detail.includes("reticulating"),
    );
  });

  test("a missing structural field names the field, not the shape", () => {
    const snapshot = JSON.parse(fixtureText("upstream-shape"));
    delete snapshot.generated;
    assert.throws(
      () => parseSnapshot(JSON.stringify(snapshot), "fleet:test"),
      (error: unknown) =>
        error instanceof ContractParseError && error.detail.includes("generated"),
    );
  });

  test("prose upstream copied out of a backlog is not a reason to refuse", () => {
    const snapshot = JSON.parse(fixtureText("upstream-shape"));
    snapshot.backlog.records[0].priority = "extremely urgent";
    snapshot.backlog.records[0].since = "last Tuesday";
    const parsed = parseSnapshot(JSON.stringify(snapshot), "fleet:test");
    assert.equal(parsed.backlog.records[0].priority, "extremely urgent");
    assert.equal(parsed.backlog.records[0].since, "last Tuesday");
  });

  test("a task with no backlog row of its own is not a reason to refuse", () => {
    const snapshot = JSON.parse(fixtureText("upstream-shape"));
    assert.equal("backlog" in snapshot.tasks[0], false);
    const parsed = parseSnapshot(JSON.stringify(snapshot), "fleet:test");
    assert.equal(parsed.tasks[0].completion, null);
  });

  test("a task's joined backlog that is not an object names the path", () => {
    const snapshot = JSON.parse(fixtureText("upstream-shape"));
    snapshot.tasks[0].backlog = "wi-cordage-504";
    assert.throws(
      () => parseSnapshot(JSON.stringify(snapshot), "fleet:test"),
      (error: unknown) =>
        error instanceof ContractParseError && error.detail.includes("tasks[0].backlog"),
    );
  });

  test("a joined backlog's completion that is not an object names the path", () => {
    const snapshot = JSON.parse(fixtureText("upstream-shape"));
    assert.ok(snapshot.tasks[3].backlog, "wi-cordage-504 carries a joined backlog row");
    snapshot.tasks[3].backlog.completion = "merged";
    assert.throws(
      () => parseSnapshot(JSON.stringify(snapshot), "fleet:test"),
      (error: unknown) =>
        error instanceof ContractParseError &&
        error.detail.includes("tasks[3].backlog.completion"),
    );
  });
});

describe("the read discipline the refresh loop runs on", () => {
  test("overlapping triggers coalesce into one read", async () => {
    let release!: (text: string) => void;
    const gate = new Promise<string>((resolve) => (release = resolve));
    const runner = stubRunner(() => gate);
    const runtime = runtimeOn(fleetSource(FLEET_HOME, runner, {}));

    const readers = [runtime.document(), runtime.document()];
    await settles(() => runner.calls.length === 1);
    // A change published while the read is in flight, and two more callers
    // behind it: the burst a watcher produces when a fleet moves.
    runtime.publishChange();
    readers.push(runtime.document(), runtime.document());

    release(fixtureText("upstream-shape"));
    const documents = await Promise.all(readers);

    assert.equal(runner.calls.length, 1, "four callers, one read");
    for (const document of documents) assert.equal(document.fleet.content.length, 8);
  });

  test("a cached document is served without reading again", async () => {
    const runner = stubRunner(async () => fixtureText("upstream-shape"));
    const runtime = runtimeOn(fleetSource(FLEET_HOME, runner, {}));

    await runtime.document();
    await runtime.document();
    assert.equal(runner.calls.length, 1);

    runtime.publishChange();
    await runtime.document();
    assert.equal(runner.calls.length, 2, "a published change means read again");
  });

  test("a read that outlives the timeout is abandoned, not waited on", async () => {
    const runner = stubRunner(() => new Promise<string>(() => {}));
    const runtime = runtimeOn(fleetSource(FLEET_HOME, runner, {}), 60);

    const document = await runtime.document();

    assert.equal(document.fleet.status.state, "unreadable");
    assert.equal(document.deck.status.state, "unreadable");
    assert.equal(document.health.status.state, "fresh", "health reads for itself");
  });

  test("last known good stands, labelled, when a later read fails", async () => {
    let answer = async () => fixtureText("upstream-shape");
    const runner = stubRunner(() => answer());
    const runtime = runtimeOn(fleetSource(FLEET_HOME, runner, {}));

    const good = await runtime.document();
    assert.equal(good.fleet.status.state, "fresh");

    answer = async () => {
      throw new Error("the fleet home went away");
    };
    runtime.publishChange();
    const degraded = await runtime.document();

    assert.equal(degraded.fleet.content.length, 8, "the fleet is still on screen");
    assert.equal(degraded.deck.content.length, 5);
    assert.equal(degraded.fleet.status.state, "unreadable");
    assert.ok(
      degraded.fleet.status.state === "unreadable" &&
        degraded.fleet.status.detail.includes("the fleet home went away"),
      "and it says what went wrong, in one line",
    );
  });

  test("a failed read leaves the panel trying again rather than stuck", async () => {
    let fail = true;
    const runner = stubRunner(async () => {
      if (fail) throw new Error("not yet");
      return fixtureText("upstream-shape");
    });
    const runtime = runtimeOn(fleetSource(FLEET_HOME, runner, {}));

    assert.equal((await runtime.document()).fleet.status.state, "unreadable");
    fail = false;
    assert.equal((await runtime.document()).fleet.status.state, "fresh");
  });

  test("a changed schema is never survivable, however good the last document was", async () => {
    let answer = async () => fixtureText("upstream-shape");
    const runner = stubRunner(() => answer());
    const runtime = runtimeOn(fleetSource(FLEET_HOME, runner, {}));

    await runtime.document();
    answer = async () => fixtureText("mismatched");
    runtime.publishChange();

    await assert.rejects(() => runtime.document(), ContractIdentifierError);
  });
});

describe("upstream's shape, projected", () => {
  async function fleetOf(set: string) {
    const snapshot = parseSnapshot(fixtureText(set), `fixture:${set}`);
    const health = await readHealth(join(FIXTURES, set), AbortSignal.timeout(5_000));
    return projectDocument(snapshot, health, OPTIONS);
  }

  test("every state a live fleet reports lands on a stage", async () => {
    const { content } = (await fleetOf("upstream-shape")).fleet;
    assert.deepEqual(
      content.map((worker) => `${worker.id} ${worker.lifecycle.stage}`),
      [
        "wi-tidewater-501 working",
        "wi-lamplight-502 held",
        "wi-saltmarsh-503 blocked",
        // A finished run is the end of the on-track sequence.
        "wi-cordage-504 landed",
        "wi-tidewater-505 failed",
        // Deliberately idling, and upstream unable to tell, both stop at
        // `waiting` - the one halted stage that asserts no cause in the fleet.
        "wi-lamplight-506 waiting",
        "wi-saltmarsh-507 waiting",
        // Upstream says `done` for both a merged pull request and one whose
        // checks merely went green. They are different places to be.
        "wi-northreach-508 pr-open",
      ],
    );
  });

  test("a finished run is landed only when its own row says merged", async () => {
    const { content } = (await fleetOf("upstream-shape")).fleet;
    const merged = content.find((worker) => worker.id === "wi-cordage-504")!;
    const green = content.find((worker) => worker.id === "wi-northreach-508")!;

    assert.equal(merged.lifecycle.stage, "landed");
    assert.equal(merged.pullRequest?.state, "landed");
    // The one that would mislead: a pull request waiting to be read, shown as
    // merged, is how an operator skips the thing asking for their attention.
    assert.equal(green.lifecycle.stage, "pr-open");
    assert.equal(green.pullRequest?.state, "open");
    assert.equal(green.lifecycle.detail, "checks green: PR ready for review");
  });

  test("a worker upstream could not read says so in its own words", async () => {
    const { content } = (await fleetOf("upstream-shape")).fleet;
    const lost = content.find((worker) => worker.id === "wi-saltmarsh-507")!;
    assert.equal(lost.lifecycle.detail, "worktree gone (torn down?)");
    assert.equal(lost.worktree.present, false);
  });

  test("a project is a name in the document, never a path", async () => {
    const { content } = (await fleetOf("upstream-shape")).fleet;
    assert.deepEqual(
      [...new Set(content.map((worker) => worker.project))],
      ["tidewater", "lamplight", "saltmarsh", "cordage", "northreach"],
    );
  });

  test("a kind upstream invented is building; only a scout is research", async () => {
    const { content } = (await fleetOf("upstream-shape")).fleet;
    assert.equal(content[5].kind, "research", "a scout");
    assert.equal(content[6].kind, "build", "a kind this build has never seen");
  });

  test("a pull request upstream reports as absent is no pull request", async () => {
    const { content } = (await fleetOf("upstream-shape")).fleet;
    assert.equal(content[0].pullRequest, null);
    assert.deepEqual(content[3].pullRequest, {
      url: "https://forge.invalid/cordage/pull/504",
      state: "landed",
      checks: "unknown",
    });
  });

  test("numeric ranks are the deck's own words, and an unranked row is later", async () => {
    const { content } = (await fleetOf("upstream-shape")).deck;
    assert.deepEqual(
      content.map((item) => `${item.id} ${item.state} ${item.priority}`),
      [
        "wi-tidewater-501 in-flight now",
        "wi-cordage-512 queued next",
        "wi-lamplight-513 queued later",
        "wi-saltmarsh-514 queued later",
        "wi-northreach-508 in-flight now",
      ],
    );
  });

  test("a line nobody turned into a row is not a deck item", async () => {
    const { content } = (await fleetOf("upstream-shape")).deck;
    assert.ok(
      content.every((item) => item.id.length > 0),
      "an unstructured backlog line has no id to show",
    );
    assert.equal(content.length, 5, "one unstructured line and one done row dropped");
  });

  test("a start date widens to an instant; a row that did not say gets the read", async () => {
    const { content } = (await fleetOf("upstream-shape")).deck;
    assert.equal(content[0].since, "2099-01-01T00:00:00.000Z");
    assert.equal(content[3].since, "2099-01-01T09:15:00.000Z", "when upstream looked");
  });

  test("a deferral that is not a date is not carried as one", async () => {
    const { content } = (await fleetOf("upstream-shape")).deck;
    assert.deepEqual(content[2].hold, {
      waitingOn: "captain",
      reason: "Needs a naming decision",
      deferredTo: "2099-01-04",
    });
    assert.deepEqual(content[3].hold, {
      waitingOn: "captain",
      reason: null,
      deferredTo: null,
    });
  });

  test("a row cleaned down to nothing is named by its id", async () => {
    const { content } = (await fleetOf("upstream-shape")).deck;
    assert.equal(content[3].title, "wi-saltmarsh-514");
  });
});
