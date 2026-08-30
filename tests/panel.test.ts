import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { copyFixtures, startPanel, testPort, until, type Panel } from "./lib/server.ts";

/**
 * What the panel renders, driven end to end through the built server.
 *
 * Every degraded state the design promises has a fixture, and every fixture has
 * a test here: a skeleton that only proved the happy path would say nothing
 * about the behaviour the whole design is built around.
 */

/**
 * The rendered page, with React's text-node markers removed.
 *
 * React splits adjacent text with `<!-- -->` so it can find the boundaries
 * again when it hydrates, which turns "6 workers" into "6<!-- --> <!-- -->
 * workers". Dropping the markers lets a test assert what a reader sees.
 */
async function body(panel: Panel, path = "/"): Promise<string> {
  const response = await fetch(`${panel.url}${path}`);
  return (await response.text()).replaceAll("<!-- -->", "");
}

describe("the healthy fleet", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: testPort(1), fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  test("server-renders every worker with its state", async () => {
    const html = await body(panel);
    for (const id of [
      "wk-tidewater-01",
      "wk-tidewater-02",
      "wk-lamplight-01",
      "wk-lamplight-02",
      "wk-saltmarsh-01",
      "wk-saltmarsh-02",
    ]) {
      assert.ok(html.includes(id), `${id} missing from the rendered page`);
    }
    for (const state of ["Running", "Held", "Queued", "Finished", "Failed", "Idle"]) {
      assert.ok(html.includes(`>${state}<`), `no worker rendered as ${state}`);
    }
    assert.ok(html.includes("6 workers"));
  });

  test("says nothing is degraded", async () => {
    assert.ok(!(await body(panel)).includes("data-degraded"));
  });
});

describe("the empty fleet", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: testPort(2), fixtureSet: "empty" });
  });
  after(() => panel.stop());

  test("renders a definitive empty state, not a blank area", async () => {
    const html = await body(panel);
    assert.ok(html.includes("No workers on deck"));
    assert.ok(html.includes("reported nothing running"));
    assert.ok(!html.includes("data-degraded"), "an empty fleet is not a degraded one");
  });
});

describe("the stale fleet", () => {
  test("renders its workers and says it is stale", async () => {
    const panel = await startPanel({
      port: testPort(3),
      fixtureSet: "stale",
      // Long after the snapshot was generated, pinned so this never races.
      now: "2019-03-05T11:00:00.000Z",
    });
    try {
      const html = await body(panel);
      assert.ok(html.includes("wk-tidewater-01"), "last known good is still shown");
      assert.ok(html.includes('data-degraded="stale-snapshot"'));
      assert.ok(html.includes("Showing a stale snapshot"));
      assert.ok(html.includes("freshness window"));
    } finally {
      await panel.stop();
    }
  });

  test("does not call it stale inside the freshness window", async () => {
    const panel = await startPanel({
      port: testPort(4),
      fixtureSet: "stale",
      // Thirty seconds after it was generated, inside the sixty-second window.
      now: "2019-03-04T11:00:30.000Z",
    });
    try {
      assert.ok(!(await body(panel)).includes("data-degraded"));
    } finally {
      await panel.stop();
    }
  });
});

describe("a snapshot this build does not understand", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: testPort(5), fixtureSet: "mismatched" });
  });
  after(() => panel.stop());

  test("refuses loudly, naming both identifiers", async () => {
    const html = await body(panel);
    assert.ok(html.includes("Snapshot refused"));
    assert.ok(html.includes("fm-fleet-snapshot.v1"), "names what it expected");
    assert.ok(html.includes("fm-fleet-snapshot.v2"), "names what it found");
    assert.ok(html.includes("fixture:mismatched"), "names the source");
  });

  test("renders no part of the fleet", async () => {
    const html = await body(panel);
    assert.ok(!html.includes("wk-tidewater-01"), "a refused snapshot renders nothing");
  });
});

describe("a snapshot that stops parsing", () => {
  test("keeps showing the last one that read cleanly", async () => {
    const fixtureRoot = await copyFixtures();
    const panel = await startPanel({
      port: testPort(6),
      fixtureSet: "healthy",
      fixtureRoot,
    });
    try {
      assert.ok((await body(panel)).includes("wk-tidewater-01"));

      // Truncate the snapshot under the running panel.
      await writeFile(
        join(fixtureRoot, "healthy", "snapshot.json"),
        '{ "schema": "fm-fleet-snapshot.v1", "generatedAt": "2099-01-01T09:15',
      );

      const html = await until(
        () => body(panel),
        (text) => text.includes("data-degraded"),
      );
      assert.ok(html.includes('data-degraded="read-failed"'));
      assert.ok(html.includes("Showing the last snapshot that read cleanly"));
      assert.ok(html.includes("wk-tidewater-01"), "the fleet is still on screen");
    } finally {
      await panel.stop();
    }
  });
});
