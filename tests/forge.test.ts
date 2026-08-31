import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FleetSnapshot, SnapshotTask } from "../src/adapters/contract.ts";
import { ghForge, type ForgeReading } from "../src/adapters/forge.ts";
import { ForgeCache, FORGE_MIN_INTERVAL_MS } from "../src/runtime/forge.ts";
import type { Clock } from "../src/providers/clock.ts";
import type { Logger } from "../src/providers/logger.ts";
import type { Runner } from "../src/providers/process.ts";
import { CommandError } from "../src/providers/process.ts";

/**
 * Reading the forge: the cost rule, and what comes back.
 *
 * The claims here are the ones acceptance turns on, and every one of them is
 * checked rather than asserted in a comment: nothing is read unless somebody
 * opted in, nothing is read twice inside a minute, a read that failed is
 * rate-limited exactly like one that succeeded, and a pull request nothing has
 * looked at keeps saying so instead of being filled with a guess.
 *
 * Driven against a stub runner and a clock this file moves by hand, so none of
 * it touches a network and none of it waits for real time to pass.
 * `tests/real-forge.test.ts` has no counterpart: what a stub cannot prove -
 * that the panel really starts `gh` - is proved end to end in
 * `tests/fleet-lens.test.ts`, against a `gh` on the path that is a shell
 * script.
 */

