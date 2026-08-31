import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { copyFixtures, startPanel, testPort, type Panel } from "./lib/server.ts";

/**
 * What the shipshape lens draws, driven end to end through the built server.
 *
 * The claims here are the ones the lens exists to make: three signals, each
 * with a verdict of its own; a positive finding told apart from a signal that
 * did not read; a cycle that calls itself alive but has gone quiet read as a
 * concern; and - the assertions that matter most - an unreadable signal never
 * implying what it would have said. `panel.test.ts` asserts the frame around
 * it, and `document.test.ts` asserts the document underneath.
 */

/** The rendered page, with React's text-node markers removed. */
async function body(panel: Panel, path = "/"): Promise<string> {
  const response = await fetch(`${panel.url}${path}`);
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** The verdict the lens put on one signal, or null when that signal is absent. */
function verdict(html: string, signal: string): string | null {
  return (
    new RegExp(`data-signal="${signal}" data-read="[a-z]+" data-verdict="([^"]*)"`).exec(html)?.[1] ??
    null
  );
}

/** Whether one signal read at all. */
function read(html: string, signal: string): string | null {
  return new RegExp(`data-signal="${signal}" data-read="([a-z]+)"`).exec(html)?.[1] ?? null;
}

const SIGNALS = ["supervisor", "overdue", "drift"] as const;

/**
 * The instant `document.test.ts` pins: thirty seconds after the fresh sets were
 * generated, inside the sixty-second freshness window.
 */
const NOW = "2099-01-01T09:15:30.000Z";

describe("three signals that read cleanly and found nothing wrong", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    panel = await startPanel({ port: testPort(30), fixtureSet: "healthy", now: NOW });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("draws all three signals, each with a verdict of its own", () => {
    for (const signal of SIGNALS) {
      assert.equal(read(html, signal), "ok", `${signal} should be on screen and read`);
    }
    assert.equal(verdict(html, "supervisor"), "alive");
    assert.equal(verdict(html, "overdue"), "clear");
    assert.equal(verdict(html, "drift"), "clear");
  });

  test("says when the cycle was last seen, and names the threshold it is inside", () => {
    assert.ok(html.includes("Last seen 30s ago"), "the age, not only the verdict");
    assert.ok(html.includes("inside the 10 minutes"), "the threshold, stated in the copy");
  });

  test("states nothing overdue and nothing disagreeing as findings, not silences", () => {
    assert.ok(html.includes("Nothing overdue"));
    assert.ok(html.includes("found nothing waiting longer than it should"));
    assert.ok(html.includes("No disagreement"));
    assert.ok(html.includes("every one of them agrees"));
  });
});

describe("signals that read cleanly and found something", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    panel = await startPanel({
      port: testPort(31),
      fixtureSet: "stale",
      // Long after the reading was taken, pinned so this never races.
      now: "2019-03-05T11:00:00.000Z",
    });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("reads a cycle that is not running as a fault", () => {
    assert.equal(verdict(html, "supervisor"), "stopped");
    assert.ok(html.includes("The cycle is not running"));
  });

  test("names each overdue item and how long it has been waiting", () => {
    assert.equal(verdict(html, "overdue"), "overdue");
    assert.ok(html.includes("1 overdue"));
    assert.ok(html.includes("wi-tidewater-126"));
    assert.ok(html.includes("waiting since"), "the age, from the shared helper");
    assert.ok(!html.includes("Nothing overdue"), "one overdue item is not none");
  });

  test("names each disagreeing record and upstream's line on how", () => {
    assert.equal(verdict(html, "drift"), "disagreeing");
    assert.ok(html.includes("1 disagreeing"));
    assert.ok(html.includes("wi-lamplight-207 is queued here but has a worktree"));
    assert.ok(!html.includes("No disagreement"));
  });

  test("dates the reading itself rather than leaving it undated", () => {
    assert.ok(html.includes("Last good reading, taken"));
  });
});

