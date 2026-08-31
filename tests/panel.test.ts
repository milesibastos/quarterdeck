import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { copyFixtures, startPanel, until, type Panel } from "./lib/server.ts";

/**
 * What the panel renders, driven end to end through the built server.
 *
 * All three lenses draw real content now. What this file asserts for fleet
 * and shipshape is the shell and the envelope - that all three lenses are
 * mounted, and that each reports its own freshness - because what each of
 * them draws is asserted in its own file: `fleet-lens.test.ts` and
 * `shipshape-lens.test.ts`. The deck lens has no file of its own, so
 * `describe("the deck lens", ...)` below asserts what it draws. The document
 * behind them is asserted in `document.test.ts`.
 */

const nextPort = portsFor(import.meta.filename);

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

/** How many worker cards the fleet lens drew. */
function workerCards(html: string): number {
  return (html.match(/data-worker="/g) ?? []).length;
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
    panel = await startPanel({ port: nextPort(), fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  test("mounts every band, each from its own directory", async () => {
    const html = await body(panel);
    assert.ok(html.includes('data-lens="needs-you"'), "the band that owns the first screen");
    assert.ok(html.includes('data-lens="fleet"'));
    assert.ok(html.includes("Queued"), "the deck lens drew its own piles");
    assert.ok(html.includes('data-signal="supervisor"'));
  });

  test("hands each lens the part of the document it reads", async () => {
    const html = await body(panel);
    assert.equal(workerCards(html), 11);
    assert.ok(html.includes("Settle the hold vocabulary"), "a deck item the document carries");
  });

  test("says every lens is current", async () => {
    const html = await body(panel);
    for (const lens of ["needs-you", "fleet", "deck", "shipshape"]) {
      assert.equal(lensStatus(html, lens), "fresh", `${lens} should be current`);
    }
  });
});

describe("the empty fleet", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "empty" });
  });
  after(() => panel.stop());

  test("renders a definitive empty state, not a degraded one", async () => {
    const html = await body(panel);
    assert.equal(workerCards(html), 0);
    assert.ok(html.includes("No workers under way"), "a definitive empty state, in words");
    assert.ok(html.includes("Nothing queued, blocked or held."), "a definitive empty deck");
    assert.equal(lensStatus(html, "fleet"), "fresh", "an empty fleet is not a degraded one");
  });
});

