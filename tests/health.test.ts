import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { parseSnapshot, type SnapshotSource } from "../src/adapters/contract.ts";
import { readFleetHomeHealth, type HealthReading } from "../src/adapters/health.ts";
import { loadConfig } from "../src/config/index.ts";
import { projectDocument } from "../src/domain/project.ts";
import { fixedClock } from "../src/providers/clock.ts";
import type { Logger } from "../src/providers/logger.ts";
import { clockFor, FleetRuntime } from "../src/runtime/fleet.ts";
import type { Health } from "../src/types/document.ts";
import { REPO_ROOT } from "./lib/server.ts";

/**
 * The quarantined module, read against synthetic fleet homes.
 *
 * Health is the one lens whose source carries no compatibility promise, so the
 * claim under test is not "it reads the fleet" but "it keeps answering when the
 * fleet has moved underneath it". Every case below either reads a home or
 * breaks one, and none of them may throw: an exception here would take down a
 * panel whose other two lenses are perfectly fine.
 *
 * No test needs a live fleet. The homes are invented, and the one thing a
 * committed fixture cannot carry - the liveness beacon, whose whole content is
 * its modification time - each test writes into its own copy.
 */

const HOMES = join(REPO_ROOT, "fixtures", "homes");

/** Pinned, so nothing here races the clock. Matches the fixture instants. */
const NOW = "2099-01-01T09:15:30.000Z";
const CLOCK = fixedClock(NOW);
const OPTIONS = { clock: CLOCK, staleAfterMs: 60_000 };

/** The runtime logs only when a read fails, and none of these do. */
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** Long enough that no read here is decided by a timeout. */
function deadline(): AbortSignal {
  return AbortSignal.timeout(5_000);
}

const temporaries: string[] = [];
after(async () => {
  for (const dir of temporaries) await rm(dir, { recursive: true, force: true });
});

/** A private copy of one fixture home, safe to break. */
async function copyHome(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "quarterdeck-home-"));
  temporaries.push(dir);
  const home = join(dir, name);
  await cp(join(HOMES, name), home, { recursive: true });
  return home;
}

/**
 * Touch the liveness beacon `ageMs` before the pinned now.
 *
 * Git does not carry modification times, so a committed beacon would be as old
 * as the checkout and the age under test would be whatever the clock happened
 * to say. Each test sets the age it means.
 */
async function beacon(home: string, ageMs: number): Promise<void> {
  const file = join(home, "state", ".last-watcher-beat");
  await writeFile(file, "");
  const at = new Date(Date.parse(NOW) - ageMs);
  await utimes(file, at, at);
}

function health(reading: HealthReading): Health {
  assert.equal(reading.read, "ok", "the reading itself should have been readable");
  return (reading as { health: Health }).health;
}

async function readHome(home: string): Promise<HealthReading> {
  return readFleetHomeHealth(home, CLOCK, deadline());
}

describe("a fleet home that is running normally", () => {
  test("reports a live supervision cycle, nothing overdue and nothing disagreeing", async () => {
    const home = await copyHome("steady");
    await beacon(home, 30_000);

    const signals = health(await readHome(home));
    assert.deepEqual(signals.supervisor, {
      read: "ok",
      alive: true,
      lastSeen: "2099-01-01T09:15:00.000Z",
    });
    assert.deepEqual(signals.overdue, { read: "ok", overdue: [] });
    assert.deepEqual(signals.drift, { read: "ok", disagreements: [] });
  });

  test("a declared wait is not a problem, however long it has been waiting", async () => {
    const home = await copyHome("steady");
    await beacon(home, 30_000);

    // The set's second worker has been idle an hour, which is far past the
    // point an undeclared idle would be reported. Its last status line says
    // why, and a wait somebody declared is the fleet working as intended.
    const signals = health(await readHome(home));
    assert.deepEqual(signals.overdue, { read: "ok", overdue: [] });
  });

  test("a beacon nobody has touched lately reads as not alive, not as unreadable", async () => {
    const home = await copyHome("steady");
    await beacon(home, 20 * 60_000);

    assert.deepEqual(health(await readHome(home)).supervisor, {
      read: "ok",
      alive: false,
      lastSeen: "2099-01-01T08:55:30.000Z",
    });
  });
});

