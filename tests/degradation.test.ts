import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { copyFixtures, startPanel, until, type Panel } from "./lib/server.ts";

/**
 * Every degraded state the panel can actually be in, one page at a time.
 *
 * ## Which combinations exist
 *
 * The three lenses do not degrade independently. Fleet and deck come from one
 * snapshot and share its `generated`, so `freshness` gives them the same answer
 * every time - a fresh fleet beside a stale deck is not a state the projection
 * can produce. What the deck can do on its own is go dark, because upstream
 * reports whether it could read the backlog separately from the rest.
 *
 * That leaves five shapes for the pair, and health multiplies each by three
 * because it is a different reader with a different promise:
 *
 *     fleet/deck:  fresh+fresh  stale+stale  fresh+dark  stale+dark  dark+dark
 *     health:      fresh        stale        dark
 *
 * Fifteen pages, and this file walks all fifteen through the built server. The
 * important one is `fresh+fresh` beside a dark health lens - shipshape failing
 * alone is designed behaviour, not a fault, and the whole per-lens status
 * exists to express it. See `docs/decisions/2026-08-30-the-document-seam.md`.
 *
 * ## Why one panel and a mutable fixture root
 *
 * A committed fixture set per cell would be fifteen near-identical directories
 * whose only difference is a timestamp, and `fixtures/README.md` would have to
 * describe six of them as "the same as the one above, but the health file is
 * older". So the cells are composed here instead, from the shape each of them
 * actually is: an old `generated`, a `backlog.present` of false, a truncated
 * file, an absent health file. The committed sets stay what an operator can
 * point the panel at and look at; see `wide-detail` and `all-dark`.
 */

const nextPort = portsFor(import.meta.filename);

/** Pinned, so staleness is a fact about the fixture rather than a race. */
const NOW = "2099-01-01T09:15:30.000Z";
const STALE_AFTER_MS = 60_000;

/** Thirty seconds before `NOW`, which is inside the window. */
const CURRENT = "2099-01-01T09:15:00.000Z";
/** An hour and a quarter before it, which is not. */
const LONG_AGO = "2099-01-01T08:00:00.000Z";

/** What the snapshot half of the document can be. */
type SnapshotShape =
  | "fresh"
  | "stale"
  | "deck-dark"
  | "stale-deck-dark"
  | "dark";
/** What the health half can be, independently. */
type HealthShape = "fresh" | "stale" | "dark";

/** The three lens statuses a cell should produce, in the shell's order. */
type Statuses = readonly [fleet: string, deck: string, health: string];

const SNAPSHOT_STATUSES: Readonly<
  Record<SnapshotShape, readonly [string, string]>
> = {
  fresh: ["fresh", "fresh"],
  stale: ["stale", "stale"],
  "deck-dark": ["fresh", "unreadable"],
  "stale-deck-dark": ["stale", "unreadable"],
  dark: ["unreadable", "unreadable"],
};

/** A health shape names how the file is written; this is what it renders as. */
const HEALTH_STATUS: Readonly<Record<HealthShape, string>> = {
  fresh: "fresh",
  stale: "stale",
  dark: "unreadable",
};

const SET = "healthy";

function paths(root: string): { snapshot: string; health: string } {
  return {
    snapshot: join(root, SET, "snapshot.json"),
    health: join(root, SET, "health.json"),
  };
}

/**
 * Rewrite the copied fixture into the cell under test.
 *
 * Both files are written from the committed set every time rather than patched
 * in place, so no cell inherits the previous one's edits.
 */
async function compose(
  root: string,
  original: { snapshot: string; health: string },
  snapshot: SnapshotShape,
  health: HealthShape,
): Promise<void> {
  const file = paths(root);

  if (snapshot === "dark") {
    // Truncated mid-string: valid enough to name its schema, not enough to parse.
    await writeFile(file.snapshot, original.snapshot.slice(0, 90));
  } else {
    const parsed = JSON.parse(original.snapshot) as {
      generated: string;
      backlog: { present: boolean };
    };
    parsed.generated =
      snapshot === "stale" || snapshot === "stale-deck-dark"
        ? LONG_AGO
        : CURRENT;
    parsed.backlog.present = !snapshot.endsWith("deck-dark");
    await writeFile(file.snapshot, JSON.stringify(parsed, null, 2));
  }

  if (health === "dark") {
    await rm(file.health, { force: true });
  } else {
    const parsed = JSON.parse(original.health) as { asOf: string };
    parsed.asOf = health === "stale" ? LONG_AGO : CURRENT;
    await writeFile(file.health, JSON.stringify(parsed, null, 2));
  }
}

/** The status the shell put on one lens, or null when that lens is absent. */
function lensStatus(html: string, name: string): string | null {
  return (
    new RegExp(`data-lens="${name}" data-lens-status="([a-z]+)"`).exec(
      html,
    )?.[1] ?? null
  );
}

function statuses(html: string): Statuses {
  return ["fleet", "deck", "health"].map((name) =>
    lensStatus(html, name === "health" ? "shipshape" : name),
  ) as unknown as Statuses;
}

describe("every combination of degraded lenses the panel can reach", () => {
  let panel: Panel;
  let original: { snapshot: string; health: string };

  before(async () => {
    const fixtureRoot = await copyFixtures();
    const file = paths(fixtureRoot);
    original = {
      snapshot: await readFile(file.snapshot, "utf8"),
      health: await readFile(file.health, "utf8"),
    };
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: SET,
      fixtureRoot,
      now: NOW,
      staleAfterMs: STALE_AFTER_MS,
    });
  });
  after(() => panel.stop());

  const SNAPSHOTS: readonly SnapshotShape[] = [
    "fresh",
    "stale",
    "deck-dark",
    "stale-deck-dark",
    "dark",
  ];
  const HEALTHS: readonly HealthShape[] = ["fresh", "stale", "dark"];

  for (const snapshot of SNAPSHOTS) {
    for (const health of HEALTHS) {
      test(`snapshot ${snapshot}, health ${health}`, async () => {
        await compose(panel.fixtureRoot, original, snapshot, health);
        const want: Statuses = [
          ...SNAPSHOT_STATUSES[snapshot],
          HEALTH_STATUS[health],
        ] as unknown as Statuses;

        const html = await until(
          async () =>
            (await (await fetch(panel.url)).text()).replaceAll("<!-- -->", ""),
          (text) => statuses(text).join(",") === want.join(","),
        );

        assert.deepEqual(statuses(html), want);
        // Three lens frames, whatever any of them is able to say. A degraded
        // panel is still the same instrument, not a page of error boxes: every
        // lens keeps its name, its trust word and its place in the row.
        for (const name of ["fleet", "deck", "shipshape"]) {
          assert.ok(
            html.includes(`data-lens="${name}"`),
            `${name} should still be framed when snapshot is ${snapshot} and health is ${health}`,
          );
        }
        assert.ok(
          html.includes("Quarterdeck"),
          "and the page is still the panel",
        );
      });
    }
  }
});

describe("what the projection cannot produce", () => {
  test("the deck is never fresher than the fleet", () => {
    // Not a runtime check but the reason the walk above has five snapshot
    // shapes rather than nine: both lenses read their freshness from the one
    // `generated` the snapshot carries, so the pair moves together. The deck's
    // extra state is upstream saying it could not read the backlog, which says
    // nothing about the fleet beside it.
    for (const [fleet, deck] of Object.values(SNAPSHOT_STATUSES)) {
      if (deck === "fresh") assert.equal(fleet, "fresh");
      if (fleet === "unreadable") assert.equal(deck, "unreadable");
    }
  });
});