describe("signals that could not be read", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    // The health file reads; its three signals each report that they did not.
    panel = await startPanel({ port: testPort(32), fixtureSet: "health-unread", now: NOW });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("draws every signal as unread, under a frame that is still current", () => {
    assert.ok(html.includes('data-lens="shipshape" data-lens-status="fresh"'));
    for (const signal of SIGNALS) {
      assert.equal(read(html, signal), "unreadable", `${signal} should be dark`);
      assert.equal(verdict(html, signal), "unreadable");
    }
  });

  test("names what failed and what is therefore unknown", () => {
    assert.ok(html.includes("The wait ledger could not be opened."));
    assert.ok(html.includes("Whether anything has been waiting too long is unknown"));
    assert.ok(html.includes("Whether any record disagrees is unknown"));
    assert.ok(html.includes("Whether the cycle is running"));
  });

  test("implies nothing about what an unread signal would have said", () => {
    // The bug this lens must not grow: a signal that did not read rendering as
    // one that read and found nothing.
    assert.ok(!html.includes("Nothing overdue"), "an unread check is not a clean one");
    assert.ok(!html.includes("No disagreement"), "an unread comparison found nothing");
    assert.ok(!html.includes("Last seen"), "an unread cycle has no last-seen to report");
    for (const claim of ["Alive", "Stopped", "overdue<", "disagreeing<"]) {
      assert.ok(!html.includes(claim), `an unread signal should not claim ${claim}`);
    }
  });
});

describe("the whole lens dark", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    // The health-dark set has no health file at all.
    panel = await startPanel({ port: testPort(33), fixtureSet: "health-dark", now: NOW });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("says it is dark by design rather than drawing a blank area", () => {
    assert.ok(html.includes('data-lens="shipshape" data-lens-status="unreadable"'));
    assert.ok(html.includes("Dark by design, not broken"));
    assert.ok(html.includes("carry no compatibility promise"), "why this lens alone can fail");
    for (const signal of SIGNALS) {
      assert.equal(read(html, signal), "unreadable", `${signal} still has a block`);
    }
  });

  test("leaves fleet and deck untouched beside it", () => {
    assert.ok(html.includes('data-lens="fleet" data-lens-status="fresh"'));
    assert.ok(html.includes('data-lens="deck" data-lens-status="fresh"'));
    assert.equal((html.match(/data-worker="/g) ?? []).length, 3, "the fleet still renders");
  });

  test("claims nothing about the state of the lenses it cannot see", () => {
    // This component is handed document.health and nothing else. Saying the
    // others are fine would be a lie the day both readers fail together.
    assert.ok(!html.includes("Fleet and deck are unaffected"));
    assert.ok(html.includes("carry their own status"), "the separation, not their state");
  });
});

describe("a mixed reading", () => {
  /**
   * Some signals readable and some not, with a cycle that calls itself alive
   * but was last seen four hours ago.
   *
   * Written into a private copy of the fixtures before the panel starts rather
   * than committed: it is one test's material, and the committed sets already
   * cover every combination the rest of the suite needs.
   */
  const MIXED = {
    asOf: "2099-01-01T09:15:00.000Z",
    supervisor: { read: "ok", alive: true, lastSeen: "2099-01-01T05:15:00.000Z" },
    overdue: { read: "unreadable", detail: "The wait ledger could not be opened." },
    drift: {
      read: "ok",
      disagreements: [
        { record: "backlog", detail: "wi-lamplight-207 is queued here but has a worktree" },
      ],
    },
  };

  let panel: Panel;
  let html: string;
  before(async () => {
    const fixtureRoot = await copyFixtures();
    await writeFile(join(fixtureRoot, "healthy", "health.json"), JSON.stringify(MIXED, null, 2));
    panel = await startPanel({
      port: testPort(34),
      fixtureSet: "healthy",
      fixtureRoot,
      now: NOW,
    });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("keeps three verdicts rather than collapsing to one", () => {
    assert.equal(read(html, "supervisor"), "ok");
    assert.equal(read(html, "overdue"), "unreadable");
    assert.equal(read(html, "drift"), "ok");
    assert.equal(verdict(html, "drift"), "disagreeing");
  });

  test("reads a cycle last seen long ago as a concern, not as health", () => {
    assert.equal(verdict(html, "supervisor"), "silent");
    assert.ok(html.includes("Alive but silent"));
    assert.ok(html.includes("quiet for longer than 10 minutes"), "the named threshold");
    assert.ok(html.includes("Last seen 4h ago"));
  });

  test("says nothing about the signal that did not read", () => {
    assert.ok(!html.includes("Nothing overdue"));
    assert.ok(html.includes("Whether anything has been waiting too long is unknown"));
  });

  test("keeps the lens itself current while one signal inside it is dark", () => {
    assert.ok(html.includes('data-lens="shipshape" data-lens-status="fresh"'));
    assert.ok(!html.includes("Dark by design"), "one dark signal is not a dark lens");
  });
});
