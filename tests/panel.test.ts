import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { copyFixtures, startPanel, testPort, until, type Panel } from "./lib/server.ts";

/**
 * What the panel renders, driven end to end through the built server.
 *
 * The three lenses are placeholders - what they draw is later work by other
 * hands - so what this file asserts is the shell and the envelope: that all
 * three lenses are mounted, and that each reports its own freshness. The
 * document behind them is asserted in `document.test.ts`.
 */

/**
 * The rendered page, with React's text-node markers removed.
 *
 * React splits adjacent text with `<!-- -->` so it can find the boundaries
 * again when it hydrates. Dropping the markers lets a test assert what a
 * reader sees.
 */
async function body(panel: Panel, path = "/"): Promise<string> {
  const response = await fetch(`${panel.url}${path}`);
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** The status the shell put on one lens, or null when that lens is absent. */
function lensStatus(html: string, name: string): string | null {
  return (
    new RegExp(`data-lens="${name}" data-lens-status="([a-z]+)"`).exec(html)?.[1] ?? null
  );
}

describe("the healthy fleet", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: testPort(1), fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  test("mounts all three lenses, each from its own directory", async () => {
    const html = await body(panel);
    assert.ok(html.includes("The fleet lens is not built yet"));
    assert.ok(html.includes("The deck lens is not built yet"));
    assert.ok(html.includes("The shipshape lens is not built yet"));
  });

  test("hands each lens the part of the document it reads", async () => {
    const html = await body(panel);
    assert.ok(html.includes("11 workers in the document"));
    assert.ok(html.includes("4 items in the document"));
  });

  test("says every lens is current", async () => {
    const html = await body(panel);
    for (const lens of ["fleet", "deck", "shipshape"]) {
      assert.equal(lensStatus(html, lens), "fresh", `${lens} should be current`);
    }
  });
});

describe("the empty fleet", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: testPort(2), fixtureSet: "empty" });
  });
  after(() => panel.stop());

  test("renders a definitive empty state, not a degraded one", async () => {
    const html = await body(panel);
    assert.ok(html.includes("0 workers in the document"));
    assert.ok(html.includes("0 items in the document"));
    assert.equal(lensStatus(html, "fleet"), "fresh", "an empty fleet is not a degraded one");
  });
});

describe("the stale fleet", () => {
  test("renders its lenses and says each one is stale", async () => {
    const panel = await startPanel({
      port: testPort(3),
      fixtureSet: "stale",
      // Long after the snapshot was generated, pinned so this never races.
      now: "2019-03-05T11:00:00.000Z",
    });
    try {
      const html = await body(panel);
      assert.equal(lensStatus(html, "fleet"), "stale");
      assert.equal(lensStatus(html, "deck"), "stale");
      assert.ok(html.includes("2 workers in the document"), "stale content is still shown");
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
      assert.equal(lensStatus(await body(panel), "fleet"), "fresh");
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

  test("renders no lens at all", async () => {
    const html = await body(panel);
    for (const lens of ["fleet", "deck", "shipshape"]) {
      assert.equal(lensStatus(html, lens), null, "a refused snapshot renders nothing");
    }
  });
});

describe("per-lens degradation", () => {
  test("shipshape goes dark while fleet and deck render normally", async () => {
    // The health-dark set has no health file at all: the quarantined module
    // degrades rather than throwing, and only its own lens notices.
    const panel = await startPanel({ port: testPort(10), fixtureSet: "health-dark" });
    try {
      const html = await body(panel);
      assert.equal(lensStatus(html, "shipshape"), "unreadable");
      assert.equal(lensStatus(html, "fleet"), "fresh");
      assert.equal(lensStatus(html, "deck"), "fresh");
      assert.ok(html.includes("3 workers in the document"), "the fleet lens still renders");
      assert.ok(html.includes("3 items in the document"), "the deck lens still renders");
    } finally {
      await panel.stop();
    }
  });

  test("the deck goes dark on its own when upstream could not read the backlog", async () => {
    const panel = await startPanel({ port: testPort(11), fixtureSet: "deck-dark" });
    try {
      const html = await body(panel);
      assert.equal(lensStatus(html, "deck"), "unreadable");
      assert.equal(lensStatus(html, "fleet"), "fresh");
      assert.equal(lensStatus(html, "shipshape"), "fresh");
    } finally {
      await panel.stop();
    }
  });
});

describe("a snapshot that stops parsing", () => {
  test("keeps showing the last fleet and deck that read cleanly", async () => {
    const fixtureRoot = await copyFixtures();
    const panel = await startPanel({
      port: testPort(6),
      fixtureSet: "healthy",
      fixtureRoot,
    });
    try {
      assert.ok((await body(panel)).includes("11 workers in the document"));

      // Truncate the snapshot under the running panel.
      await writeFile(
        join(fixtureRoot, "healthy", "snapshot.json"),
        '{ "schema": "fm-fleet-snapshot.v1", "generated_at": "2099-01-01T09:15',
      );

      const html = await until(
        () => body(panel),
        (text) => lensStatus(text, "fleet") === "unreadable",
      );
      assert.equal(lensStatus(html, "deck"), "unreadable");
      assert.ok(html.includes("11 workers in the document"), "the fleet is still on screen");
      assert.equal(
        lensStatus(html, "shipshape"),
        "fresh",
        "health is read separately and is unaffected",
      );
    } finally {
      await panel.stop();
    }
  });
});