describe("the stale fleet", () => {
  test("renders its lenses and says each one is stale", async () => {
    const panel = await startPanel({
      port: nextPort(),
      fixtureSet: "stale",
      // Long after the snapshot was generated, pinned so this never races.
      now: "2019-03-05T11:00:00.000Z",
    });
    try {
      const html = await body(panel);
      assert.equal(lensStatus(html, "fleet"), "stale");
      assert.equal(lensStatus(html, "deck"), "stale");
      assert.equal(workerCards(html), 2, "stale content is still shown");
      assert.ok(html.includes("freshness window"));
    } finally {
      await panel.stop();
    }
  });

  test("does not call it stale inside the freshness window", async () => {
    const panel = await startPanel({
      port: nextPort(),
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
    panel = await startPanel({ port: nextPort(), fixtureSet: "mismatched" });
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
    const panel = await startPanel({ port: nextPort(), fixtureSet: "health-dark" });
    try {
      const html = await body(panel);
      assert.equal(lensStatus(html, "shipshape"), "unreadable");
      assert.equal(lensStatus(html, "fleet"), "fresh");
      assert.equal(lensStatus(html, "deck"), "fresh");
      assert.equal(workerCards(html), 3, "the fleet lens still renders");
      assert.ok(html.includes("Settle the hold vocabulary"), "the deck lens still renders");
    } finally {
      await panel.stop();
    }
  });

  test("the deck goes dark on its own when upstream could not read the backlog", async () => {
    const panel = await startPanel({ port: nextPort(), fixtureSet: "deck-dark" });
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
      port: nextPort(),
      fixtureSet: "healthy",
      fixtureRoot,
    });
    try {
      assert.equal(workerCards(await body(panel)), 11);

      // Truncate the snapshot under the running panel.
      await writeFile(
        join(fixtureRoot, "healthy", "snapshot.json"),
        '{ "schema": "fm-fleet-snapshot.v1", "generated": "2099-01-01T09:15',
      );

      const html = await until(
        () => body(panel),
        (text) => lensStatus(text, "fleet") === "unreadable",
      );
      assert.equal(lensStatus(html, "deck"), "unreadable");
      assert.equal(workerCards(html), 11, "the fleet is still on screen");
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

describe("the deck lens", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  /** The rows of one pile, in the order the lens drew them. */
  function pile(html: string, name: string): string[] {
    const section = new RegExp(`data-deck-group="${name}"(.*?)</section>`, "s").exec(html)?.[1];
    return [...(section ?? "").matchAll(/data-deck-item="([^"]+)"/g)].map((match) => match[1]);
  }

  test("sorts what is queued, blocked and held into piles of their own", async () => {
    const html = await body(panel);
    // The two decisions held for a person are drawn by the band above and are
    // deliberately not here; what is left in this pile waits on something that
    // is not a person, and nobody can answer it. See tests/needs-you.test.ts.
    assert.deepEqual(pile(html, "held"), ["wi-brackish-277"]);
    assert.deepEqual(pile(html, "queued"), ["wi-lamplight-231", "wi-cordage-412"]);
    assert.deepEqual(pile(html, "in-flight"), ["wi-saltmarsh-318"]);
  });

  test("a held item names who it waits on, why, and when it was deferred to", async () => {
    const html = await body(panel);
    assert.ok(html.includes("Waiting on "));
    assert.ok(html.includes("captain"), "who it waits on");
    assert.ok(html.includes("Needs a naming decision"), "upstream's own words for why");
    assert.ok(html.includes("deferred until "), "a deferral is a date, not an age");
    assert.ok(html.includes("2099-01-04"));
  });

  /** One row's visible words, tags and React's SSR comments taken out. */
  function rowText(html: string, id: string): string {
    const row = new RegExp(`data-deck-item="${id}"(.*?)</li>`, "s").exec(html)?.[1] ?? "";
    return row
      .replace(/<!--.*?-->/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  test("a row says what project it belongs to and whether it is research", async () => {
    const html = await body(panel);
    // Enough identity to recognise a piece of work by: two rows with similar
    // titles are different jobs, and the project is what tells them apart.
    assert.ok(rowText(html, "wi-tidewater-126").includes("tidewater \u00b7 research"));
    assert.ok(rowText(html, "wi-lamplight-231").includes("lamplight \u00b7 build"));
    // A kind nobody recognised is building, and still has its project.
    assert.ok(rowText(html, "wi-driftwood-540").includes("driftwood \u00b7 build"));
  });

  test("a row that named neither project nor kind invents neither", async () => {
    const text = rowText(await body(panel), "wi-brackish-277");
    assert.ok(text.length > 0, "the row is on screen");
    assert.ok(
      text.includes("queued \u00b7 wi-brackish-277"),
      "the state runs straight into the id, with nothing guessed in between",
    );
    assert.ok(!text.includes("build") && !text.includes("research"), "no kind is claimed");
  });

  test("a row with no start date is not dated anyway", async () => {
    const text = rowText(await body(panel), "wi-brackish-277");
    assert.ok(text.includes("no start date"), "the absence, said in words");
    assert.ok(!/\d+[smhdy] ago/.test(text), "and no age invented from the moment we read");
    assert.ok(!text.includes("just now"), "nor the read's own moment dressed as an arrival");
  });

  test("a blocker that has landed does not keep an item looking blocked", async () => {
    const html = await body(panel);
    // wi-cordage-401 is in the fleet and landed, so the item it blocked is
    // queued rather than blocked, and says what cleared.
    assert.deepEqual(pile(html, "blocked"), []);
    assert.ok(html.includes("wi-cordage-401 landed; no longer blocking"));
  });

  test("a blocker it cannot settle still blocks, named by its identity", async () => {
    // The same deck with no fleet beside it: nothing can say the blocker
    // finished, so the honest answer is that the item is still blocked.
    const alone = await startPanel({ port: nextPort(), fixtureSet: "deck-only" });
    try {
      const html = await body(alone);
      assert.deepEqual(pile(html, "blocked"), ["wi-cordage-412"]);
      assert.ok(html.includes("Blocked by"));
      assert.ok(html.includes("wi-cordage-401"), "names the work it waits on");
      assert.ok(html.includes("Waits on the seam landing first"), "and upstream's reason");
    } finally {
      await alone.stop();
    }
  });

  test("says a deck it could not read is unknown, not empty", async () => {
    const dark = await startPanel({ port: nextPort(), fixtureSet: "deck-dark" });
    try {
      const html = await body(dark);
      assert.ok(html.includes("the deck could not be read"));
      assert.ok(!html.includes("Nothing queued, blocked or held."), "not a definitive empty deck");
    } finally {
      await dark.stop();
    }
  });
});
