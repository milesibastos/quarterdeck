import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { startPanel, type Panel } from "./lib/server.ts";

/**
 * What the landed lens draws, driven end to end through the built server.
 *
 * The claims here are the ones the band exists to make. That finished work is
 * on the page at all is the first of them - the panel used to forget it the
 * moment it landed. That a second mate's work is on the page and is visibly a
 * second mate's is the second, and it is the one prior boards got wrong: they
 * lost it, or merged it into one list where nobody could tell whose home did
 * what. That the delivery artifact is the whole address rather than a bare
 * number is the third.
 *
 * `document.test.ts` asserts the projection underneath and `panel.test.ts` the
 * envelope around it; what is asserted here is only what the lens renders.
 */

const nextPort = portsFor(import.meta.filename);

/** The rendered page, with React's text-node markers removed. */
async function body(panel: Panel): Promise<string> {
  return (await (await fetch(panel.url)).text()).replaceAll("<!-- -->", "");
}

/** Every landed row's work item id, in the order the lens drew them. */
function drawn(html: string): string[] {
  return [...html.matchAll(/data-landed-item="([^"]+)"/g)].map(
    (match) => match[1],
  );
}

/**
 * One row's markup, and nothing else's.
 *
 * Bounded at the row's own closing tag rather than at the next row: the last
 * row would otherwise run to the foot of the page and pick up whatever the
 * disclosure bar says about the same homes.
 */
function row(html: string, id: string): string {
  const start = html.indexOf(`data-landed-item="${id}"`);
  assert.notEqual(start, -1, `the lens drew no row for ${id}`);
  const end = html.indexOf("</li>", start);
  assert.notEqual(end, -1, `the row for ${id} does not close`);
  return html.slice(start, end);
}

describe("the landed lens", () => {
  let panel: Panel;
  let html: string;

  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "healthy" });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("draws finished work, and says how much of it a mate landed", () => {
    assert.ok(html.includes('data-lens="landed"'), "the band is on the page");
    assert.deepEqual(drawn(html).sort(), [
      "wi-brackish-088",
      "wi-brackish-091",
      "wi-driftwood-512",
      "wi-tidewater-109",
    ]);
    // The count in the header is the one thing the heading cannot otherwise
    // say, and a mate's share of it is what this band was built for.
    assert.ok(html.includes("4 landed · 3 by a mate"));
  });

  test("does not compete with the band that owns the first screen", () => {
    // Ordinary weight, and below the deck. Both are the same claim: nothing
    // here needs the operator, so nothing here may look as though it does.
    assert.ok(
      html.includes(
        'data-lens="landed" data-lens-status="fresh" data-prominence="lens"',
      ),
    );
    const order = ["needs-you", "fleet", "deck", "landed"].map((lens) =>
      html.indexOf(`data-lens="${lens}"`),
    );
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
      "the landed band is drawn after the deck, which is after the first screen",
    );
  });

  test("attributes this home's work to this home", () => {
    const here = row(html, "wi-tidewater-109");
    assert.ok(here.includes('data-landed-where="this-home"'));
    assert.ok(here.includes('data-landed-home="/anchorage/homes/tidewater"'));
    assert.ok(here.includes("this home"));
  });

  test("attributes a second mate's work to the home it landed in", () => {
    const mate = row(html, "wi-brackish-088");
    assert.ok(mate.includes('data-landed-where="second-mate"'));
    assert.ok(mate.includes('data-landed-home="/anchorage/homes/brackish"'));
    // The home path itself, verbatim: it is what tells two mates' homes apart.
    assert.ok(mate.includes("/anchorage/homes/brackish"));
  });

  test("says a mate's home was not recorded rather than claiming this one", () => {
    const unnamed = row(html, "wi-driftwood-512");
    assert.ok(unnamed.includes('data-landed-where="second-mate"'));
    assert.ok(unnamed.includes('data-landed-home=""'));
    assert.ok(unnamed.includes("home not recorded"));
    assert.ok(
      !unnamed.includes("/anchorage/homes/tidewater"),
      "unattributed work must not be attributed to the fleet on screen",
    );
  });

  test("gives the delivery artifact as a full address, never a bare number", () => {
    const landed = row(html, "wi-tidewater-109");
    assert.ok(
      landed.includes('href="https://forge.invalid/tidewater/pull/109"'),
    );
    assert.ok(
      landed.includes(">https://forge.invalid/tidewater/pull/109<"),
      "the address is the link's own text",
    );
    assert.ok(
      row(html, "wi-brackish-088").includes(
        "https://forge.invalid/brackish/pull/88",
      ),
    );
  });

  test("says when a piece of work closed without one", () => {
    const reported = row(html, "wi-brackish-091");
    assert.ok(reported.includes('data-landed-artifact="none"'));
    assert.ok(reported.includes("No pull request on the record."));
    // Upstream's own word for how it closed, unedited.
    assert.ok(reported.includes("reported"));
  });

  test("says nothing where the record said nothing", () => {
    const bare = row(html, "wi-driftwood-512");
    assert.ok(bare.includes("closed, how not recorded"));
    assert.ok(bare.includes("landing date not recorded"));
  });

  test("draws the dated work before the undated, most recent first", () => {
    const order = drawn(html);
    assert.equal(
      order.at(-1),
      "wi-driftwood-512",
      "a record that named no day has not claimed to be the most recent thing here",
    );
  });
});

describe("a second mate's landed work survives this home's backlog", () => {
  let panel: Panel;
  let html: string;

  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "deck-dark" });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("draws it, dark lens and all", () => {
    assert.ok(
      html.includes('data-lens="landed" data-lens-status="unreadable"'),
    );
    assert.deepEqual(drawn(html), ["wi-kelpwick-031"]);
    assert.ok(
      row(html, "wi-kelpwick-031").includes('data-landed-where="second-mate"'),
    );
  });

  test("claims nothing about how old what survived is", () => {
    // The deck's own caveat - "showing the last deck that read cleanly" - would
    // be wrong here. A mate's landed work is rolled up separately and is as
    // current as the read that produced it; only this home's is missing.
    assert.ok(!html.includes("the last landed work that read cleanly"));
    assert.ok(
      html.includes("what follows is the part of it that still arrived"),
    );
  });
});

describe("nothing landed", () => {
  let panel: Panel;
  let html: string;

  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "empty" });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("is drawn as a clean empty read, not as a blank area", () => {
    assert.equal(drawn(html).length, 0);
    assert.ok(html.includes('data-landed-empty="none"'));
    assert.ok(
      html.includes(
        "Nothing has landed: the read carried no finished work, here or in a mate's home.",
      ),
    );
  });

  test("reports no count it did not count", () => {
    assert.ok(
      !html.includes("0 landed"),
      "a zero in the header is a number nobody counted",
    );
  });
});
