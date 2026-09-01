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
import {
  projectDocument,
  withSnapshotUnreadable,
} from "../src/domain/project.ts";
import { fixedClock } from "../src/providers/clock.ts";
import {
  DOCUMENT_VERSION,
  type LensStatus,
  type OmissionReason,
  type PanelDocument,
} from "../src/types/document.ts";
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
  readonly landed: readonly [LensStatus["state"], number];
  readonly health: LensStatus["state"];
  /** The reason of each omission, in order. Empty means nothing was left out. */
  readonly omissions: readonly OmissionReason[];
};

/**
 * One row per set: the status of each lens and how much each carries.
 *
 * `mismatched` is absent on purpose - it refuses rather than producing a
 * document, and is asserted separately below.
 */
const SHAPES: Readonly<Record<string, Shape>> = {
  healthy: {
    fleet: ["fresh", 12],
    deck: ["fresh", 6],
    landed: ["fresh", 4],
    health: "fresh",
    omissions: ["not-shown", "unreadable", "unreadable"],
  },
  // The large end of the range the layout has to survive; see
  // docs/decisions/2026-08-31-the-fold-line.md.
  crowded: {
    fleet: ["fresh", 30],
    deck: ["fresh", 15],
    landed: ["fresh", 3],
    health: "fresh",
    omissions: ["not-looked-up", "not-looked-up", "not-shown"],
  },
  empty: {
    fleet: ["fresh", 0],
    deck: ["fresh", 0],
    landed: ["fresh", 0],
    health: "fresh",
    omissions: [],
  },
  stale: {
    fleet: ["stale", 2],
    deck: ["stale", 2],
    landed: ["stale", 0],
    health: "stale",
    omissions: [],
  },
  malformed: {
    fleet: ["unreadable", 0],
    deck: ["unreadable", 0],
    landed: ["unreadable", 0],
    health: "fresh",
    omissions: [],
  },
  "health-dark": {
    fleet: ["fresh", 3],
    deck: ["fresh", 3],
    landed: ["fresh", 0],
    health: "unreadable",
    omissions: [],
  },
  "health-unread": {
    fleet: ["fresh", 3],
    deck: ["fresh", 3],
    landed: ["fresh", 0],
    health: "fresh",
    omissions: [],
  },
  "deck-dark": {
    fleet: ["fresh", 3],
    deck: ["unreadable", 0],
    landed: ["unreadable", 1],
    health: "fresh",
    omissions: ["unreadable"],
  },
  "deck-only": {
    fleet: ["fresh", 0],
    deck: ["fresh", 6],
    landed: ["fresh", 1],
    health: "fresh",
    omissions: [],
  },
  "fleet-only": {
    fleet: ["fresh", 12],
    deck: ["fresh", 0],
    landed: ["fresh", 0],
    health: "fresh",
    omissions: ["not-looked-up", "not-looked-up"],
  },
  "fleet-empty-stale": {
    fleet: ["stale", 0],
    deck: ["stale", 1],
    landed: ["stale", 0],
    health: "stale",
    omissions: [],
  },
  // Every rail shape in its working, stopped and finished states, plus the
  // three ways a rail's length can be unknown; see tests/fleet-lens.test.ts.
  rails: {
    fleet: ["fresh", 21],
    deck: ["fresh", 0],
    landed: ["fresh", 0],
    health: "fresh",
    omissions: ["not-looked-up", "not-looked-up"],
  },
  // The one set in upstream's real shape and real vocabulary; its projection is
  // asserted field by field in tests/fleet-source.test.ts.
  "upstream-shape": {
    fleet: ["fresh", 8],
    deck: ["fresh", 5],
    landed: ["fresh", 1],
    health: "fresh",
    omissions: ["not-looked-up", "not-looked-up"],
  },
  // A refusal quoting a 180-character token with no break opportunity in it.
  // The lens statuses are `malformed`'s; what this set is for is the width of
  // the sentence they carry.
  "wide-detail": {
    fleet: ["unreadable", 0],
    deck: ["unreadable", 0],
    landed: ["unreadable", 0],
    health: "fresh",
    omissions: [],
  },
  // Every lens dark at once, with nothing left over to draw: the page with the
  // least on it that the panel can still be asked to render.
  "all-dark": {
    fleet: ["unreadable", 0],
    deck: ["unreadable", 0],
    landed: ["unreadable", 0],
    health: "unreadable",
    omissions: [],
  },
};

