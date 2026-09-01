import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { startPanel, type Panel } from "./lib/server.ts";

/**
 * The disclosure bar: what is not on the page, and which of three reasons each
 * absence has.
 *
 * The bar exists because a plan once dropped seven features quietly, and a
 * panel that omits things silently is worse than one that shows less. So the
 * claims here are about silence: that every absence the document declares is
 * named on the page, that the three reasons stay apart rather than becoming one
 * apologetic sentence, that a page with nothing missing says so rather than
 * dropping the bar - and that a page which could not read its own account of
 * what is missing never claims nothing is.
 *
 * Every absence here comes from the document. `document.test.ts` asserts the
 * projection that assembles it; nothing in the bar composes an absence of its
 * own, which is what stops it going stale in the one way it must not.
 */

const nextPort = portsFor(import.meta.filename);

async function body(panel: Panel): Promise<string> {
  return (await (await fetch(panel.url)).text()).replaceAll("<!-- -->", "");
}

/** How many absences the bar says it is naming. */
function count(html: string): string | null {
  return /data-disclosure-count="(\d+)"/.exec(html)?.[1] ?? null;
}

/** Every absence's reason, in the order the bar drew them. */
function reasons(html: string): string[] {
  return [...html.matchAll(/data-omission-reason="([a-z-]+)"/g)].map(
    (match) => match[1],
  );
}

describe("the bar names what a page is not showing", () => {
  let panel: Panel;
  let html: string;

  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "healthy" });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("draws one entry per absence the document declared", () => {
    assert.ok(html.includes("data-disclosure"), "the bar is on the page");
    assert.equal(count(html), "3");
    assert.equal(reasons(html).length, 3);
  });

  test("keeps a bound apart from a read that failed", () => {
    // A bound somebody chose and a home that did not answer are different
    // facts about why something is missing, and they ask for different things
    // from the operator. Folding them into one word is the ambiguity the bar
    // exists to remove.
    assert.deepEqual(
      [...new Set(reasons(html))].sort(),
      ["not-shown", "unreadable"],
      "healthy declares a bounded home and two homes that could not be read",
    );
    assert.ok(html.includes('data-omission-group="not-shown"'));
    assert.ok(html.includes('data-omission-group="unreadable"'));
    assert.ok(!html.includes('data-omission-group="not-looked-up"'));
    assert.ok(html.includes("Not shown"));
    assert.ok(html.includes("Could not be read"));
  });

  test("names each absence and carries the account written for it", () => {
    for (const home of ["brackish", "shoalwater", "driftwood"]) {
      assert.ok(
        html.includes(`landed work in /anchorage/homes/${home}`),
        `${home} is named as missing`,
      );
    }
    assert.ok(
      html.includes("did not answer, so nothing it landed is on this page"),
    );
    assert.ok(html.includes("Upstream bounded how much of"));
  });

  test("reads in the same order however narrow the page is", () => {
    // The columns come from `auto-fit`, so a narrow viewport stacks the same
    // three groups in the same source order rather than reflowing them.
    const order = ["not-shown", "not-looked-up", "unreadable"]
      .map((reason) => html.indexOf(`data-omission-group="${reason}"`))
      .filter((at) => at !== -1);
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
  });
});

describe("a read nobody has done", () => {
  let panel: Panel;
  let html: string;

  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "crowded" });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("is its own reason, not a failure", () => {
    assert.ok(html.includes('data-omission-group="not-looked-up"'));
    assert.ok(html.includes("Not looked up"));
    assert.ok(html.includes("Nobody has asked."));
    assert.ok(html.includes("pull request checks"));
    assert.ok(html.includes("pull request review comments"));
  });

  test("appears beside a bound, each under its own heading", () => {
    assert.deepEqual([...new Set(reasons(html))].sort(), [
      "not-looked-up",
      "not-shown",
    ]);
    assert.equal(count(html), "3");
  });
});

describe("a page with nothing missing", () => {
  let panel: Panel;
  let html: string;

  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "empty" });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("says so rather than dropping the bar", () => {
    // A bar that disappears is ambiguous with a bar that was never built, and
    // with a page that forgot to render one.
    assert.ok(html.includes("data-disclosure"));
    assert.equal(count(html), "0");
    assert.ok(html.includes('data-disclosure-empty="none"'));
    assert.ok(
      html.includes("nothing omitted"),
      "and says so in the corner too",
    );
    assert.ok(html.includes("Nothing is missing."));
    assert.equal(reasons(html).length, 0);
  });
});

describe("a page that could not read its own account of what is missing", () => {
  let panel: Panel;
  let html: string;

  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "malformed" });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("never claims nothing is", () => {
    // The list is empty here for the worst possible reason: the read that
    // would have said what is missing is the read that failed. "Nothing is
    // missing" would be this page dropping an absence silently, which is the
    // one thing the bar was built to make impossible.
    assert.equal(count(html), "0");
    assert.ok(!html.includes("Nothing is missing."));
    // Including in the corner. A header claiming nothing was omitted over a
    // body saying the account could not be read is worse than either alone: a
    // reader scanning the page takes the short line.
    assert.ok(!html.includes("nothing omitted"));
    assert.ok(html.includes("not accounted for"));
    assert.ok(html.includes('data-disclosure-empty="unknown"'));
    assert.ok(html.includes("cannot account for what it is not showing"));
  });
});