describe("a fleet home with something wrong in it", () => {
  test("reports the stalled worker, and only that one", async () => {
    const home = await copyHome("adrift");
    await beacon(home, 30_000);

    // Three workers are idle in this set. One is idle ten minutes with nothing
    // declared - the wedge. One declared its wait. One carries a retired
    // incarnation token, which the fleet's own contract reads as unknown rather
    // than as a worker gone quiet, so it is not reported either.
    assert.deepEqual(health(await readHome(home)).overdue, {
      read: "ok",
      overdue: [{ id: "wi-brightwater-207", waitingSince: "2099-01-01T09:05:30.000Z" }],
    });
  });

  test("reports both ways a durable record can disagree with reality", async () => {
    const home = await copyHome("adrift");
    await beacon(home, 30_000);

    const drift = health(await readHome(home)).drift;
    assert.equal(drift.read, "ok");
    assert.deepEqual(drift.read === "ok" ? drift.disagreements : [], [
      {
        record: "state/wi-brightwater-211.status",
        detail: "wi-brightwater-211 is still held while its status log records the decision answered.",
      },
      {
        record: "data/backlog.md",
        detail: "wi-brightwater-215 is in flight with no worker behind it.",
      },
    ]);
  });

  test("a verified transfer onto the record explains the hold rather than disagreeing with it", async () => {
    const home = await copyHome("adrift");
    await beacon(home, 30_000);
    // The same held row, whose decision the fleet transferred onto the durable
    // record instead of answering. The record holding it is then correct.
    await writeFile(
      join(home, "state", "wi-brightwater-211.status"),
      [
        "working: two shapes possible for the intake",
        "needs-decision [key=intake-shape]: pipe into the intake, or write a record",
        "captain-held [key=intake-shape]: transferred to the record for the captain",
        "",
      ].join("\n"),
    );

    const drift = health(await readHome(home)).drift;
    assert.deepEqual(
      drift.read === "ok" ? drift.disagreements.map((d) => d.record) : [],
      ["data/backlog.md"],
      "only the orphaned in-flight row should be left",
    );
  });

  test("a still-open decision is not a record that disagrees", async () => {
    const home = await copyHome("adrift");
    await beacon(home, 30_000);
    await writeFile(
      join(home, "state", "wi-brightwater-211.status"),
      "needs-decision [key=intake-shape]: which shape\nworking: carrying on meanwhile\n",
    );

    const drift = health(await readHome(home)).drift;
    assert.deepEqual(
      drift.read === "ok" ? drift.disagreements.map((d) => d.record) : [],
      ["data/backlog.md"],
    );
  });
});

describe("a fleet that has moved underneath the panel", () => {
  test("every signal reads unreadable, and nothing is thrown", async () => {
    const reading = await readHome(join(HOMES, "moved"));
    const signals = health(reading);

    for (const [name, signal] of Object.entries(signals)) {
      assert.equal(signal.read, "unreadable", `${name} should have gone dark`);
      assert.ok(
        signal.read === "unreadable" && signal.detail.length > 0,
        `${name} should say what could not be read`,
      );
    }
  });

  test("one path moving leaves the other two signals working", async () => {
    const home = await copyHome("steady");
    await beacon(home, 30_000);
    await rm(join(home, "data", "backlog.md"));

    const signals = health(await readHome(home));
    assert.equal(signals.drift.read, "unreadable");
    assert.equal(signals.supervisor.read, "ok");
    assert.equal(signals.overdue.read, "ok");
  });

  test("a beacon that is gone is unreadable, never a cycle declared dead", async () => {
    const home = await copyHome("steady");

    const supervisor = health(await readHome(home)).supervisor;
    assert.equal(supervisor.read, "unreadable");
    assert.ok(
      supervisor.read === "unreadable" && supervisor.detail.includes(".last-watcher-beat"),
      "the operator is told which path did not answer",
    );
  });

  test("a state directory that is no longer a directory takes the signals that need it", async () => {
    const home = await copyHome("steady");
    await rm(join(home, "state"), { recursive: true });
    await writeFile(join(home, "state"), "moved\n");

    // All three, here: whether a record disagrees with reality is a question
    // about the workers as much as about the record, so drift cannot be
    // answered without the state directory either. It says so rather than
    // reporting every in-flight row as an item with no worker behind it.
    const signals = health(await readHome(home));
    assert.equal(signals.supervisor.read, "unreadable");
    assert.equal(signals.overdue.read, "unreadable");
    assert.equal(signals.drift.read, "unreadable");
  });

  test("a home that is not there at all goes dark as a whole, without throwing", async () => {
    const reading = await readFleetHomeHealth(
      join(HOMES, "no-such-fleet-home"),
      CLOCK,
      deadline(),
    );
    assert.equal(reading.read, "unreadable");
  });

  test("a garbled busy-state record is unknown, never a worker reported as stalled", async () => {
    const home = await copyHome("steady");
    await beacon(home, 30_000);
    await writeFile(
      join(home, "state", "wi-tidewater-114.busy-state"),
      "v2 {\"state\": \"idle\", \"since\": \"long ago\"}\n",
    );

    assert.deepEqual(health(await readHome(home)).overdue, { read: "ok", overdue: [] });
  });
});

