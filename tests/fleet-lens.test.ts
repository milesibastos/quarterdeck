import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { copyFixtures, startPanel, testPort, until, type Panel } from "./lib/server.ts";

/**
 * What the fleet lens draws, driven end to end through the built server.
 *
 * The claims here are the ones the lens exists to make: every stage renders and
 * is told apart without reading, the step inside validation is on the card, a
 * worker that stopped says where and why, and a lens that cannot be trusted
 * says so instead of going blank. `panel.test.ts` asserts the shell around it.
 */

/** The rendered page, with React's text-node markers removed. */
async function body(panel: Panel, path = "/"): Promise<string> {
  const response = await fetch(`${panel.url}${path}`);
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** One worker's card element, opening tag only, or null when it is absent. */
function card(html: string, id: string): string | null {
  return new RegExp(`<div[^>]*data-worker="${id}"[^>]*>`).exec(html)?.[0] ?? null;
}

function attribute(tag: string, name: string): string | null {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

/** Every stage the fleet-only set puts on screen: the whole vocabulary. */
const EVERY_STAGE = [
  "dispatched",
  "working",
  "validating",
  "pr-open",
  "in-review",
  "landed",
  "blocked",
  "held",
  "waiting",
  "failed",
] as const;

describe("the lifecycle rail", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    panel = await startPanel({ port: testPort(20), fixtureSet: "fleet-only" });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("draws every coarse stage and every off-track state", () => {
    for (const stage of EVERY_STAGE) {
      assert.ok(html.includes(`data-stage="${stage}"`), `${stage} should be on screen`);
    }
  });

  test("tells the four off-track states apart without a word being read", () => {
    // Held wants a person, waiting wants nothing from anybody, blocked wants
    // another work item, and only failed is a fault. One colour for all four
    // would hide the only one that is an alarm.
    const accents = new Set(
      ["wi-cordage-404", "wi-tidewater-121", "wi-lamplight-215", "wi-saltmarsh-309"].map((id) => {
        const tag = card(html, id);
        assert.ok(tag, `${id} should be on screen`);
        return /border-l-[a-z]+/.exec(attribute(tag, "class") ?? "")?.[0];
      }),
    );
    assert.equal(accents.size, 4, "four off-track states, four tones");
  });

  test("names the pipeline step a validating worker is on", () => {
    assert.equal(attribute(card(html, "wi-lamplight-211") ?? "", "data-step"), "test");
    assert.ok(
      html.includes("Validating · tests, step 4 of 9"),
      "the step, and how far into the run it is",
    );
  });

  test("says only what it knows when validation names no step", () => {
    assert.equal(attribute(card(html, "wi-lamplight-207") ?? "", "data-step"), "none");
  });

  test("an off-track worker shows the stage it stopped in and why", () => {
    const tag = card(html, "wi-tidewater-121");
    assert.equal(attribute(tag ?? "", "data-stage"), "held");
    // The stage it left the track in, inferred from the step it named, and
    // upstream's own words for why it stopped.
    assert.ok(html.includes("Held in validation · code review, step 3 of 9"));
    assert.ok(html.includes("parked at review: 1 finding(s) (ask-user: authority decision)"));
  });

  test("claims no stage for a worker that stopped without naming a step", () => {
    assert.equal(attribute(card(html, "wi-cordage-404") ?? "", "data-step"), "none");
    assert.ok(html.includes("blocked on wi-cordage-401"), "the reason is still there");
    assert.ok(!html.includes("Blocked in validation"), "the document does not say that");
  });

  test("draws a pointer that stopped resolving as broken", () => {
    // The failed worker's worktree has been swept up; a working-looking path
    // would send the operator looking for something that is not there.
    assert.ok(html.includes("line-through"));
    assert.ok(html.includes("gone"));
  });

  test("keeps the instructions available without shouting them", () => {
    assert.ok(html.includes("dispatched with"));
    assert.ok(html.includes("/anchorage/briefs/wi-tidewater-114.md"));
    assert.ok(html.includes("<details"), "one disclosure, closed until asked");
  });

  test("says what a pull request is doing, and that its checks are unknown", () => {
    assert.ok(html.includes("pull request open"));
    assert.ok(html.includes("pull request landed"));
    assert.ok(html.includes("checks unknown"));
  });
});

describe("a fleet that cannot be trusted", () => {
  test("shows the last good picture with its age when the read went stale", async () => {
    const panel = await startPanel({
      port: testPort(21),
      fixtureSet: "stale",
      // Long after the snapshot was generated, pinned so this never races.
      now: "2019-03-05T11:00:00.000Z",
    });
    try {
      const html = await body(panel);
      assert.ok(html.includes("Last good picture, taken"), "the age, not just the policy");
      assert.equal((html.match(/data-worker="/g) ?? []).length, 2, "and the picture itself");
    } finally {
      await panel.stop();
    }
  });

  test("says the read failed rather than dating the content from it", async () => {
    const fixtureRoot = await copyFixtures();
    const panel = await startPanel({ port: testPort(22), fixtureSet: "healthy", fixtureRoot });
    try {
      await body(panel);
      await writeFile(
        join(fixtureRoot, "healthy", "snapshot.json"),
        '{ "schema": "fm-fleet-snapshot.v1", "generated_at": "2099-01-01T09:15',
      );
      const html = await until(
        () => body(panel),
        (text) => text.includes("Last good picture, still on screen"),
      );
      assert.equal((html.match(/data-worker="/g) ?? []).length, 11, "the fleet is still there");
    } finally {
      await panel.stop();
    }
  });

  test("says there is nothing to show when a failed read has nothing behind it", async () => {
    // The malformed set never parses, so there is no earlier picture to keep.
    const panel = await startPanel({ port: testPort(23), fixtureSet: "malformed" });
    try {
      const html = await body(panel);
      assert.ok(html.includes("Nothing to show"));
      assert.ok(!html.includes("No workers under way"), "an unread fleet is not an empty one");
    } finally {
      await panel.stop();
    }
  });

  test("shows the last good picture's age even when that picture is empty", async () => {
    const panel = await startPanel({
      port: testPort(24),
      fixtureSet: "fleet-empty-stale",
      // Long after the snapshot was generated, pinned so this never races.
      now: "2019-03-05T11:00:00.000Z",
    });
    try {
      const html = await body(panel);
      assert.ok(html.includes("Last good picture, taken"), "a stale empty fleet still ages");
      assert.ok(html.includes("No workers under way"));
      assert.ok(!html.includes("read cleanly"), "a stale read is not a clean one");
    } finally {
      await panel.stop();
    }
  });
});
