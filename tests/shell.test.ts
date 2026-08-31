import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { startPanel, type Panel } from "./lib/server.ts";

/**
 * The shell: what the fold puts on screen, what the markup offers a reader who
 * is not looking at it, and which theme the stylesheet answers to.
 *
 * Everything here is asserted through the built server, in markup. Two claims
 * this file deliberately does not make, because a string cannot carry them:
 * that nothing overflows the page sideways, and that the theme flips with the
 * operator's setting. Both were measured in a browser instead - at 360 and at
 * 1440 CSS pixels, and under an emulated `prefers-color-scheme` in both
 * directions. See `docs/decisions/2026-08-31-the-fold-line.md` and
 * `docs/decisions/2026-08-31-the-theme-follows-the-system.md`.
 */

const nextPort = portsFor(import.meta.filename);

async function body(panel: Panel, path = "/"): Promise<string> {
  const response = await fetch(`${panel.url}${path}`);
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** The heading levels the page emits, in document order. */
function headings(html: string): number[] {
  return [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));
}

/**
 * One lens's markup: from its `<section>` to the next lens's, or to the end.
 *
 * Not a `</section>` match - the deck draws its piles as sections of their own,
 * and a lazy close tag would stop at the first of them.
 */
function lens(html: string, name: string): string {
  const from = html.indexOf(`data-lens="${name}"`);
  assert.ok(from >= 0, `the page drew no ${name} lens`);
  const rest = html.slice(from + 1);
  const next = rest.search(/data-lens="[a-z]+" data-lens-status=/);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("the fold, at the large end of the range", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "crowded" });
  });
  after(() => panel.stop());

  test("every lens says how much it is holding, above its own content", async () => {
    const html = await body(panel);
    // The pinned header is what a fleet of thirty and a fleet of two have in
    // common: the count is how an operator knows which of the two they have
    // without scrolling to the bottom of a column to find out.
    assert.match(lens(html, "fleet"), /Current<\/span>[\s\S]{0,80}30 workers/);
    assert.match(lens(html, "deck"), /Current<\/span>[\s\S]{0,80}15 items/);
  });

  test("each lens pins a header over a scrolling body", async () => {
    const html = await body(panel);
    for (const name of ["fleet", "deck", "shipshape"]) {
      const section = lens(html, name);
      assert.ok(section.includes("data-lens-headline"), `${name} has a pinned header`);
      assert.ok(section.includes("data-lens-body"), `${name} has a body of its own`);
      assert.ok(
        /data-lens-body[^>]*md:overflow-y-auto/.test(section),
        `${name}'s body is what scrolls, not the page`,
      );
    }
  });

  test("what the operator has to answer is reachable without scrolling a pile", async () => {
    const html = await body(panel);
    const deck = lens(html, "deck");
    // The held pile is drawn first, and the count of what can be answered
    // right now sits on its heading - so the question "is anything waiting on
    // me" is answered by the top of the column at any fleet size.
    assert.ok(deck.indexOf("Waiting on a person") < deck.indexOf("Queued"));
    assert.ok(deck.includes("3 to answer"));
  });
});

describe("the accessibility of a page that changes under the reader", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "crowded" });
  });
  after(() => panel.stop());

  test("the headings form an outline with no level skipped", async () => {
    const levels = headings(await body(panel));
    assert.equal(levels.filter((level) => level === 1).length, 1, "one page, one h1");
    assert.equal(levels.filter((level) => level === 2).length, 3, "one h2 per lens");
    assert.equal(levels[0], 1, "and the page's own heading comes first");
    for (const [index, level] of levels.entries()) {
      const previous = levels[index - 1] ?? 1;
      assert.ok(
        level <= previous + 1,
        `heading ${index} jumps from h${previous} to h${level}; a reader ` +
          `navigating by heading would find a level with nothing above it`,
      );
    }
  });

  test("each lens header is a live region, so a lens going stale is announced", async () => {
    const html = await body(panel);
    for (const name of ["fleet", "deck", "shipshape"]) {
      assert.match(
        lens(html, name),
        /<header role="status" data-lens-headline="true"/,
        `${name}'s trust word changes with no interaction; it has to announce`,
      );
    }
  });

  test("a scrolling lens body can be reached and is named", async () => {
    const html = await body(panel);
    for (const name of ["fleet", "deck", "shipshape"]) {
      const section = lens(html, name);
      const body = /<div data-lens-body[^>]*>/.exec(section)?.[0] ?? "";
      assert.ok(body.includes('tabindex="0"'), `${name}'s body takes keyboard focus`);
      const labelled = /aria-labelledby="([^"]+)"/.exec(body)?.[1];
      assert.ok(labelled, `${name}'s body is named`);
      assert.ok(
        section.includes(`id="${labelled}"`),
        `${name}'s body is named by its own heading, which is on the same section`,
      );
    }
  });

  test("the fleet chips are buttons that say which one is showing", async () => {
    const html = await body(panel);
    assert.ok(html.includes('<nav aria-label="Fleet"'));
    assert.match(html, /data-fleet-choice="crowded" aria-current="true"/);
  });
});

describe("a status line the panel did not write", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "wide-detail" });
  });
  after(() => panel.stop());

  test("a long unbroken detail is shown, and in an element that can break it", async () => {
    const html = await body(panel);
    const detail = /<p data-lens-detail="true" class="([^"]*)">([^<]*)</.exec(
      lens(html, "fleet"),
    );
    assert.ok(detail, "the fleet lens drew its status detail");
    // The recorded bug: upstream's refusal quotes what it refused, the fixture
    // makes that a 180-character run with no space, hyphen or slash in it, and
    // `break-words` leaves such a run wider than the column it sits in.
    assert.ok(/[A-Z0-9]{120,}/.test(detail[2]), "the detail carries the unbroken run");
    assert.ok(
      detail[1].includes("wrap-anywhere"),
      "and the element may break it anywhere, which is what keeps it inside the frame",
    );
  });
});

describe("the theme", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  /** The stylesheet the page links, fetched from the server that served it. */
  async function stylesheet(): Promise<string> {
    const href = /<link rel="stylesheet" href="([^"]+\.css)"/.exec(await body(panel))?.[1];
    assert.ok(href, "the page links a stylesheet");
    return (await fetch(`${panel.url}${href}`)).text();
  }

  test("follows the operator's system setting, with nothing to toggle", async () => {
    const css = await stylesheet();
    assert.ok(
      /@media \(prefers-color-scheme:\s*dark\)\{:root\{[^}]*--background:\s*var\(--qd-ink-900\)/.test(
        css,
      ),
      "the dark tokens are keyed on the system setting",
    );
    // The class this used to be. A `.dark` selector surviving anywhere would
    // mean a second copy of the mapping, which is the drift the old decision
    // refused a media query to avoid; there is one copy now, not two.
    assert.ok(!/\.dark[\s,{]/.test(css), "and no class decides the theme any more");
  });

  test("declares a colour scheme in both directions", async () => {
    const css = await stylesheet();
    // Not decoration: it is what makes the browser's own scrollbars, form
    // controls and canvas match the theme, and it is why the first paint is
    // already the right one.
    assert.ok(/:root\{[^}]*color-scheme:\s*light/.test(css));
    assert.ok(
      /@media \(prefers-color-scheme:\s*dark\)\{:root\{[^}]*color-scheme:\s*dark/.test(css),
    );
  });

  test("nothing runs before the first paint to decide it", async () => {
    const html = await body(panel);
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
    // A theme chosen in script is a theme that flashes the other one first.
    assert.ok(!/prefers-color-scheme|localStorage|classList/.test(head));
  });
});
