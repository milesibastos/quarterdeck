import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  ContractIdentifierError,
  parseSnapshot,
  type FleetSnapshot,
} from "../src/adapters/contract.ts";
import { readHealth, type HealthReading } from "../src/adapters/health.ts";
import { projectDocument, withSnapshotUnreadable } from "../src/domain/project.ts";
import { fixedClock } from "../src/providers/clock.ts";
import type { LensStatus, PanelDocument } from "../src/types/document.ts";
import { REPO_ROOT } from "./lib/server.ts";

/**
 * Every fixture set, walked, and the document each one produces, asserted.
 *
 * This is the seam's own test. Several workers build against the document
 * shape at once, so a change to it has to break a test here rather than surface
 * as a lens quietly rendering nothing. The assertions are deliberately about the
 * document rather than about markup: the shape is what is frozen, and the
 * lenses that draw it are somebody else's file.
 */

const FIXTURES = join(REPO_ROOT, "fixtures");

/**
 * Thirty seconds after the fresh sets were generated, inside the sixty-second
 * freshness window and eighty years after the stale set. Pinned, so nothing
 * here races the clock.
 */
const OPTIONS = {
  clock: fixedClock("2099-01-01T09:15:30.000Z"),
  staleAfterMs: 60_000,
};

/**
 * `homes/` holds synthetic fleet homes rather than fixture sets - they have no
 * snapshot, and they are what the quarantined health module reads. Every
 * directory inside it is walked by `tests/health.test.ts`, which carries the
 * same "a fixture nobody checks fails" guard this file does.
 */
const NOT_A_SET = new Set(["homes"]);

