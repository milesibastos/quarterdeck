import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  MERGE_RECORD_SUFFIX,
  mergeOrderLine,
  mergeRequestIdFor,
} from "../src/adapters/intent.ts";
import { SESSION_HEADER } from "../src/runtime/session.ts";
import {
  ORDER_EXPLAINER,
  ORDER_RECORDED,
  ORDER_UNCONFIRMED,
} from "../src/ui/needs-you/merge-copy.ts";
import { portsFor } from "./lib/ports.ts";
import { copyFixtures, startPanel, type Panel } from "./lib/server.ts";

/**
 * Ordering a merge, against the built server.
 *
 * The property under test is not "the merge worked" - this panel cannot know
 * that and must never say it. It is that a card appears only over work that is
 * genuinely ready, that pressing it produces exactly one durable record in the
 * shape the fleet's guarded merge command takes its arguments in, that pressing
 * twice produces nothing further, and that a world which moved between the
 * render and the press is refused rather than acted on.
 *
 * Nothing here runs a fleet command, and nothing in the panel can: the record
 * is the whole of the panel's side. `bin/fm-pr-merge.sh` performs the merge and
 * owns every rule about whether it may - which is why none of these tests
 * expect the panel to reason about merge queues, conflicts or reviews.
 */

const nextPort = portsFor(import.meta.filename);

/** The one merge-ready worker in the `healthy` set: open, green, unmerged. */
const READY = {
  taskId: "wi-cordage-406",
  url: "https://forge.invalid/cordage/pull/406",
};

/** Everything in `healthy` that has a pull request but is not merge-ready. */
const NOT_READY = {
  /** Checks read, and still running. */
  pending: "wi-saltmarsh-302",
  /** Checks read, and red. */
  failing: "wi-saltmarsh-305",
  /** Green, but the pull request already landed. */
  landed: "wi-cordage-401",
};

/** `crowded`'s two pull requests whose checks nobody could read, or asked about. */
const UNKNOWN_CHECKS = { unreadable: "wi-windlass-142", notLookedUp: "wi-halyard-289" };

async function spoolDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "quarterdeck-merge-intents-"));
}

/** Every record in the spool, name and content, in a stable order. */
async function spool(dir: string): Promise<[string, string][]> {
  const names = (await readdir(dir)).sort();
  return Promise.all(
    names.map(async (name): Promise<[string, string]> => [
      name,
      await readFile(join(dir, name), "utf8"),
    ]),
  );
}

async function html(panel: Panel): Promise<string> {
  return (await fetch(panel.url)).text();
}

function secretFrom(page: string): string {
  const match = /\\?"secret\\?":\\?"([A-Za-z0-9_-]{20,})\\?"/.exec(page);
  assert.ok(match, "the page carries the session secret once a spool is configured");
  return match[1];
}