describe("the health lens going dark", () => {
  /**
   * The point of the whole module, and the reason health has its own status in
   * the document: the fleet and the deck come from a contract that either
   * parses or refuses, so a health source that has vanished must cost the panel
   * one lens and no more.
   */
  test("leaves the fleet and the deck exactly as they were", async () => {
    const snapshot = parseSnapshot(
      readFileSync(join(REPO_ROOT, "fixtures", "healthy", "snapshot.json"), "utf8"),
      "fixture:healthy",
    );
    const reading = await readFleetHomeHealth(
      join(HOMES, "no-such-fleet-home"),
      CLOCK,
      deadline(),
    );

    const document = projectDocument(snapshot, reading, OPTIONS);
    assert.equal(document.health.status.state, "unreadable");
    assert.equal(document.fleet.status.state, "fresh");
    assert.equal(document.deck.status.state, "fresh");
    assert.equal(document.fleet.content.length, snapshot.tasks.length);
    assert.ok(document.deck.content.length > 0, "the deck still has its items");
  });

  test("a fleet home fills the health part of the document", async () => {
    const home = await copyHome("adrift");
    await beacon(home, 30_000);
    const snapshot = parseSnapshot(
      readFileSync(join(REPO_ROOT, "fixtures", "healthy", "snapshot.json"), "utf8"),
      "fixture:healthy",
    );

    const document = projectDocument(snapshot, await readHome(home), OPTIONS);
    assert.equal(document.health.status.state, "fresh");
    assert.deepEqual(document.health.content.supervisor, {
      read: "ok",
      alive: true,
      lastSeen: "2099-01-01T09:15:00.000Z",
    });
    assert.equal(document.health.content.overdue.read, "ok");
    assert.equal(document.health.content.drift.read, "ok");
  });
});

test("a configured fleet home is what the panel's own document is built from", async () => {
  // The one path the tests above do not take: the environment variable, through
  // the config boundary, into the runtime that assembles the document. Every
  // other assertion here calls the module directly, so a wrong variable in that
  // wiring would be invisible.
  // The set with something wrong in it, and a beacon age no fixture health file
  // carries: if this document were built from the fixture health file instead,
  // every assertion below would be reading somebody else's numbers.
  const home = await copyHome("adrift");
  await beacon(home, 90_000);

  const config = loadConfig(REPO_ROOT, {
    // Spread rather than built from nothing: NODE_ENV is part of the shape the
    // boundary is typed against, and this test is about the three below.
    ...process.env,
    QUARTERDECK_FLEET_HOME: home,
    QUARTERDECK_NOW: NOW,
    QUARTERDECK_FIXTURE_SET: "healthy",
  });
  assert.equal(config.fleetHome, home, "the environment reaches the config");

  const fixtureSet = join(REPO_ROOT, "fixtures", "healthy");
  const source: SnapshotSource = {
    description: "fixture:healthy",
    read: async () => readFileSync(join(fixtureSet, "snapshot.json"), "utf8"),
  };
  // Never started: the watcher is not what is under test, and starting one
  // would leave a handle open on the fixtures.
  const runtime = new FleetRuntime({
    config,
    source,
    clock: clockFor(config),
    logger: quiet,
    watchDir: fixtureSet,
    healthDir: fixtureSet,
  });

  const document = await runtime.document();
  assert.deepEqual(document.health.content.supervisor, {
    read: "ok",
    alive: true,
    lastSeen: "2099-01-01T09:14:00.000Z",
  });
  assert.deepEqual(document.health.content.overdue, {
    read: "ok",
    overdue: [{ id: "wi-brightwater-207", waitingSince: "2099-01-01T09:05:30.000Z" }],
  });
  assert.equal(document.health.status.state, "fresh");
  assert.equal(document.fleet.status.state, "fresh");
  assert.equal(document.deck.status.state, "fresh");
});

test("every fixture home on disk is walked by a test above", async () => {
  const found = (await readdir(HOMES, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    found,
    ["adrift", "moved", "steady"],
    "add the home to a case above, and its row to fixtures/README.md",
  );
});
