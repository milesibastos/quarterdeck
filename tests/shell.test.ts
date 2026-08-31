import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { startPanel, type Panel } from "./lib/server.ts";

/**
 * The shell: which bands the page draws and in what order, what the markup
 * offers a reader who is not looking at it, and which theme the stylesheet
 * answers to.
 *
 * Everything here is asserted through the built server, in markup. What the
 * bands are for, and how much of the first screen each gets, is
 * `tests/needs-you.test.ts` and `tests/width.test.ts`. Two claims this file
 * deliberately does not make, because a string cannot carry them: that nothing
 * overflows the page sideways, and that the theme flips with the operator's
 * setting. Both were measured in a browser instead - see
 * `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md` and
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

/** The bands the page drew, in the order it drew them. */
function bands(html: string): string[] {
  return [...html.matchAll(/data-lens="([a-z-]+)" data-lens-status=/g)].map(
    (match) => match[1],
  );
}

/**
 * One band's markup: from its `<section>` to the next band's, or to the end.
 *
 * Not a `</section>` match - the deck draws its piles as sections of their own,
 * and a lazy close tag would stop at the first of them.
 */
function lens(html: string, name: string): string {
  const from = html.indexOf(`data-lens="${name}"`);
  assert.ok(from >= 0, `the page drew no ${name} band`);
  const rest = html.slice(from + 1);
  const next = rest.search(/data-lens="[a-z-]+" data-lens-status=/);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("the order of the bands, at the large end of the range", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "crowded" });
  });
  after(() => panel.stop());

  test("what needs the operator comes first, and underway is next", async () => {
    // The reading order is the layout's whole argument, and it is the same
    // order at every width because there is only one of it: the bands stack.
    // A page that reorders itself between breakpoints teaches two panels.
    assert.deepEqual(bands(await body(panel)), [
      "needs-you",
      "fleet",
      "deck",
      "landed",
      "shipshape",
    ]);
  });

  test("the bar naming what is not on the page is the last thing on it", async () => {
    const html = await body(panel);
    const bar = html.indexOf("data-disclosure");
    assert.ok(bar > 0, "the page drew the disclosure bar");
    // After every band, and it is not one: an absence is a statement about the
    // page rather than a part of it, so it carries no lens envelope and no
    // trust word of its own.
    for (const band of bands(html)) {
      assert.ok(
        bar > html.indexOf(`data-lens="${band}"`),
        `the bar comes after ${band}`,
      );
    }
    assert.ok(!/data-lens="disclosure"/.test(html), "the bar is not a lens");
  });

  test("only the first band is drawn as the dominant one", async () => {
    const html = await body(panel);
    const primary = [
      ...html.matchAll(/data-lens="([a-z-]+)"[^>]*data-prominence="primary"/g),
    ];
    assert.deepEqual(
      primary.map((match) => match[1]),
      ["needs-you"],
      "two dominant bands is no dominant band",
    );
  });

  test("every band says how much it is holding, above its own content", async () => {
    const html = await body(panel);
    // The header count is how an operator knows whether what is on screen is
    // all of it, without scrolling to the bottom of a band to find out.
    assert.match(
      lens(html, "needs-you"),
      /Current<\/span>[\s\S]{0,80}4 decisions/,
    );
    assert.match(lens(html, "fleet"), /Current<\/span>[\s\S]{0,80}30 workers/);
    assert.match(lens(html, "deck"), /Current<\/span>[\s\S]{0,80}11 items/);
  });

  test("nothing clips its own content any more", async () => {
    const html = await body(panel);
    // The page scrolls as a page. A band that scrolled inside itself would
    // hide rows behind an overlay scrollbar macOS draws only while it is used,
    // which is a silence this layout cannot afford.
    assert.ok(!/data-lens-body[^>]*overflow-y-auto/.test(html));
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
    assert.equal(
      levels.filter((level) => level === 1).length,
      1,
      "one page, one h1",
    );
    // Five bands, and the disclosure bar - which is not a band but is a
    // top-level part of the page and so sits at the same level as one.
    assert.equal(
      levels.filter((level) => level === 2).length,
      6,
      "one h2 per band, plus the bar",
    );
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

  test("each band header is a live region, so a band going stale is announced", async () => {
    const html = await body(panel);
    for (const name of ["needs-you", "fleet", "deck", "landed", "shipshape"]) {
      assert.match(
        lens(html, name),
        /<header role="status" data-lens-headline="true"/,
        `${name}'s trust word changes with no interaction; it has to announce`,
      );
    }
  });

  test("each band body is named by its own heading", async () => {
    const html = await body(panel);
    for (const name of ["needs-you", "fleet", "deck", "landed", "shipshape"]) {
      const section = lens(html, name);
      const region = /<div data-lens-body[^>]*>/.exec(section)?.[0] ?? "";
      const labelled = /aria-labelledby="([^"]+)"/.exec(region)?.[1];
      assert.ok(labelled, `${name}'s body is named`);
      assert.ok(
        section.includes(`id="${labelled}"`),
        `${name}'s body is named by its own heading, which is on the same section`,
      );
      // The focus stop went with the scroll area it existed for. A region that
      // does not scroll and takes focus anyway is a stop on the way to nothing.
      assert.ok(
        !region.includes('tabindex="0"'),
        `${name}'s body is not a focus stop`,
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
    assert.ok(detail, "the fleet band drew its status detail");
    // The recorded bug: upstream's refusal quotes what it refused, the fixture
    // makes that a 180-character run with no space, hyphen or slash in it, and
    // `break-words` leaves such a run wider than the column it sits in.
    assert.ok(
      /[A-Z0-9]{120,}/.test(detail[2]),
      "the detail carries the unbroken run",
    );
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
    const href = /<link rel="stylesheet" href="([^"]+\.css)"/.exec(
      await body(panel),
    )?.[1];
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
    assert.ok(
      !/\.dark[\s,{]/.test(css),
      "and no class decides the theme any more",
    );
  });

  test("declares a colour scheme in both directions", async () => {
    const css = await stylesheet();
    // Not decoration: it is what makes the browser's own scrollbars, form
    // controls and canvas match the theme, and it is why the first paint is
    // already the right one.
    assert.ok(/:root\{[^}]*color-scheme:\s*light/.test(css));
    assert.ok(
      /@media \(prefers-color-scheme:\s*dark\)\{:root\{[^}]*color-scheme:\s*dark/.test(
        css,
      ),
    );
  });

  test("nothing runs before the first paint to decide it", async () => {
    const html = await body(panel);
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
    // A theme chosen in script is a theme that flashes the other one first.
    assert.ok(!/prefers-color-scheme|localStorage|classList/.test(head));
  });
});
