import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { startPanel, type Panel } from "./lib/server.ts";

/**
 * What width buys: more cards, never wider ones.
 *
 * A screenshot cannot be a regression test and this suite has no browser, so
 * the claim is proved where it is actually made - in the stylesheet the built
 * server serves. The grid rule is read out of that stylesheet, the card minimum
 * is read out of the class the band actually carries in its markup, and the
 * column count is computed from the two. Nothing here is a constant copied from
 * the source: change the rule and this arithmetic changes with it.
 *
 * What that leaves to a browser is the pixel: whether the page overflows
 * sideways at 360, and where the fold falls at 1440. Both were measured against
 * the built panel and recorded in
 * `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`.
 */

const nextPort = portsFor(import.meta.filename);

/** The panel's own root font size. Nothing in `globals.css` moves it. */
const REM_PX = 16;

/**
 * How many columns an `auto-fill` track produces in a container this wide.
 *
 * The CSS Grid rule for `repeat(auto-fill, minmax(min, 1fr))`: as many whole
 * tracks of `min` as fit once the gaps between them are paid for, and never
 * fewer than one.
 */
function columns(contentPx: number, minPx: number, gapPx: number): number {
  return Math.max(1, Math.floor((contentPx + gapPx) / (minPx + gapPx)));
}

/** How wide each card ends up, once `1fr` has shared out what is left over. */
function cardWidth(contentPx: number, minPx: number, gapPx: number): number {
  const count = columns(contentPx, minPx, gapPx);
  return (contentPx - gapPx * (count - 1)) / count;
}

function lengthPx(value: string): number {
  const rem = /^([\d.]+)rem$/.exec(value);
  if (rem) return Number(rem[1]) * REM_PX;
  const px = /^([\d.]+)px$/.exec(value);
  assert.ok(px, `not a length this test understands: ${value}`);
  return Number(px[1]);
}

describe("a wider viewport buys more cards", () => {
  let panel: Panel;
  let html: string;
  let css: string;

  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "crowded" });
    html = (await (await fetch(panel.url)).text()).replaceAll("<!-- -->", "");
    const href = /<link rel="stylesheet" href="([^"]+\.css)"/.exec(html)?.[1];
    assert.ok(href, "the page links a stylesheet");
    css = await (await fetch(`${panel.url}${href}`)).text();
  });
  after(() => panel.stop());

  /** The one grid rule every band draws its repeated objects through. */
  function grid(): { track: string; gapPx: number } {
    const rule = /\.card-grid\{([^}]*)\}/.exec(css)?.[1];
    assert.ok(rule, "the stylesheet carries the card-grid utility");
    const track = /grid-template-columns:\s*([^;]+)/.exec(rule)?.[1];
    const gap = /(?:^|;)\s*gap:\s*([^;]+)/.exec(rule)?.[1];
    assert.ok(track && gap, "and it sets both a track and a gap");
    return { track: track.trim(), gapPx: lengthPx(gap.trim()) };
  }

  /**
   * The card minimum one band actually renders with.
   *
   * Read through the markup on purpose: the utility only declares a fallback,
   * and a band that forgot to set its own would otherwise be tested against a
   * number it does not use.
   */
  function cardMinPx(band: string): number {
    const cls = new RegExp(`data-needs-group="${band}" class="([^"]*)"`).exec(html)?.[1] ??
      new RegExp(`<ul class="(card-grid[^"]*)"`).exec(html)?.[1];
    assert.ok(cls, `no card grid found for ${band}`);
    const named = /\[--qd-card-min:([^\]]+)\]/.exec(cls)?.[1];
    assert.ok(named, `${band} draws a card grid without saying how wide its cards are`);
    return lengthPx(named);
  }

  test("the columns are filled automatically, never counted", async () => {
    const { track } = grid();
    // `auto-fill` is the whole mechanism: a fixed count is what stretches three
    // cards across a monitor, which is the layout this one replaced.
    assert.match(track, /^repeat\(auto-fill,\s*minmax\(/);
    assert.ok(!/repeat\(\d/.test(track), "a repeat with a number in it is a fixed grid");
    // Without `min(100%, ...)` a 24rem floor overflows a 360px phone sideways:
    // a track's minimum is a width the container may not shrink below.
    assert.match(track, /minmax\(min\(100%,/);
  });

  test("no band draws a fixed column count", async () => {
    assert.ok(
      !/class="[^"]*\bgrid-cols-\d/.test(html),
      "a fixed column count anywhere on this page is the thing that was removed",
    );
  });

  test("nothing centres the panel inside a maximum width", async () => {
    // The refusal page is prose and keeps its measure; the panel does not. A
    // cap here throws away exactly the space that would show the sixteenth
    // decision, which is the space this layout is for.
    const main = /<main data-panel="true" class="([^"]*)"/.exec(html)?.[1];
    assert.ok(main, "the page drew the panel");
    assert.ok(!/\bmax-w-/.test(main), `the panel is capped: ${main}`);
    assert.ok(!/\bmx-auto\b/.test(main), `the panel is centred: ${main}`);

    const nav = /<nav aria-label="Fleet" class="([^"]*)"/.exec(html)?.[1];
    assert.ok(nav, "the page drew the fleet picker");
    assert.ok(!/\bmax-w-|\bmx-auto\b/.test(nav), `the picker is capped: ${nav}`);
  });

  test("three widths, three column counts, at one card size", () => {
    const { gapPx } = grid();
    const minPx = cardMinPx("decisions");
    // Content widths, not viewport widths: what the gutter and the band's own
    // padding take is chrome, and this rule is about the box they leave.
    const widths = [900, 1300, 2400];
    const counts = widths.map((width) => columns(width, minPx, gapPx));

    for (const [index, count] of counts.entries()) {
      if (index === 0) continue;
      assert.ok(
        count > counts[index - 1],
        `${widths[index]}px gave ${count} columns and ${widths[index - 1]}px gave ` +
          `${counts[index - 1]}; width has to buy cards`,
      );
    }

    for (const width of widths) {
      const card = cardWidth(width, minPx, gapPx);
      assert.ok(card >= minPx, `a card at ${width}px shrank below its designed ${minPx}px`);
      assert.ok(
        card < minPx * 2,
        `a card at ${width}px grew to ${Math.round(card)}px, which is another card's worth ` +
          `of stretch rather than another card`,
      );
    }
  });

  test("one card, and no sideways overflow, on a phone", () => {
    const { gapPx } = grid();
    const minPx = cardMinPx("decisions");
    // 360 CSS pixels less the 16px gutter each side and the band's own 16px
    // padding each side. `min(100%, ...)` is what makes this one column rather
    // than one column wider than the screen.
    assert.equal(columns(360 - 64, minPx, gapPx), 1);
  });
});