function fixtureSets(): string[] {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NOT_A_SET.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function snapshotOf(set: string): FleetSnapshot {
  return parseSnapshot(
    readFileSync(join(FIXTURES, set, "snapshot.json"), "utf8"),
    `fixture:${set}`,
  );
}

function healthOf(set: string): Promise<HealthReading> {
  return readHealth(join(FIXTURES, set), AbortSignal.timeout(5_000));
}

/**
 * The document a set produces, by the same route the runtime takes: parse, and
 * fall back to the unreadable lenses when the snapshot will not parse.
 */
async function documentOf(set: string): Promise<PanelDocument> {
  const health = await healthOf(set);
  try {
    return projectDocument(snapshotOf(set), health, OPTIONS);
  } catch (error) {
    if (error instanceof ContractIdentifierError) throw error;
    return withSnapshotUnreadable(
      null,
      error instanceof Error ? error.message : String(error),
      health,
      OPTIONS,
    );
  }
}

type Shape = {
  readonly fleet: readonly [LensStatus["state"], number];
  readonly deck: readonly [LensStatus["state"], number];
  readonly health: LensStatus["state"];
};

/**
 * One row per set: the status of each lens and how much each carries.
 *
 * `mismatched` is absent on purpose - it refuses rather than producing a
 * document, and is asserted separately below.
 */
const SHAPES: Readonly<Record<string, Shape>> = {
  healthy: { fleet: ["fresh", 11], deck: ["fresh", 4], health: "fresh" },
  empty: { fleet: ["fresh", 0], deck: ["fresh", 0], health: "fresh" },
  stale: { fleet: ["stale", 2], deck: ["stale", 2], health: "stale" },
  malformed: { fleet: ["unreadable", 0], deck: ["unreadable", 0], health: "fresh" },
  "health-dark": { fleet: ["fresh", 3], deck: ["fresh", 3], health: "unreadable" },
  "health-unread": { fleet: ["fresh", 3], deck: ["fresh", 3], health: "fresh" },
  "deck-dark": { fleet: ["fresh", 3], deck: ["unreadable", 0], health: "fresh" },
  "deck-only": { fleet: ["fresh", 0], deck: ["fresh", 4], health: "fresh" },
  "fleet-only": { fleet: ["fresh", 11], deck: ["fresh", 0], health: "fresh" },
  "fleet-empty-stale": { fleet: ["stale", 0], deck: ["stale", 1], health: "stale" },
};

test("every fixture set on disk is walked here", () => {
  assert.deepEqual(fixtureSets(), [...Object.keys(SHAPES), "mismatched"].sort());
});

describe("every fixture set produces the document it should", () => {
  for (const [set, shape] of Object.entries(SHAPES)) {
    test(set, async () => {
      const document = await documentOf(set);
      assert.equal(document.version, 2);
      assert.deepEqual(
        {
          fleet: [document.fleet.status.state, document.fleet.content.length],
          deck: [document.deck.status.state, document.deck.content.length],
          health: document.health.status.state,
        },
        shape,
      );
    });
  }

  test("mismatched refuses instead of producing one", async () => {
    await assert.rejects(() => documentOf("mismatched"), ContractIdentifierError);
  });
});

describe("the fleet part", () => {
  test("carries every coarse stage, and the fine step where one is named", async () => {
    const { content } = (await documentOf("healthy")).fleet;
    assert.deepEqual(
      content.map((w) => `${w.id} ${w.lifecycle.stage} ${w.lifecycle.step ?? "-"}`),
      [
        "wi-tidewater-114 dispatched -",
        "wi-tidewater-118 working -",
        // The two validating shapes: upstream's detail names a step, or it does
        // not. Both arrive in the one read; neither is a "not sharpened yet".
        "wi-lamplight-207 validating -",
        "wi-lamplight-211 validating test",
        "wi-saltmarsh-302 pr-open -",
        "wi-saltmarsh-305 in-review -",
        "wi-cordage-401 landed -",
        "wi-cordage-404 blocked -",
        "wi-tidewater-121 held review",
        "wi-lamplight-215 waiting -",
        "wi-saltmarsh-309 failed lint",
      ],
    );
  });

  test("a worker is the whole shape, not a subset of it", async () => {
    const { content } = (await documentOf("healthy")).fleet;
    assert.deepEqual(content[4], {
      id: "wi-saltmarsh-302",
      project: "saltmarsh",
      kind: "build",
      brief: { ref: "/anchorage/briefs/wi-saltmarsh-302.md", present: true },
      worktree: { ref: "/anchorage/worktrees/wi-saltmarsh-302", present: true },
      lifecycle: {
        stage: "pr-open",
        step: null,
        detail: "pull request opened",
        observedAt: "2099-01-01T09:12:20.000Z",
      },
      pullRequest: {
        url: "https://forge.invalid/saltmarsh/pull/302",
        state: "open",
        // Upstream carries the address but not the checks; see docs/contract.md.
        checks: "unknown",
      },
    });
  });

  test("a landed worker's pull request is landed, and a scout is research", async () => {
    const { content } = (await documentOf("healthy")).fleet;
    assert.equal(content[6].pullRequest?.state, "landed");
    assert.equal(content[5].kind, "research");
    assert.equal(content[10].worktree.present, false, "a worktree can be gone");
  });
});

describe("the deck part", () => {
  test("drops what is done and keeps what is still coming", async () => {
    const { content } = (await documentOf("healthy")).deck;
    assert.deepEqual(
      content.map((item) => `${item.id} ${item.state} ${item.priority}`),
      [
        "wi-lamplight-231 queued now",
        "wi-cordage-412 queued next",
        "wi-tidewater-126 queued next",
        "wi-saltmarsh-318 in-flight later",
      ],
    );
  });

  test("says what an item is blocked by", async () => {
    const { content } = (await documentOf("healthy")).deck;
    assert.deepEqual(content[1].blocked, {
      ids: ["wi-cordage-401"],
      reason: "Waits on the seam landing first",
    });
    assert.equal(content[0].blocked, null, "an unblocked item carries no blocker");
  });

  test("says who a held item waits on, why, since when, and until when", async () => {
    const held = (await documentOf("healthy")).deck.content[2];
    assert.deepEqual(held.hold, {
      waitingOn: "captain",
      reason: "Needs a naming decision",
      deferredTo: "2099-01-04",
    });
    assert.equal(held.since, "2099-01-01T07:20:05.000Z", "the hold's age");
    assert.equal(held.actionable, true, "upstream's own fold, carried not recomputed");
  });
});

describe("the health part", () => {
  test("reports every signal when they read cleanly", async () => {
    const { content } = (await documentOf("stale")).health;
    assert.deepEqual(content.supervisor, {
      read: "ok",
      alive: false,
      lastSeen: "2019-03-04T10:41:00.000Z",
    });
    assert.deepEqual(content.overdue, {
      read: "ok",
      overdue: [{ id: "wi-tidewater-126", waitingSince: "2019-03-04T09:00:00.000Z" }],
    });
    assert.deepEqual(content.drift, {
      read: "ok",
      disagreements: [
        {
          record: "backlog",
          detail: "wi-lamplight-207 is queued here but has a worktree",
        },
      ],
    });
  });

  test("a signal that could not be read says so, one signal at a time", async () => {
    const { content, status } = (await documentOf("health-unread")).health;
    assert.equal(status.state, "fresh", "the file read; its signals did not");
    for (const signal of [content.supervisor, content.overdue, content.drift]) {
      assert.equal(signal.read, "unreadable");
      assert.ok(signal.read === "unreadable" && signal.detail.length > 0);
    }
  });

  test("nothing good is reported as good", async () => {
    const { content } = (await documentOf("healthy")).health;
    assert.deepEqual(content.overdue, { read: "ok", overdue: [] });
    assert.deepEqual(content.drift, { read: "ok", disagreements: [] });
  });
});

describe("degradation is per lens, not per document", () => {
  test("health goes dark while the fleet and deck stay current", async () => {
    const document = await documentOf("health-dark");
    assert.equal(document.fleet.status.state, "fresh");
    assert.equal(document.deck.status.state, "fresh");
    assert.equal(document.health.status.state, "unreadable");
    // Dark means every signal is dark, not that the lens vanished.
    assert.equal(document.health.content.supervisor.read, "unreadable");
  });

  test("the fleet and deck go dark while health stays current", async () => {
    const document = await documentOf("malformed");
    assert.equal(document.fleet.status.state, "unreadable");
    assert.equal(document.deck.status.state, "unreadable");
    assert.equal(document.health.status.state, "fresh");
  });

  test("the deck alone goes dark when upstream could not read the backlog", async () => {
    const document = await documentOf("deck-dark");
    assert.equal(document.fleet.status.state, "fresh");
    assert.equal(document.deck.status.state, "unreadable");
    assert.equal(document.health.status.state, "fresh");
  });

  test("a stale lens says how stale, and keeps its content", async () => {
    const { status, content } = (await documentOf("stale")).fleet;
    assert.equal(status.state, "stale");
    assert.ok(status.state === "stale" && status.ageMs > 60_000);
    assert.ok(status.state === "stale" && status.detail.includes("freshness window"));
    assert.equal(content.length, 2, "stale content is still worth showing");
  });

  test("last known good survives a snapshot that stops parsing", async () => {
    const good = await documentOf("healthy");
    const document = withSnapshotUnreadable(good, "truncated", await healthOf("healthy"), OPTIONS);
    assert.equal(document.fleet.status.state, "unreadable");
    assert.equal(document.fleet.content.length, 11, "the fleet is still on screen");
    assert.equal(document.deck.content.length, 4);
  });
});
