import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { copyFixtures, startPanel, until, type Panel } from "./lib/server.ts";

/**
 * The band that owns the first screen.
 *
 * The defect this band exists to prevent is an undercount nobody notices: a
 * prior board showed ten open decisions against sixteen real, and the zone was
 * sized to look balanced rather than to make the gap obvious. So the tests here
 * are about three things and nothing else - that the count is derived from the
 * deck the document carries, that no deck row can be drawn by neither the band
 * nor the deck, and that an emptiness which might be ignorance says so.
 *
 * The height rule the band is sized by is a stylesheet fact and lives in
 * `tests/width.test.ts` with the rest of the layout mechanics.
 */

const nextPort = portsFor(import.meta.filename);

async function body(panel: Panel): Promise<string> {
  const response = await fetch(panel.url);
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** One band's markup, from its section to the next band's. */
function lens(html: string, name: string): string {
  const from = html.indexOf(`data-lens="${name}"`);
  assert.ok(from >= 0, `the page drew no ${name} band`);
  const rest = html.slice(from + 1);
  const next = rest.search(/data-lens="[a-z-]+" data-lens-status=/);
  return next < 0 ? rest : rest.slice(0, next);
}

/** What a fragment of markup actually says, with the tags and classes gone. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The work items one band drew, in the order it drew them. */
function items(html: string, name: string): string[] {
  return [...lens(html, name).matchAll(/data-deck-item="([^"]+)"/g)].map(
    (match) => match[1],
  );
}

describe("what needs the operator, with a deck that has plenty in it", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "crowded" });
  });
  after(() => panel.stop());

  test("draws every decision held for a person, and nothing else", async () => {
    // Four of the fifteen rows are held for a person; a fifth is held for
    // something that is not one, and it is not a question anybody can answer.
    assert.deepEqual(items(await body(panel), "needs-you").sort(), [
      "wi-cordage-419",
      "wi-lamplight-238",
      "wi-saltmarsh-322",
      "wi-tidewater-131",
    ]);
  });

  test("the actionable ones lead the ones deferred to a date", async () => {
    const drawn = items(await body(panel), "needs-you");
    // `wi-cordage-419` is deferred to 2099-01-06 and the other three are not.
    // A decision that can be taken today must not be under one that cannot.
    assert.equal(drawn.at(-1), "wi-cordage-419");
  });

  test("the count is the fleet's own fold, not a tally of what was rendered", async () => {
    const html = await body(panel);
    // Three of the four carry upstream's `captain_actionable`; the deferred one
    // does not. The panel reports that number rather than deciding it, which is
    // what stops two implementations of the rule drifting apart.
    assert.match(lens(html, "needs-you"), /4 decisions · 3 to answer/);
  });

  test("no deck row is drawn by neither band", async () => {
    const html = await body(panel);
    const drawn = [...items(html, "needs-you"), ...items(html, "deck")];
    assert.equal(
      new Set(drawn).size,
      drawn.length,
      "and none is drawn by both",
    );
    // Fifteen rows in, fifteen rows out. A row that belongs to one list and is
    // shown in neither is precisely the bug this layout is built against.
    assert.equal(drawn.length, 15);
  });

  test("the deck below counts only what it is holding", async () => {
    const html = await body(panel);
    assert.match(
      lens(html, "deck"),
      /11 items/,
      "fifteen rows less the four decisions",
    );
  });
});

describe("a deck with nothing held for a person", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "fleet-only" });
  });
  after(() => panel.stop());

  test("says so, and says what it counted to get there", async () => {
    const html = await body(panel);
    const band = lens(html, "needs-you");
    assert.ok(band.includes('data-needs-you-empty="none"'));
    assert.ok(band.includes("Nothing needs you"));
    assert.ok(
      band.includes("The deck carried nothing at all"),
      "the zero is shown to be derived, not asserted",
    );
  });
});

describe("a deck that could not be read", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "deck-dark" });
  });
  after(() => panel.stop());

  test("says the number is unknown rather than drawing a confident zero", async () => {
    const html = await body(panel);
    const band = lens(html, "needs-you");
    // The two are different facts and only one of them lets an operator stop
    // looking. A band that rendered them identically would be the undercount
    // bug wearing a clean read.
    assert.ok(band.includes('data-needs-you-empty="unknown"'));
    assert.ok(band.includes("Unknown, not nothing"));
    assert.ok(!band.includes("Nothing needs you"));
  });

  test("reports no count at all, rather than the count zero", async () => {
    const band = lens(await body(panel), "needs-you");
    const header =
      /<header role="status" data-lens-headline[\s\S]*?<\/header>/.exec(
        band,
      )?.[0];
    assert.ok(header, "the band drew its pinned header");
    const said = text(header);

    // Zero is the most dangerous wrong answer this panel can give: it is the
    // one number that tells an operator to stop looking, and a deck nobody
    // could read has not earned it. So the header states no size at all -
    // `sizeOf` is never called with a number the band did not count - and the
    // separator that would introduce one is absent with it. There is no
    // quantity anywhere on the band to be believed.
    assert.ok(said.includes("Could not be read"), said);
    assert.ok(!said.includes("·"), `the header appended a summary: ${said}`);
    assert.ok(
      !/\d+ decisions?/.test(text(band)),
      `the band claimed a count: ${text(band)}`,
    );
    assert.ok(
      !/to answer/.test(text(band)),
      `the band claimed something answerable`,
    );
  });

  test("and carries the unreadable trust word into its own header", async () => {
    const html = await body(panel);
    assert.match(html, /data-lens="needs-you" data-lens-status="unreadable"/);
  });
});