test("every fixture set on disk is walked here", () => {
  assert.deepEqual(
    fixtureSets(),
    [...Object.keys(SHAPES), "mismatched"].sort(),
  );
});

describe("every fixture set produces the document it should", () => {
  for (const [set, shape] of Object.entries(SHAPES)) {
    test(set, async () => {
      const document = await documentOf(set);
      // Pinned to the constant rather than to a literal: a bump is a deliberate
      // edit to one place, and every fixture is then re-walked against it.
      assert.equal(document.version, DOCUMENT_VERSION);
      assert.deepEqual(
        {
          fleet: [document.fleet.status.state, document.fleet.content.length],
          deck: [document.deck.status.state, document.deck.content.length],
          landed: [
            document.landed.status.state,
            document.landed.content.length,
          ],
          health: document.health.status.state,
          omissions: document.omissions.map((omission) => omission.reason),
        },
        shape,
      );
    });
  }

  test("mismatched refuses instead of producing one", async () => {
    await assert.rejects(
      () => documentOf("mismatched"),
      ContractIdentifierError,
    );
  });
});

describe("the fleet part", () => {
  test("carries every coarse stage, and the fine step where one is named", async () => {
    const { content } = (await documentOf("healthy")).fleet;
    assert.deepEqual(
      content.map(
        (w) => `${w.id} ${w.lifecycle.stage} ${w.lifecycle.step ?? "-"}`,
      ),
      [
        "wi-tidewater-114 dispatched -",
        "wi-tidewater-118 working -",
        // The two validating shapes: upstream's detail names a step, or it does
        // not. Both arrive in the one read; neither is a "not sharpened yet".
        "wi-lamplight-207 validating -",
        "wi-lamplight-211 validating test",
        "wi-saltmarsh-302 pr-open -",
        // Green and open: the one shape the needs-you band offers a merge on.
        "wi-cordage-406 pr-open -",
        "wi-saltmarsh-305 in-review -",
        "wi-cordage-401 landed -",
        "wi-cordage-404 blocked -",
        "wi-tidewater-121 held review",
        "wi-lamplight-215 waiting -",
        "wi-saltmarsh-309 failed lint",
      ],
    );
  });

  test("a worker the panel cannot see is unseen, not waiting", async () => {
    const { content } = (await documentOf("fleet-only")).fleet;
    const lost = content.find((worker) => worker.id === "wi-brackish-288")!;
    assert.equal(lost.lifecycle.stage, "unseen");
    // The stage the panel used to give it, and the reason this version exists:
    // `waiting` states a position - stopped, on something outside the fleet -
    // that nothing established.
    assert.notEqual(lost.lifecycle.stage, "waiting");
    // Its detail names a pipeline step, and no step is read from it: the words
    // are upstream's account of what it could not see, not a report from a
    // pipeline that ran. Nothing may infer a position from them.
    assert.equal(lost.lifecycle.step, null);
    assert.equal(
      lost.lifecycle.detail,
      "no state source answered; its last line said review",
    );
  });

  test("a worker is the whole shape, not a subset of it", async () => {
    const { content } = (await documentOf("healthy")).fleet;
    assert.deepEqual(content[4], {
      id: "wi-saltmarsh-302",
      project: "saltmarsh",
      kind: "build",
      delivery: "validated",
      brief: {
        ref: "/anchorage/briefs/wi-saltmarsh-302.md",
        present: true,
        summary: null,
        text: null,
      },
      worktree: { ref: "/anchorage/worktrees/wi-saltmarsh-302", present: true },
      dispatch: {
        branch: "crew/saltmarsh-302",
        runtime: "claude",
        model: "opus",
        effort: "high",
      },
      lifecycle: {
        stage: "pr-open",
        step: null,
        lastActiveStage: null,
        detail: "pull request opened",
        observedAt: "2099-01-01T09:12:20.000Z",
      },
      pullRequest: {
        url: "https://forge.invalid/saltmarsh/pull/302",
        state: "open",
        checks: {
          read: "ok",
          outcome: "pending",
          finished: 2,
          total: 5,
          asOf: "2099-01-01T09:14:20.000Z",
        },
        review: { read: "ok", comments: 1, asOf: "2099-01-01T09:14:20.000Z" },
      },
    });
  });

  test("what was recorded at dispatch is carried, and what was not says so", async () => {
    const { content } = (await documentOf("healthy")).fleet;
    const by = (id: string) => content.find((worker) => worker.id === id)!;

    // Nothing recorded at all. Four nulls rather than four guesses: a branch
    // derived from the work item id would be the panel stating where the work
    // is on evidence nobody wrote down.
    assert.deepEqual(by("wi-cordage-404").dispatch, {
      branch: null,
      runtime: null,
      model: null,
      effort: null,
    });
    // Half recorded. Each field answers for itself; one absence does not take
    // the others with it.
    assert.deepEqual(by("wi-tidewater-121").dispatch, {
      branch: "crew/tidewater-121",
      runtime: null,
      model: null,
      effort: null,
    });
  });

  test("a delivery contract nobody recognises draws no rail rather than the wrong one", async () => {
    const { content } = (await documentOf("healthy")).fleet;
    const by = (id: string) => content.find((worker) => worker.id === id)!;

    assert.equal(by("wi-tidewater-114").delivery, "validated");
    assert.equal(by("wi-tidewater-118").delivery, "direct-pr");
    assert.equal(by("wi-lamplight-207").delivery, "local");
    // Upstream said `cargo-cult`. Deliberately not defaulted the way an
    // unrecognised kind is: a wrong kind costs a word, a wrong contract costs a
    // rail with stages the work will never reach.
    assert.equal(by("wi-lamplight-211").delivery, null);
    // A scout is dispatched with no delivery contract at all.
    assert.equal(by("wi-lamplight-215").delivery, null);
  });

  test("the brief carries its text where there is text, and says so where there is not", async () => {
    const { content } = (await documentOf("healthy")).fleet;
    const by = (id: string) => content.find((worker) => worker.id === id)!;

    const full = by("wi-tidewater-114").brief;
    assert.equal(full.summary, "Draw the lifecycle rail.");
    assert.match(full.text!, /hollow ahead of it/);
    // A card with a line to show and nothing behind the click.
    assert.equal(by("wi-tidewater-118").brief.text, null);
    assert.equal(
      by("wi-tidewater-118").brief.summary,
      "Pin the redis image to a digest.",
    );
    // The pointer is still there when neither is.
    assert.deepEqual(by("wi-cordage-404").brief, {
      ref: "/anchorage/briefs/wi-cordage-404.md",
      present: true,
      summary: null,
      text: null,
    });
  });

  test("a forge nobody asked is not a forge that answered", async () => {
    const healthy = (await documentOf("healthy")).fleet.content;
    const by = (id: string) => healthy.find((worker) => worker.id === id)!;

    // Asked, and nobody has commented. The fact this shape exists to keep
    // apart from the one below it.
    assert.deepEqual(by("wi-saltmarsh-305").pullRequest?.review, {
      read: "ok",
      comments: 0,
      asOf: "2099-01-01T09:14:20.000Z",
    });
    assert.deepEqual(by("wi-cordage-401").pullRequest?.checks, {
      read: "ok",
      outcome: "passing",
      finished: 6,
      total: 6,
      asOf: "2099-01-01T09:14:20.000Z",
    });
    // Asked, and the forge could not say.
    assert.equal(by("wi-cordage-401").pullRequest?.review.read, "unreadable");

    // Nobody asked. Not a failure - the forge read is opt-in and off the first
    // paint - and not the same as a green run or an empty review.
    const live = (await documentOf("upstream-shape")).fleet.content;
    const open = live.find((worker) => worker.pullRequest !== null)!;
    assert.deepEqual(open.pullRequest?.checks, { read: "not-looked-up" });
    assert.deepEqual(open.pullRequest?.review, { read: "not-looked-up" });
  });

  test("a landed worker's pull request is landed, and a scout is research", async () => {
    const { content } = (await documentOf("healthy")).fleet;
    assert.equal(content[7].pullRequest?.state, "landed");
    assert.equal(content[10].kind, "research", "the one scout in the set");
    assert.equal(content[11].worktree.present, false, "a worktree can be gone");
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
        "wi-driftwood-540 in-flight now",
        "wi-brackish-277 queued later",
      ],
    );
  });

  test("says what project an item belongs to and whether it is research", async () => {
    const { content } = (await documentOf("healthy")).deck;
    assert.deepEqual(
      content.map(
        (item) => `${item.id} ${item.project ?? "-"} ${item.kind ?? "-"}`,
      ),
      [
        "wi-lamplight-231 lamplight build",
        "wi-cordage-412 cordage build",
        "wi-tidewater-126 tidewater research",
        // A kind this build has never seen is building, the same rule a
        // worker's kind gets and from the same function.
        "wi-saltmarsh-318 saltmarsh build",
        "wi-driftwood-540 driftwood build",
        // The row said neither, and the document says so rather than guessing.
        "wi-brackish-277 - -",
      ],
    );
  });

  test("a record with no start date carries none", async () => {
    const { content } = (await documentOf("healthy")).deck;
    const undated = content.find((item) => item.id === "wi-brackish-277")!;
    // Not the moment upstream looked, which is what it used to be: an item
    // queued a month ago would have read as having just arrived.
    assert.equal(undated.since, null);
    assert.equal(
      content[0].since,
      "2099-01-01T09:10:00.000Z",
      "a row that did say still says",
    );
  });

  test("says what an item is blocked by", async () => {
    const { content } = (await documentOf("healthy")).deck;
    assert.deepEqual(content[1].blocked, {
      ids: ["wi-cordage-401"],
      reason: "Waits on the seam landing first",
    });
    assert.equal(
      content[0].blocked,
      null,
      "an unblocked item carries no blocker",
    );
  });

  test("says who a held item waits on, why, since when, and until when", async () => {
    const held = (await documentOf("healthy")).deck.content[2];
    assert.deepEqual(held.hold, {
      waitingOn: "captain",
      reason: "Needs a naming decision",
      deferredTo: "2099-01-04",
    });
    assert.equal(held.since, "2099-01-01T07:20:05.000Z", "the hold's age");
    assert.equal(
      held.actionable,
      true,
      "upstream's own fold, carried not recomputed",
    );
  });

  test("carries a hold that waits on something other than a person", async () => {
    const { content } = (await documentOf("healthy")).deck;
    const external = content.find((item) => item.id === "wi-brackish-277");
    assert.deepEqual(external?.hold, {
      // Upstream's word, carried rather than folded into a boolean: the panel
      // decides what is answerable from it, and a hold kind it has never heard
      // of must read as unanswerable rather than as a person's to settle.
      waitingOn: "external",
      reason: "Waits on the upstream release",
      deferredTo: null,
    });
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
      overdue: [
        { id: "wi-tidewater-126", waitingSince: "2019-03-04T09:00:00.000Z" },
      ],
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
    for (const signal of [
      content.supervisor,
      content.queue,
      content.attendance,
      content.overdue,
      content.drift,
    ]) {
      assert.equal(signal.read, "unreadable");
      assert.ok(signal.read === "unreadable" && signal.detail.length > 0);
    }
  });

  test("nothing good is reported as good", async () => {
    const { content } = (await documentOf("healthy")).health;
    assert.deepEqual(content.overdue, { read: "ok", overdue: [] });
    assert.deepEqual(content.drift, { read: "ok", disagreements: [] });
  });

  test("the queue is a depth and the attendance is two facts", async () => {
    // A queue that was read and found empty, and a home held with nobody away.
    const healthy = (await documentOf("healthy")).health.content;
    assert.deepEqual(healthy.queue, { read: "ok", queued: 0 });
    assert.deepEqual(healthy.attendance, {
      read: "ok",
      away: false,
      locked: true,
    });

    // A queue that is not draining, and an operator who is away with the home
    // unlocked. Both facts move independently of each other.
    const stale = (await documentOf("stale")).health.content;
    assert.deepEqual(stale.queue, { read: "ok", queued: 4 });
    assert.deepEqual(stale.attendance, {
      read: "ok",
      away: true,
      locked: false,
    });
  });

  test("a health file predating a signal darkens that signal and no other", async () => {
    // `wide-detail`'s health file carries the three original signals and not
    // the two added in version 4. Refusing the whole file over a key that was
    // not invented yet would take three working signals down with the two that
    // are missing, which is the opposite of what this module is for.
    const { content, status } = (await documentOf("wide-detail")).health;
    assert.equal(status.state, "fresh", "the file itself read cleanly");
    assert.equal(content.supervisor.read, "ok");
    assert.equal(content.overdue.read, "ok");
    assert.equal(content.drift.read, "ok");
    assert.equal(content.queue.read, "unreadable");
    assert.equal(content.attendance.read, "unreadable");
  });
});