/** One order, posted the way the card posts it. */
async function order(
  panel: Panel,
  secret: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${panel.url}/api/act/merge-pull-request`, {
    method: "POST",
    headers: { "content-type": "application/json", [SESSION_HEADER]: secret },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("the merge card in the needs-you band", () => {
  let panel: Panel;
  let dir: string;
  before(async () => {
    dir = await spoolDir();
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: "healthy",
      env: { QUARTERDECK_INTENT_DIR: dir },
    });
  });
  after(async () => {
    await panel.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("draws the card, in the band, with a button on it", async () => {
    const page = await html(panel);
    assert.ok(page.includes('data-needs-group="merges"'), "beside the decisions, not below them");
    assert.ok(page.includes(`data-merge-card="${READY.taskId}"`));
    assert.ok(page.includes(`data-merge-order="${READY.taskId}"`), "and the button that acts");
  });

  test("shows the full address, never a bare number", async () => {
    const page = await html(panel);
    assert.ok(page.includes(READY.url), "the whole address the record will carry");
    // A number is only a pull request once you have decided which repository it
    // is in, and the panel shows several projects at once.
    assert.ok(!/>#?406</.test(page), "the card must not offer the number alone");
  });

  test("shows the checks state the button is being pressed against", async () => {
    const page = await html(panel);
    assert.ok(page.includes('data-merge-checks="passing"'));
    assert.ok(page.includes("6 of 6 checks"), "counted, not summarised as a word");
  });

  test("counts the merges in the band's header, beside the decisions", async () => {
    const page = await html(panel);
    assert.match(page, /2 decisions[\s\S]{0,120}1 to merge/);
  });

  test("offers no button on work whose checks are running, red, or already landed", async () => {
    const page = await html(panel);
    for (const [why, id] of Object.entries(NOT_READY)) {
      assert.ok(!page.includes(`data-merge-card="${id}"`), `${id} is ${why}, not merge-ready`);
      assert.ok(!page.includes(`data-merge-order="${id}"`), `and carries no button either`);
      assert.ok(page.includes(`data-worker="${id}"`), "it is still drawn in the fleet lens");
    }
  });
});

describe("a fleet whose checks nobody has read", () => {
  let panel: Panel;
  let dir: string;
  before(async () => {
    dir = await spoolDir();
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: "crowded",
      env: { QUARTERDECK_INTENT_DIR: dir },
    });
  });
  after(async () => {
    await panel.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("offers no button over a reading nobody took", async () => {
    // The two absences are different facts - nobody asked the forge, and the
    // forge was asked and could not tell - and neither of them is "probably
    // fine". A button here would be the panel implying a green run it has not
    // established.
    const page = await html(panel);
    for (const [why, id] of Object.entries(UNKNOWN_CHECKS)) {
      assert.ok(!page.includes(`data-merge-card="${id}"`), `${id}: its checks are ${why}`);
    }
    assert.ok(!page.includes('data-needs-group="merges"'), "no group at all, not an empty one");
  });
});

describe("recording a merge order", () => {
  let panel: Panel;
  let dir: string;
  let secret: string;
  before(async () => {
    dir = await spoolDir();
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: "healthy",
      env: { QUARTERDECK_INTENT_DIR: dir },
    });
    secret = secretFrom(await html(panel));
  });
  after(async () => {
    await panel.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("writes exactly the merge command's argument list, and nothing else", async () => {
    const result = await order(panel, secret, { taskId: READY.taskId, url: READY.url });
    assert.equal(result.status, 200);

    const records = await spool(dir);
    assert.equal(records.length, 1, "one order, one record");
    const [name, content] = records[0];
    assert.match(name, /^[0-9a-f]{32}\.merge-order-v1$/, "named by the request identity");
    // `<task-id>\t<pr-url>` and one newline: the two arguments
    // `bin/fm-pr-merge.sh` takes, in its order. No header, no provenance, no
    // timestamp, and nothing about the checks - the command reads those live.
    assert.equal(content, `${READY.taskId}\t${READY.url}\n`);
  });

  test("says the order was recorded, and never that anything merged", async () => {
    const result = await order(panel, secret, { taskId: READY.taskId, url: READY.url });
    assert.equal(result.status, 200);
    assert.match(String(result.body.detail), /recorded/i);
    assert.doesNotMatch(
      String(result.body.detail),
      /merged|merging|landed|shipped/i,
      "the panel has read nothing since; it cannot know anything merged",
    );
  });

  test("the copy the card draws after a press claims no more than that", async () => {
    /*
     * Pinned here rather than left to care. These sentences are drawn by a
     * client component, so they never reach the server-rendered page and no
     * test that reads HTML can hold them - and five bugs in this project have
     * been the panel asserting something it had not established. This is the
     * easiest place left to make that mistake and the worst.
     */
    for (const line of [ORDER_RECORDED, ORDER_UNCONFIRMED, ORDER_EXPLAINER]) {
      assert.doesNotMatch(line, /\bhas merged|was merged|is merged|now merged|has landed\b/i);
    }
    assert.match(ORDER_UNCONFIRMED, /cannot say/i, "the limit of what it knows is said out loud");
    assert.match(ORDER_RECORDED, /next check/, "and who acts, and when");
  });

  test("the panel's own process spawns nothing to do it", async () => {
    // Not a promise about this route: no file in `src/` may import
    // `child_process`, and `tests/invariants.test.ts` fails the build if one
    // does. What is asserted here is that ordering a merge went through the one
    // permitted writer and produced a file, which is the whole of its effect.
    const records = await spool(dir);
    assert.ok(records.every(([name]) => name.endsWith(MERGE_RECORD_SUFFIX)));
  });
});

describe("replaying a merge order", () => {
  let panel: Panel;
  let dir: string;
  let secret: string;
  before(async () => {
    dir = await spoolDir();
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: "healthy",
      env: { QUARTERDECK_INTENT_DIR: dir },
    });
    secret = secretFrom(await html(panel));
  });
  after(async () => {
    await panel.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("the same order twice changes nothing the second time", async () => {
    const first = await order(panel, secret, { taskId: READY.taskId, url: READY.url });
    assert.equal(first.status, 200);
    assert.equal(first.body.duplicate, false);
    const before = await spool(dir);

    const second = await order(panel, secret, { taskId: READY.taskId, url: READY.url });
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true, "the replay is recognised as one");
    assert.equal(second.body.requestId, first.body.requestId, "and has the same identity");

    // The acceptance is the disk, not the reply: byte for byte, name for name,
    // the spool is what it was before the replay arrived.
    assert.deepEqual(await spool(dir), before);
  });

  test("a double click - eight of them - still leaves one record", async () => {
    const dir2 = await spoolDir();
    const burst = await startPanel({
      port: nextPort(),
      fixtureSet: "healthy",
      env: { QUARTERDECK_INTENT_DIR: dir2 },
    });
    try {
      const key = secretFrom(await html(burst));
      const results = await Promise.all(
        Array.from({ length: 8 }, () => order(burst, key, { taskId: READY.taskId, url: READY.url })),
      );
      assert.ok(results.every((result) => result.status === 200));
      const records = await spool(dir2);
      assert.equal(records.length, 1, "eight simultaneous presses, one merge order");
      assert.equal(
        results.filter((result) => result.body.duplicate === false).length,
        1,
        "exactly one of them wrote it",
      );
    } finally {
      await burst.stop();
      await rm(dir2, { recursive: true, force: true });
    }
  });
});

describe("the merge order's identity is frozen", () => {
  /**
   * An order's name is what makes a replay a collision instead of a second
   * merge, and records written by earlier builds may still be sitting in
   * spools. So the digest's inputs and the record's extension are pinned here
   * rather than described: change either and every one of those records stops
   * colliding, quietly, and a double click becomes two orders again.
   */
  test("the same work item and pull request always name the same record", () => {
    assert.equal(mergeRequestIdFor(READY), "6461cdf98b5a0b04d40cde7d27b2a1c4");
  });

  test("nothing that moves is in the name", () => {
    // Not the checks' `as_of`, which moves every time the forge is read, and
    // not a head commit, which this document does not carry at all. Either in
    // the digest would mint a fresh identity for the same order.
    assert.equal(
      mergeRequestIdFor({ taskId: READY.taskId, url: READY.url }),
      mergeRequestIdFor({ taskId: READY.taskId, url: READY.url }),
    );
    assert.notEqual(
      mergeRequestIdFor({ taskId: READY.taskId, url: READY.url }),
      mergeRequestIdFor({ taskId: READY.taskId, url: `${READY.url}0` }),
      "a different pull request is a different order",
    );
  });

  test("the extension is not the answer intake's", () => {
    // A merge order landing with `.keyed-answer-v1` on it would be handed to
    // the answer intake, which would read an address as an answer.
    assert.equal(MERGE_RECORD_SUFFIX, ".merge-order-v1");
  });
});

describe("a pull request that changed between the render and the press", () => {
  /**
   * The page an operator pressed may be seconds or minutes old. So the world is
   * re-read at the moment the order is acted on, and an order about a world
   * that has moved is refused with an explanation rather than passed on.
   *
   * Each test below changes the fixture under the running panel and posts at
   * once - no waiting on a watcher, because the acting route does not read the
   * cache. That is the point being tested as much as the refusal is.
   */
  let panel: Panel;
  let dir: string;
  let secret: string;
  let fixtureRoot: string;
  let original: string;

  const snapshot = (): string => join(fixtureRoot, "healthy", "snapshot.json");

  /** Rewrite the merge-ready worker's pull request block, under the panel. */
  async function change(mutate: (task: Record<string, unknown>) => void): Promise<void> {
    const document = JSON.parse(original) as { tasks: Record<string, unknown>[] };
    const task = document.tasks.find((candidate) => candidate.id === READY.taskId);
    assert.ok(task, "the fixture still carries the merge-ready worker");
    mutate(task);
    await writeFile(snapshot(), JSON.stringify(document, null, 2));
  }

  before(async () => {
    dir = await spoolDir();
    fixtureRoot = await copyFixtures();
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: "healthy",
      fixtureRoot,
      env: { QUARTERDECK_INTENT_DIR: dir },
    });
    secret = secretFrom(await html(panel));
    original = await readFile(snapshot(), "utf8");
  });
  after(async () => {
    await panel.stop();
    await rm(dir, { recursive: true, force: true });
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  test("checks that went red since the page was drawn refuse the order", async () => {
    await change((task) => {
      (task.pr as Record<string, unknown>).checks = {
        read: "ok",
        outcome: "failing",
        finished: 6,
        total: 6,
        as_of: "2099-01-01T09:20:00.000Z",
      };
    });

    const result = await order(panel, secret, { taskId: READY.taskId, url: READY.url });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /no longer ready/i);
    assert.match(String(result.body.error), /6 of 6 failing/, "and says what it reads now");
    assert.deepEqual(await spool(dir), [], "and nothing was recorded");
  });

  test("a pull request that landed since refuses the order", async () => {
    await change((task) => {
      (task.current_state as Record<string, unknown>).state = "landed";
    });

    const result = await order(panel, secret, { taskId: READY.taskId, url: READY.url });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /no longer ready/i);
    assert.deepEqual(await spool(dir), []);
  });

  test("a pull request replaced by a different one refuses, naming both", async () => {
    const moved = "https://forge.invalid/cordage/pull/407";
    await change((task) => {
      (task.pr as Record<string, unknown>).url = moved;
    });

    const result = await order(panel, secret, { taskId: READY.taskId, url: READY.url });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), new RegExp(moved.replace(/\//g, "\\/")));
    assert.match(String(result.body.error), /different pull request/i);
    assert.deepEqual(await spool(dir), []);
  });

  test("work the fleet no longer carries refuses the order", async () => {
    const document = JSON.parse(original) as { tasks: { id: string }[] };
    document.tasks = document.tasks.filter((task) => task.id !== READY.taskId);
    await writeFile(snapshot(), JSON.stringify(document, null, 2));

    const result = await order(panel, secret, { taskId: READY.taskId, url: READY.url });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /no longer carries/i);
    assert.deepEqual(await spool(dir), []);
  });

  test("a fleet that cannot be read at all refuses rather than guessing", async () => {
    // "I cannot confirm" is a changed world as far as an order to merge is
    // concerned. The alternative is passing on an order backed by a picture the
    // panel has already stopped trusting.
    await writeFile(snapshot(), '{ "schema": "fm-fleet-snapshot.v1", "generated": "2099-01');

    const result = await order(panel, secret, { taskId: READY.taskId, url: READY.url });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /cannot confirm/i);
    assert.match(String(result.body.error), /Nothing was recorded/);
    assert.deepEqual(await spool(dir), []);
  });

  test("and the order still records once the world reads clean again", async () => {
    await writeFile(snapshot(), original);
    const result = await order(panel, secret, { taskId: READY.taskId, url: READY.url });
    assert.equal(result.status, 200);
    assert.equal((await spool(dir)).length, 1);
  });
});

describe("what the merge route refuses outright", () => {
  let panel: Panel;
  let dir: string;
  let secret: string;
  before(async () => {
    dir = await spoolDir();
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: "healthy",
      env: { QUARTERDECK_INTENT_DIR: dir },
    });
    secret = secretFrom(await html(panel));
  });
  after(async () => {
    await panel.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("an order with no session secret never reaches the writer", async () => {
    const response = await fetch(`${panel.url}/api/act/merge-pull-request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: READY.taskId, url: READY.url }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await spool(dir), []);
  });

  test("a body missing a field is refused before anything is read", async () => {
    const result = await order(panel, secret, { taskId: READY.taskId });
    assert.equal(result.status, 400);
    assert.match(String(result.body.error), /"url" must be a string/);
    assert.deepEqual(await spool(dir), []);
  });

  test("an order about a pull request the fleet does not have is refused", async () => {
    const result = await order(panel, secret, { taskId: NOT_READY.pending, url: READY.url });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /different pull request/i);
    assert.deepEqual(await spool(dir), []);
  });
});