/** A clock the test moves. Staleness elsewhere pins one; this one advances. */
function movableClock(startMs: number): Clock & { advance(ms: number): void } {
  let nowMs = startMs;
  return {
    now: () => new Date(nowMs).toISOString(),
    nowMs: () => nowMs,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** A runner that answers with canned output and records what it was asked. */
function stubRunner(answer: (url: string) => string | Error): Runner & {
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    run(command: string, args: readonly string[]) {
      const url = args.find((arg) => arg.startsWith("url="))?.slice("url=".length) ?? "";
      calls.push(`${command} ${url}`);
      const result = answer(url);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
}

/** One task with a pull request and whatever forge blocks the caller wants. */
function taskWith(id: string, pr: SnapshotTask["pr"]): SnapshotTask {
  return {
    id,
    project: "/anchorage/projects/northreach",
    kind: "ship",
    harness: null,
    mode: null,
    branch: null,
    model: null,
    effort: null,
    brief: { summary: null, text: null },
    paths: {
      meta: { path: "/anchorage/state/task.meta", present: true },
      worktree: { path: "/anchorage/worktrees/task", present: true },
    },
    current_state: {
      state: "pr_open",
      detail: "pull request opened",
      observed_at: "2099-01-01T09:15:00.000Z",
    },
    pr,
    completion: null,
  };
}

function snapshotOf(tasks: readonly SnapshotTask[]): FleetSnapshot {
  return {
    schema: "fm-fleet-snapshot.v1",
    generated: "2099-01-01T09:15:00.000Z",
    fm_home: null,
    tasks,
    backlog: { present: true, records: [] },
    secondmate_landed: {
      records: [],
      truncated: [],
      unreadable: [],
      partial: [],
    },
  };
}

const A_URL = "https://forge.invalid/northreach/pull/1";
const B_URL = "https://forge.invalid/northreach/pull/2";

/** A pull request upstream published no forge reading for: the ordinary case. */
const UNREAD = { url: A_URL, checks: null, review: null } as const;

function cacheOn(
  read: (url: string) => Promise<ForgeReading>,
  clock: Clock,
): ForgeCache {
  return new ForgeCache({ read, clock, logger: quiet, readTimeoutMs: 5_000 });
}

const A_READING: ForgeReading = {
  checks: {
    read: "ok",
    outcome: "passing",
    finished: 3,
    total: 3,
    as_of: "2099-01-01T09:16:00.000Z",
  },
  review: { read: "ok", comments: 0, as_of: "2099-01-01T09:16:00.000Z" },
};

/** Lets a test wait for the scheduled batch without knowing how it is queued. */
function published(): { promise: Promise<void>; onRead: () => void } {
  let settle: () => void;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, onRead: () => settle() };
}

describe("the cost rule", () => {
  test("reads nothing at all until something asks it to", async () => {
    const calls: string[] = [];
    const cache = cacheOn(async (url) => {
      calls.push(url);
      return A_READING;
    }, movableClock(0));

    // The rule the whole feature turns on: applying is free and reading is not,
    // so a render that only applies must cost no network call.
    const snapshot = snapshotOf([taskWith("wi-northreach-1", UNREAD)]);
    assert.deepEqual(cache.applyTo(snapshot), snapshot);
    assert.deepEqual(calls, [], "applying the cache asks the forge nothing");
  });

  test("a pull request nothing has read keeps saying nobody has read it", () => {
    const cache = cacheOn(async () => A_READING, movableClock(0));
    const applied = cache.applyTo(snapshotOf([taskWith("wi-northreach-1", UNREAD)]));
    // Absent, which the projection reports as `not-looked-up`. Filling it with
    // anything else here would be the panel answering a question nobody asked.
    assert.equal(applied.tasks[0].pr.checks, null);
    assert.equal(applied.tasks[0].pr.review, null);
  });

  test("asks once for a pull request, however many renders go past", async () => {
    const clock = movableClock(0);
    const calls: string[] = [];
    const cache = cacheOn(async (url) => {
      calls.push(url);
      return A_READING;
    }, clock);
    const snapshot = snapshotOf([taskWith("wi-northreach-1", UNREAD)]);

    const first = published();
    cache.refresh(snapshot, first.onRead);
    // Two more renders in the same instant, which is what a burst of filesystem
    // events looks like from here.
    cache.refresh(snapshot, () => {});
    cache.refresh(snapshot, () => {});
    await first.promise;

    assert.deepEqual(calls, [A_URL], "one read between three renders");
  });

  test("does not ask again inside the minute, and does after it", async () => {
    const clock = movableClock(0);
    const calls: string[] = [];
    const cache = cacheOn(async (url) => {
      calls.push(url);
      return A_READING;
    }, clock);
    const snapshot = snapshotOf([taskWith("wi-northreach-1", UNREAD)]);

    const first = published();
    cache.refresh(snapshot, first.onRead);
    await first.promise;

    clock.advance(FORGE_MIN_INTERVAL_MS - 1);
    cache.refresh(snapshot, () => {});
    assert.equal(calls.length, 1, "a second before the floor expires, still one");

    clock.advance(1);
    const second = published();
    cache.refresh(snapshot, second.onRead);
    await second.promise;
    assert.equal(calls.length, 2, "and the moment it expires, one more");
  });

  test("rate-limits a forge that is refusing exactly like one that answers", async () => {
    const clock = movableClock(0);
    let calls = 0;
    const cache = cacheOn(async () => {
      calls += 1;
      return {
        checks: { read: "unreadable", detail: "the forge refused" },
        review: { read: "unreadable", detail: "the forge refused" },
      };
    }, clock);
    const snapshot = snapshotOf([taskWith("wi-northreach-1", UNREAD)]);

    const first = published();
    cache.refresh(snapshot, first.onRead);
    await first.promise;
    // The failure mode this exists to stop: a forge that is down turning every
    // render into another call to it. The floor is stamped when a read is
    // scheduled, so it applies whatever the read came back with.
    for (let i = 0; i < 5; i++) cache.refresh(snapshot, () => {});
    assert.equal(calls, 1, "a refusing forge is asked once a minute, like any other");
  });

  test("asks once for a pull request two workers share", async () => {
    const clock = movableClock(0);
    const calls: string[] = [];
    const cache = cacheOn(async (url) => {
      calls.push(url);
      return A_READING;
    }, clock);

    const done = published();
    cache.refresh(
      snapshotOf([
        taskWith("wi-northreach-1", UNREAD),
        taskWith("wi-northreach-2", UNREAD),
        taskWith("wi-northreach-3", { url: B_URL, checks: null, review: null }),
      ]),
      done.onRead,
    );
    await done.promise;
    assert.deepEqual(calls, [A_URL, B_URL], "one call per address, not per worker");
  });

  test("never asks about a worker with no pull request", async () => {
    const clock = movableClock(0);
    const calls: string[] = [];
    const cache = cacheOn(async (url) => {
      calls.push(url);
      return A_READING;
    }, clock);

    cache.refresh(
      snapshotOf([taskWith("wi-northreach-1", { url: null, checks: null, review: null })]),
      () => {},
    );
    assert.deepEqual(calls, [], "there is nothing to ask about");
  });
});

describe("what a read puts on the snapshot", () => {
  test("fills the blocks upstream left out, and publishes the change", async () => {
    const clock = movableClock(0);
    const cache = cacheOn(async () => A_READING, clock);
    const snapshot = snapshotOf([taskWith("wi-northreach-1", UNREAD)]);

    const done = published();
    cache.refresh(snapshot, done.onRead);
    await done.promise;

    const applied = cache.applyTo(snapshot);
    assert.deepEqual(applied.tasks[0].pr.checks, A_READING.checks);
    assert.deepEqual(applied.tasks[0].pr.review, A_READING.review);
    // The snapshot it was handed is untouched: the projection is fed a copy.
    assert.equal(snapshot.tasks[0].pr.checks, null);
  });

  test("never overwrites a reading upstream published itself", async () => {
    const clock = movableClock(0);
    const cache = cacheOn(async () => A_READING, clock);
    const upstream = {
      read: "ok",
      outcome: "failing",
      finished: 9,
      total: 9,
      as_of: "2099-01-01T09:10:00.000Z",
    } as const;
    const snapshot = snapshotOf([
      taskWith("wi-northreach-1", { url: A_URL, checks: upstream, review: null }),
    ]);

    const done = published();
    cache.refresh(snapshot, done.onRead);
    await done.promise;

    const applied = cache.applyTo(snapshot);
    // A fleet that grew its own forge reading is closer to the work than this
    // panel is, and costs the panel nothing. Its answer wins.
    assert.deepEqual(applied.tasks[0].pr.checks, upstream);
    assert.deepEqual(applied.tasks[0].pr.review, A_READING.review);
  });
});

describe("what the forge is asked, and what is made of the answer", () => {
  const clock = movableClock(Date.parse("2099-01-01T09:16:00.000Z"));

  function forgeOn(answer: (url: string) => string | Error) {
    const runner = stubRunner(answer);
    return { runner, read: ghForge(runner, clock, { PATH: "/usr/bin" }) };
  }

  /** What the forge's own answer looks like, in the shape the query asks for. */
  function forgeAnswer(pullRequest: unknown): string {
    return JSON.stringify({ data: { resource: pullRequest } });
  }

  function rollup(state: string, contexts: unknown[], totalCount = contexts.length) {
    return {
      __typename: "PullRequest",
      comments: { totalCount: 0, nodes: [] },
      reviews: { totalCount: 0, nodes: [] },
      commits: {
        nodes: [{ commit: { statusCheckRollup: { state, contexts: { totalCount, nodes: contexts } } } }],
      },
    };
  }

  test("asks one question, by the pull request's own address", async () => {
    const { runner, read } = forgeOn(() => forgeAnswer(rollup("SUCCESS", [])));
    await read(A_URL, AbortSignal.timeout(1_000));
    // One call for both halves, and the address passed through whole - nothing
    // here takes a forge URL apart into an owner, a repository and a number.
    assert.deepEqual(runner.calls, [`gh ${A_URL}`]);
  });

  test("a failing rollup with checks still running reports only what actually finished", async () => {
    const { read } = forgeOn(() =>
      forgeAnswer(
        rollup("FAILURE", [
          { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
          { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null },
          { __typename: "StatusContext", state: "PENDING" },
        ]),
      ),
    );
    const reading = await read(A_URL, AbortSignal.timeout(1_000));
    // A fast failure does not mean the rest reported too: the outcome word
    // comes from the rollup, but the count comes from the checks themselves.
    assert.deepEqual(reading.checks, {
      read: "ok",
      outcome: "failing",
      finished: 1,
      total: 3,
      as_of: "2099-01-01T09:16:00.000Z",
    });
  });

  test("a rollup whose checks cannot all be listed is unreadable, not a guessed count", async () => {
    const { read } = forgeOn(() =>
      forgeAnswer(
        rollup(
          "FAILURE",
          [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
          127,
        ),
      ),
    );
    const reading = await read(A_URL, AbortSignal.timeout(1_000));
    // The forge only ever lists a page of contexts; past that bound there is no
    // way to say how many of the rest finished, so this must not claim a count.
    assert.equal(reading.checks.read, "unreadable");
  });

  test("counts how far a pending run has got", async () => {
    const { read } = forgeOn(() =>
      forgeAnswer(
        rollup("PENDING", [
          { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
          { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null },
          { __typename: "StatusContext", state: "PENDING" },
        ]),
      ),
    );
    const reading = await read(A_URL, AbortSignal.timeout(1_000));
    assert.equal(reading.checks.read === "ok" && reading.checks.finished, 1);
    assert.equal(reading.checks.read === "ok" && reading.checks.total, 3);
    assert.equal(reading.checks.read === "ok" && reading.checks.outcome, "pending");
  });

  test("a pull request with no checks is answered, not left unread", async () => {
    const { read } = forgeOn(() =>
      forgeAnswer({
        __typename: "PullRequest",
        comments: { totalCount: 0, nodes: [] },
        reviews: { totalCount: 0, nodes: [] },
        commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
      }),
    );
    const reading = await read(A_URL, AbortSignal.timeout(1_000));
    // The forge said "there is nothing to run here", which is a reading. The
    // card branches on the count, so it says so in words rather than as 0 of 0.
    assert.equal(reading.checks.read, "ok");
    assert.equal(reading.checks.read === "ok" && reading.checks.total, 0);
  });

  test("counts comments a person left, and not a bot's", async () => {
    const { read } = forgeOn(() =>
      forgeAnswer({
        __typename: "PullRequest",
        comments: {
          totalCount: 3,
          nodes: [
            { author: { __typename: "User" } },
            { author: { __typename: "Bot" } },
            { author: { __typename: "Bot" } },
          ],
        },
        reviews: {
          totalCount: 2,
          nodes: [
            { author: { __typename: "User" }, body: "one test addition would help" },
            // An approval with no words is a person having read it, which is a
            // different fact from their having said something.
            { author: { __typename: "User" }, body: "" },
          ],
        },
        commits: { nodes: [] },
      }),
    );
    const reading = await read(A_URL, AbortSignal.timeout(1_000));
    assert.deepEqual(reading.review, {
      read: "ok",
      comments: 2,
      as_of: "2099-01-01T09:16:00.000Z",
    });
  });

  test("a forge that answered and found nobody says zero, not nothing", async () => {
    const { read } = forgeOn(() => forgeAnswer(rollup("SUCCESS", [])));
    const reading = await read(A_URL, AbortSignal.timeout(1_000));
    // The distinction the whole three-armed signal exists for: this is a read
    // that happened, so it must never come back as `not-looked-up`.
    assert.deepEqual(reading.review, {
      read: "ok",
      comments: 0,
      as_of: "2099-01-01T09:16:00.000Z",
    });
  });

  test("a forge that could not be reached is unreadable, never unasked", async () => {
    const { read } = forgeOn(() => new CommandError("gh", 4, "not authenticated", "failed"));
    const reading = await read(A_URL, AbortSignal.timeout(1_000));
    assert.equal(reading.checks.read, "unreadable");
    assert.equal(reading.review.read, "unreadable");
    assert.ok(
      reading.checks.read === "unreadable" && reading.checks.detail.includes("not authenticated"),
      "the line an operator can act on, not a bare failure",
    );
  });

  test("an address the forge does not answer for is unreadable, and does not throw", async () => {
    const { read } = forgeOn(() => forgeAnswer(null));
    const reading = await read(A_URL, AbortSignal.timeout(1_000));
    assert.equal(reading.checks.read, "unreadable");
    assert.ok(reading.review.read === "unreadable" && reading.review.detail.includes(A_URL));
  });

  test("an address that resolves to something other than a pull request is unreadable", async () => {
    const { read } = forgeOn(() => forgeAnswer({ __typename: "Issue" }));
    const reading = await read(A_URL, AbortSignal.timeout(1_000));
    // An issue, a discussion, a commit - all share `resource(url:)`'s type and
    // come back as a non-null object with none of the pull request's fields.
    assert.equal(reading.checks.read, "unreadable");
    assert.equal(reading.review.read, "unreadable");
  });

  test("output that is not JSON is unreadable, and does not throw", async () => {
    const { read } = forgeOn(() => "gh: command not found");
    const reading = await read(A_URL, AbortSignal.timeout(1_000));
    assert.equal(reading.checks.read, "unreadable");
  });
});