describe("the landed part", () => {
  test("carries this home's work and a second mate's, told apart", async () => {
    const { content } = (await documentOf("healthy")).landed;
    assert.deepEqual(
      content.map((item) => `${item.id} ${item.where} ${item.home ?? "-"}`),
      [
        "wi-tidewater-109 this-home /anchorage/homes/tidewater",
        "wi-brackish-088 second-mate /anchorage/homes/brackish",
        "wi-brackish-091 second-mate /anchorage/homes/brackish",
        // Upstream carried the record without naming a home. Left null rather
        // than defaulted to the home on screen, which would attribute a second
        // mate's work to the fleet being looked at.
        "wi-driftwood-512 second-mate -",
      ],
    );
  });

  test("a landed item says how it closed, and says nothing where the record did not", async () => {
    const { content } = (await documentOf("healthy")).landed;
    const by = (id: string) => content.find((item) => item.id === id)!;

    assert.deepEqual(by("wi-tidewater-109"), {
      id: "wi-tidewater-109",
      title: "Vendor the display font",
      where: "this-home",
      home: "/anchorage/homes/tidewater",
      project: "tidewater",
      pullRequest: "https://forge.invalid/tidewater/pull/109",
      closedAs: "merged",
      landedOn: "2099-01-01",
    });
    // Reported rather than merged: no pull request, and no date recorded.
    assert.deepEqual(by("wi-brackish-091").pullRequest, null);
    assert.deepEqual(by("wi-brackish-091").closedAs, "reported");
    assert.deepEqual(by("wi-brackish-091").landedOn, null);
    // Upstream's roll-up carries no project per record, so a second mate's
    // landed work names none rather than borrowing the parent home's.
    assert.deepEqual(by("wi-brackish-088").project, null);
  });

  test("the deck keeps what is coming and the landed lens keeps what finished", async () => {
    const document = await documentOf("healthy");
    const deck = new Set(document.deck.content.map((item) => item.id));
    const landed = new Set(document.landed.content.map((item) => item.id));
    assert.ok(landed.has("wi-tidewater-109"));
    assert.ok(!deck.has("wi-tidewater-109"), "a done row is not on the deck");
    assert.equal([...deck].filter((id) => landed.has(id)).length, 0);
  });

  test("a second mate's landed work survives this home's backlog going dark", async () => {
    // A home this panel cannot read says nothing about a home it can. Dropping
    // the mate's work over the parent's unreadable backlog is exactly how a
    // prior board lost it.
    const { content, status } = (await documentOf("deck-dark")).landed;
    assert.equal(
      status.state,
      "unreadable",
      "this home's landed work is gone with the backlog",
    );
    assert.deepEqual(
      content.map((item) => item.id),
      ["wi-kelpwick-031"],
      "a second mate's landed work is still on the page",
    );
  });
});