describe("what the writer itself will not put in a merge order", () => {
  /**
   * Defence behind the re-check, not instead of it. Nothing that fails these
   * can reach the writer through the route today - the re-check compares the
   * address against the fleet's own first - which is exactly why they are
   * tested here rather than over HTTP. The writer is the file the whole safety
   * argument reduces to, and it has to hold on its own terms.
   */
  const base = { kind: "merge-pull-request", requestId: "a".repeat(32), taskId: "wi-x-1" } as const;

  test("a bare number is not an address, and the panel will not guess one", () => {
    const refusal = mergeOrderLine({ ...base, url: "406" });
    assert.equal(refusal.ok, false);
    assert.match(refusal.ok === false ? refusal.detail : "", /not a full address/);
  });

  test("a scheme a pull request is not addressed by is refused", () => {
    const refusal = mergeOrderLine({ ...base, url: "file:///etc/passwd" });
    assert.equal(refusal.ok, false);
  });

  test("a tab would cut the line into fields it does not have", () => {
    const refusal = mergeOrderLine({ ...base, url: "https://forge.invalid/a/pull/1\tmore" });
    assert.equal(refusal.ok, false);
    assert.match(refusal.ok === false ? refusal.detail : "", /tab or a line break/);
  });

  test("the line it does write is the argument list, and one newline", () => {
    const written = mergeOrderLine({ ...base, url: READY.url });
    assert.equal(written.ok, true);
    assert.equal(written.line, `wi-x-1\t${READY.url}\n`);
  });
});

describe("a panel with nowhere to record a merge order", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  test("says so on the card rather than offering a button that cannot work", async () => {
    const page = await html(panel);
    assert.ok(page.includes(`data-merge-card="${READY.taskId}"`), "the work is still shown");
    assert.ok(page.includes(`data-merge-unavailable="${READY.taskId}"`));
    assert.ok(!page.includes(`data-merge-order="${READY.taskId}"`), "and no button");
  });

  test("refuses an order posted anyway", async () => {
    const response = await fetch(`${panel.url}/api/act/merge-pull-request`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: "not-the-secret" },
      body: JSON.stringify({ taskId: READY.taskId, url: READY.url }),
    });
    assert.equal(response.status, 403, "the acting guard is still in front of it");
  });
});