describe("an empty deck and an unreadable one, side by side", () => {
  let clean: Panel;
  let dark: Panel;
  before(async () => {
    clean = await startPanel({ port: nextPort(), fixtureSet: "fleet-only" });
    dark = await startPanel({ port: nextPort(), fixtureSet: "deck-dark" });
  });
  after(async () => {
    await clean.stop();
    await dark.stop();
  });

  test("never render the same, because they are not the same fact", async () => {
    const cleanBand = lens(await body(clean), "needs-you");
    const darkBand = lens(await body(dark), "needs-you");

    // Both bands are empty of cards. Only one of them is entitled to say so.
    assert.equal(/data-deck-item=/.test(cleanBand), false);
    assert.equal(/data-deck-item=/.test(darkBand), false);
    assert.notEqual(
      /data-needs-you-empty="([a-z]+)"/.exec(cleanBand)?.[1],
      /data-needs-you-empty="([a-z]+)"/.exec(darkBand)?.[1],
      "an emptiness that might be ignorance has to be labelled as ignorance",
    );
  });
});

describe("a deck that stops reading but still carries decisions from before", () => {
  test("keeps the count and its header, under a caveat no reader can miss", async () => {
    const fixtureRoot = await copyFixtures();
    const panel = await startPanel({
      port: nextPort(),
      fixtureSet: "healthy",
      fixtureRoot,
    });
    try {
      const initial = items(await body(panel), "needs-you");
      assert.deepEqual(initial.sort(), [
        "wi-driftwood-540",
        "wi-tidewater-126",
      ]);

      // Truncate the snapshot under the running panel, the same way
      // tests/panel.test.ts does to take the fleet and deck lenses dark.
      await writeFile(
        join(fixtureRoot, "healthy", "snapshot.json"),
        '{ "schema": "fm-fleet-snapshot.v1", "generated": "2099-01-01T09:15',
      );

      const html = await until(
        () => body(panel),
        (text) =>
          /data-lens="needs-you" data-lens-status="unreadable"/.test(text),
      );
      const band = lens(html, "needs-you");

      // The decisions from the last clean read are still drawn, and the header
      // still counts them - a read failing does not erase what was last known,
      // and this is not the "Unknown, not nothing" case.
      assert.deepEqual(items(html, "needs-you").sort(), [
        "wi-driftwood-540",
        "wi-tidewater-126",
      ]);
      assert.ok(!band.includes("Unknown, not nothing"));
      const header =
        /<header role="status" data-lens-headline[\s\S]*?<\/header>/.exec(
          band,
        )?.[0];
      assert.ok(header, "the band drew its pinned header");
      assert.match(text(header), /2 decisions · 2 to answer/);

      // The caveat that the count may be short is its own named element, not
      // prose a scanning reader could skip past.
      assert.ok(band.includes('data-needs-you-caveat="unreadable"'));
      assert.ok(band.includes("The read failed"));
      assert.ok(band.includes("may be short"));
    } finally {
      await panel.stop();
    }
  });
});

describe("an under-filled band", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  test("keeps the size it is given rather than shrinking to its contents", async () => {
    const html = await body(panel);
    const section = /<section data-lens="needs-you"[^>]*class="([^"]*)"/.exec(
      html,
    )?.[1];
    assert.ok(section, "the band drew its own section");
    // Two decisions in a band sized for a first screen. The slack is the whole
    // mechanism: a zone that shrinks to fit makes two look as complete as
    // sixteen, which is how the prior board's undercount went unseen.
    assert.ok(
      /md:min-h-\[\d+svh\]/.test(section),
      "the band's height is a rule, not a measurement of what is in it",
    );
    assert.deepEqual(items(html, "needs-you"), [
      "wi-tidewater-126",
      "wi-driftwood-540",
    ]);
  });

  test("draws its decisions as cards in a grid, with the answer control on them", async () => {
    const html = await body(panel);
    const band = lens(html, "needs-you");
    assert.match(band, /<ul data-needs-group="decisions" class="card-grid/);
    // The same row component the deck draws, on a card surface. A decision an
    // operator answers here and the same decision seen in the deck must not
    // read as two different pieces of work.
    assert.match(
      band,
      /data-answer-(control|unavailable)="wi-tidewater-126"/,
      "the control came with the row - or the note that says why it cannot",
    );
  });
});
