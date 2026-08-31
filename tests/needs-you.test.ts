import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { startPanel, type Panel } from "./lib/server.ts";

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

/** The work items one band drew, in the order it drew them. */
function items(html: string, name: string): string[] {
  return [...lens(html, name).matchAll(/data-deck-item="([^"]+)"/g)].map((match) => match[1]);
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
    assert.equal(new Set(drawn).size, drawn.length, "and none is drawn by both");
    // Fifteen rows in, fifteen rows out. A row that belongs to one list and is
    // shown in neither is precisely the bug this layout is built against.
    assert.equal(drawn.length, 15);
  });

  test("the deck below counts only what it is holding", async () => {
    const html = await body(panel);
    assert.match(lens(html, "deck"), /11 items/, "fifteen rows less the four decisions");
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

  test("and carries the unreadable trust word into its own header", async () => {
    const html = await body(panel);
    assert.match(html, /data-lens="needs-you" data-lens-status="unreadable"/);
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
    const section = /<section data-lens="needs-you"[^>]*class="([^"]*)"/.exec(html)?.[1];
    assert.ok(section, "the band drew its own section");
    // Two decisions in a band sized for a first screen. The slack is the whole
    // mechanism: a zone that shrinks to fit makes two look as complete as
    // sixteen, which is how the prior board's undercount went unseen.
    assert.ok(
      /md:min-h-\[\d+svh\]/.test(section),
      "the band's height is a rule, not a measurement of what is in it",
    );
    assert.deepEqual(items(html, "needs-you"), ["wi-tidewater-126", "wi-driftwood-540"]);
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