describe("the omissions", () => {
  test("name what is missing and keep the three reasons apart", async () => {
    const { omissions } = await documentOf("healthy");
    assert.deepEqual(
      omissions.map((omission) => `${omission.reason}: ${omission.what}`),
      [
        // A bound upstream applied - the work exists, it is past the cut.
        "not-shown: landed work in /anchorage/homes/brackish",
        // A home that did not answer.
        "unreadable: landed work in /anchorage/homes/shoalwater",
        // A home that answered without full trust. Not a bound: calling a
        // partial read `not-shown` would make a failure sound deliberate.
        "unreadable: landed work in /anchorage/homes/driftwood",
      ],
    );
    for (const omission of omissions) assert.ok(omission.detail.length > 0);
  });

  test("a forge nobody read is named as not looked up, not as a failure", async () => {
    const { omissions } = await documentOf("upstream-shape");
    assert.deepEqual(
      omissions.map((omission) => omission.reason),
      ["not-looked-up", "not-looked-up"],
    );
    assert.match(omissions[0].what, /pull request checks/);
    assert.match(omissions[1].what, /pull request review comments/);
  });

  test("checks read and a review not looked up are named as separate absences", async () => {
    // wi-windlass-142's checks were read and failed - not looked up at all -
    // while nothing ever read its review. The two forge readings are
    // independent, so a check having been read must not hide the review that
    // was not.
    const { fleet, omissions } = await documentOf("crowded");
    const windlass142 = fleet.content.find(
      (worker) => worker.id === "wi-windlass-142",
    );
    assert.equal(windlass142?.pullRequest?.checks.read, "unreadable");
    assert.equal(windlass142?.pullRequest?.review.read, "not-looked-up");

    const checks = omissions.find(
      (omission) => omission.what === "pull request checks",
    );
    const review = omissions.find(
      (omission) => omission.what === "pull request review comments",
    );
    assert.ok(
      review,
      "the unread review is named even though its checks were read",
    );
    assert.match(
      checks!.detail,
      /1 pull request/,
      "a read-and-failed check does not count as not looked up",
    );
    assert.match(review!.detail, /2 pull requests/);
  });

  test("an unreadable backlog is named, and nothing is silently dropped", async () => {
    const { omissions } = await documentOf("deck-dark");
    assert.deepEqual(
      omissions.map((omission) => omission.reason),
      ["unreadable"],
    );
  });

  test("nothing left out is an empty list rather than a silence", async () => {
    assert.deepEqual((await documentOf("empty")).omissions, []);
  });

  test("every reason has a fixture behind it, and so does a second mate's home", async () => {
    // The bar draws the three reasons apart, so each has to be reachable from a
    // committed set: a reason with no fixture is a reason the next reader
    // cannot see rendered, and the one that would go untested is whichever
    // upstream stopped sending. Landed work from two homes at once is the same
    // rule for the thing prior boards lost - one home's landed list would look
    // exactly like a board that had dropped the other.
    const documents = await Promise.all(Object.keys(SHAPES).map(documentOf));
    const reasons = new Set(
      documents.flatMap(({ omissions }) => omissions.map((o) => o.reason)),
    );
    assert.deepEqual([...reasons].sort(), [
      "not-looked-up",
      "not-shown",
      "unreadable",
    ]);

    const homes = documents.flatMap(({ landed }) =>
      landed.content
        .filter((item) => item.home !== null)
        .map((item) => item.home),
    );
    assert.ok(
      new Set(homes).size > 1,
      "landed work comes from more than one home",
    );
    const wheres = new Set(
      documents.flatMap(({ landed }) => landed.content.map((i) => i.where)),
    );
    assert.deepEqual([...wheres].sort(), ["second-mate", "this-home"]);
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
    assert.ok(
      status.state === "stale" && status.detail.includes("freshness window"),
    );
    assert.equal(content.length, 2, "stale content is still worth showing");
  });

  test("last known good survives a snapshot that stops parsing", async () => {
    const good = await documentOf("healthy");
    const document = withSnapshotUnreadable(
      good,
      "truncated",
      await healthOf("healthy"),
      OPTIONS,
    );
    assert.equal(document.fleet.status.state, "unreadable");
    assert.equal(
      document.fleet.content.length,
      12,
      "the fleet is still on screen",
    );
    assert.equal(document.deck.content.length, 6, "and so is the deck");
  });
});
