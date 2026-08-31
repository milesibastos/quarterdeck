import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { startPanel } from "./lib/server.ts";
import { ago, agoAtPrecision } from "../src/ui/lib/age.ts";

/**
 * How old a deck row claims to be, and the precision it is allowed to claim it
 * at.
 *
 * The defect this file exists to hold shut: upstream publishes a backlog row's
 * start as a calendar day - `(since 2026-08-31)`, no time in it - and the panel
 * used to widen that to midnight UTC and count hours from there. A row filed
 * that morning read "14h ago" in the evening. The number was not a duration; it
 * was the distance from a midnight the record never stated, and it grew more
 * wrong the later in the day the page was read, which is exactly when someone
 * checks what has been sitting too long.
 *
 * So every case below is asserted at several hours of the day, including the
 * late evening where the old behaviour was worst. A test of this that only ran
 * in the morning would have passed against the bug.
 */

const nextPort = portsFor(import.meta.filename);

/** The same local day, from just after midnight to just before the next one. */
const HOURS = [0, 1, 6, 10, 14, 18, 22, 23] as const;

/** Local midnight-plus-`hour` on 2026-08-31, the day the defect was found on. */
function at(hour: number, day = 31): number {
  return new Date(2026, 7, day, hour, 30).getTime();
}

/** Anything that claims hours, minutes or seconds of elapsed time. */
const MEASURED = /\d+\s*(?:s|m|h) ago|just now/;

describe("a start date carrying no time", () => {
  test("reads as today at every hour of that day, never as an hour count", () => {
    for (const hour of HOURS) {
      const drawn = agoAtPrecision("2026-08-31", at(hour));
      assert.equal(drawn, "since today", `at ${hour}:30`);
      assert.equal(
        MEASURED.test(drawn),
        false,
        `at ${hour}:30 the row claimed a precision the record does not carry`,
      );
    }
  });

  test("the reported case: the old rendering said 14h, and would still", () => {
    // Not a tautology check - it pins the number that was actually on screen,
    // so a future change that quietly restores the widening fails here rather
    // than in a fleet digest comparison months later.
    // Both sides built from the same local calendar the helper reads, so this
    // case is no more anchored to one timezone than the rest of the file.
    const midnight = new Date(2026, 7, 31).toISOString();
    const evening = new Date(2026, 7, 31, 14, 0).getTime();
    assert.equal(ago(midnight, evening), "14h ago");
    assert.equal(agoAtPrecision("2026-08-31", evening), "since today");
  });

  test("yesterday is yesterday all day, not somewhere between 1h and 47h", () => {
    for (const hour of HOURS) {
      assert.equal(agoAtPrecision("2026-08-30", at(hour)), "yesterday", `at ${hour}:30`);
    }
  });

  test("older days count in days, and the count does not move within a day", () => {
    for (const hour of HOURS) {
      assert.equal(agoAtPrecision("2026-08-28", at(hour)), "3d ago", `at ${hour}:30`);
    }
    assert.equal(agoAtPrecision("2025-08-31", at(10)), "1y ago");
  });

  test("a date ahead of the clock is not aged backwards", () => {
    // Fixtures are dated ahead of the wall clock on purpose so they never drift
    // into looking stale; `ago` answers "just now" for the same reason.
    assert.equal(agoAtPrecision("2099-01-01", at(10)), "since today");
  });
});

describe("a start that does carry a time", () => {
  test("keeps its exact age - this narrows a claim, it does not blunt one", () => {
    const now = Date.parse("2026-08-31T14:30:00.000Z");
    assert.equal(agoAtPrecision("2026-08-31T09:00:00.000Z", now), "6h ago");
    assert.equal(agoAtPrecision("2026-08-31T14:25:00.000Z", now), "5m ago");
    assert.equal(agoAtPrecision("2026-08-31T14:29:30.000Z", now), "30s ago");
  });

  test("agrees with the shared helper for every value that carries a time", () => {
    const now = Date.parse("2026-08-31T14:30:00.000Z");
    for (const instant of [
      "2026-08-31T14:29:59.000Z",
      "2026-08-31T13:00:00.000Z",
      "2026-08-29T13:00:00.000Z",
      "2020-08-29T13:00:00.000Z",
    ]) {
      assert.equal(agoAtPrecision(instant, now), ago(instant, now));
    }
  });
});

/**
 * The same claim through the built server, because the unit above proves the
 * helper and not the page. `upstream-shape` is the fixture set written in the
 * vocabulary a live fleet emits, and its backlog rows carry a bare day - which
 * is the shape that produced the defect.
 */
describe("the deck lens, drawn at two hours of the same day", () => {
  const port = nextPort();
  const ROW = "wi-tidewater-501";

  /** One deck row's markup at a pinned hour, with React's markers removed. */
  async function rowAt(now: string): Promise<string> {
    const panel = await startPanel({
      port,
      fixtureSet: "upstream-shape",
      now,
      // The fixture is generated at 09:15; without this the evening reading
      // would be testing the staleness caveat rather than the row's age.
      staleAfterMs: 86_400_000,
      // The helper reads the day in the server's own calendar, so the server's
      // calendar is pinned rather than inherited from whoever runs the suite.
      env: { TZ: "UTC" },
    });
    try {
      const html = (await (await fetch(panel.url)).text()).replaceAll("<!-- -->", "");
      return new RegExp(`data-deck-item="${ROW}"(.*?)</li>`, "s").exec(html)?.[1] ?? "";
    } finally {
      await panel.stop();
    }
  }

  test("says the row started today, morning and late evening alike", async () => {
    for (const now of ["2099-01-01T00:30:00.000Z", "2099-01-01T23:30:00.000Z"]) {
      const row = await rowAt(now);
      assert.notEqual(row, "", `no row drawn at ${now}`);
      assert.ok(row.includes("since today"), `at ${now} the row did not read as today`);
      assert.equal(
        /\d+h ago/.test(row),
        false,
        `at ${now} the row printed an hour count for a date that carries no hour`,
      );
    }
  });
});
