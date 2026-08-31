import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { copyFixtures, startPanel, until, type Panel } from "./lib/server.ts";

/**
 * What the fleet lens draws, driven end to end through the built server.
 *
 * The claims here are the ones the lens exists to make: every stage renders and
 * is told apart without reading, the step inside validation is on the card, a
 * worker that stopped says where and why, and a lens that cannot be trusted
 * says so instead of going blank. `panel.test.ts` asserts the shell around it.
 */

const nextPort = portsFor(import.meta.filename);

/** The rendered page, with React's text-node markers removed. */
async function body(panel: Panel, path = "/"): Promise<string> {
  const response = await fetch(`${panel.url}${path}`);
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** One worker's card element, opening tag only, or null when it is absent. */
function card(html: string, id: string): string | null {
  return new RegExp(`<div[^>]*data-worker="${id}"[^>]*>`).exec(html)?.[0] ?? null;
}

function attribute(tag: string, name: string): string | null {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

/** Every stage the fleet-only set puts on screen: the whole vocabulary. */
const EVERY_STAGE = [
  "dispatched",
  "working",
  "validating",
  "pr-open",
  "in-review",
  "landed",
  "blocked",
  "held",
  "waiting",
  "failed",
  "unseen",
] as const;

describe("the lifecycle rail", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "fleet-only" });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("draws every coarse stage and every off-track state", () => {
    for (const stage of EVERY_STAGE) {
      assert.ok(html.includes(`data-stage="${stage}"`), `${stage} should be on screen`);
    }
  });

  test("tells the four off-track states apart without a word being read", () => {
    // Held wants a person, waiting wants nothing from anybody, blocked wants
    // another work item, and only failed is a fault. One colour for all four
    // would hide the only one that is an alarm.
    const accents = new Set(
      ["wi-cordage-404", "wi-tidewater-121", "wi-lamplight-215", "wi-saltmarsh-309"].map((id) => {
        const tag = card(html, id);
        assert.ok(tag, `${id} should be on screen`);
        return /border-l-[a-z]+/.exec(attribute(tag, "class") ?? "")?.[0];
      }),
    );
    assert.equal(accents.size, 4, "four off-track states, four tones");
  });

  test("names the pipeline step a validating worker is on", () => {
    assert.equal(attribute(card(html, "wi-lamplight-211") ?? "", "data-step"), "test");
    assert.ok(
      html.includes("Validating · stage 3, of how many is not known · tests, step 4 of 9"),
      "the step, and how far into the run it is",
    );
  });

  test("says only what it knows when validation names no step", () => {
    assert.equal(attribute(card(html, "wi-lamplight-207") ?? "", "data-step"), "none");
  });

  test("an off-track worker shows the stage it stopped in and why", () => {
    const tag = card(html, "wi-tidewater-121");
    assert.equal(attribute(tag ?? "", "data-stage"), "held");
    // The stage it left the track in, inferred from the step it named, and
    // upstream's own words for why it stopped.
    assert.ok(
      html.includes("Held in validation · stage 3, of how many is not known · code review, step 3 of 9"),
    );
    assert.ok(html.includes("parked at review: 1 finding(s) (ask-user: authority decision)"));
  });

  test("claims no stage for a worker that stopped without naming a step", () => {
    assert.equal(attribute(card(html, "wi-cordage-404") ?? "", "data-step"), "none");
    assert.ok(html.includes("blocked on wi-cordage-401"), "the reason is still there");
    assert.ok(!html.includes("Blocked in validation"), "the document does not say that");
  });

  test("draws a worker it cannot see as unseeable rather than as waiting", () => {
    const tag = card(html, "wi-brackish-288");
    assert.equal(attribute(tag ?? "", "data-stage"), "unseen");
    assert.ok(html.includes("no state source answered"), "upstream's words for what it lost");
    // The failure this stage exists to end: `waiting` is a claim that the
    // worker stopped on something outside the fleet, which nobody established.
    assert.ok(!/data-worker="wi-brackish-288"[^>]*data-stage="waiting"/.test(html));
  });

  test("claims no position on the track for a worker it cannot see", () => {
    // Its detail names a pipeline step. A halted worker's step is what the rail
    // deduces a position from, so a worker the panel cannot see must not be
    // allowed to reach that deduction from words upstream wrote about its own
    // blindness.
    assert.equal(attribute(card(html, "wi-brackish-288") ?? "", "data-step"), "none");
    assert.ok(!html.includes("Unseen in validation"), "the document does not say that");
    assert.ok(html.includes("no state source answered; its last line said review"));
  });

  test("draws a pointer that stopped resolving as broken", () => {
    // The failed worker's worktree has been swept up; a working-looking path
    // would send the operator looking for something that is not there.
    assert.ok(html.includes("line-through"));
    assert.ok(html.includes("gone"));
  });

  test("keeps the instructions available without shouting them", () => {
    assert.ok(html.includes("dispatched with"));
    assert.ok(html.includes("/anchorage/briefs/wi-tidewater-114.md"));
    assert.ok(html.includes("<details"), "one disclosure, closed until asked");
  });

  test("says what a pull request is doing, and that nobody has asked the forge", () => {
    assert.ok(html.includes("pull request open"));
    assert.ok(html.includes("pull request landed"));
    // This set carries no forge readings at all, which is what a live fleet
    // publishes today. Saying nobody asked is the honest rendering of that.
    assert.ok(html.includes("checks not looked up"));
    assert.ok(html.includes("comments not looked up"));
  });
});

/**
 * Four kinds of work, four rails.
 *
 * The rail is drawn from what was recorded when the worker was dispatched - its
 * kind and its delivery contract - so an investigation is never drawn with a
 * pull request stage ahead of it and work that lands locally is never drawn
 * with a review. The `rails` set carries every shape in its working, stopped
 * and finished states, plus the two rails whose length nobody knows.
 *
 * The claims are made against the words rather than the pips throughout. The
 * pips are decoration and are hidden from assistive technology; everything the
 * shape says has to be in the sentence underneath, and asserting on the
 * sentence is what keeps that true.
 */
describe("the rail a worker's own work has", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "rails" });
    html = await body(panel);
  });
  after(() => panel.stop());

  /** One card's rail: its shape, what was drawn, and the words underneath. */
  function rail(id: string) {
    const start = html.indexOf(`data-worker="${id}"`);
    assert.notEqual(start, -1, `${id} should be on screen`);
    const next = html.indexOf('data-worker="', start + 1);
    const card = html.slice(start, next === -1 ? undefined : next);
    // From the rail's own element to the card's next paragraph, which is
    // upstream's raw detail and sits outside the rail.
    const from = card.indexOf("data-rail=");
    const block = card.slice(from, card.indexOf("wrap-anywhere", from));
    const words = [...block.matchAll(/<p class="text-xs[^"]*">([^<]*)<\/p>/g)].map((m) => m[1]);
    return {
      shape: /data-rail="([^"]*)"/.exec(block)?.[1] ?? null,
      stages: /data-stages="([^"]*)"/.exec(block)?.[1] ?? null,
      /** Every segment on the track, including the open end when there is one. */
      segments: (block.match(/flex-1 rounded-full/g) ?? []).length,
      openEnd: block.includes("border-dashed"),
      hidden: block.includes('aria-hidden="true"'),
      line: words[0] ?? "",
      note: words[1] ?? null,
    };
  }

  test("draws the shape the worker's own kind and contract describe", () => {
    assert.deepEqual(
      ["wi-tidewater-601", "wi-lamplight-604", "wi-saltmarsh-607", "wi-cordage-610"].map((id) => {
        const { shape, stages } = rail(id);
        return `${shape}/${stages}`;
      }),
      ["validated/6", "direct-pr/5", "local/4", "research/3"],
      "four kinds of work, four lengths",
    );
  });

  test("never draws a stage the work cannot reach", () => {
    // The whole point. A worker delivering straight to a pull request has no
    // validation stage, one that stays local has neither pull request stage,
    // and an investigation has none of the three - so each rail is exactly as
    // long as its own stages and no segment stands for one it will never see.
    for (const id of [
      "wi-tidewater-601",
      "wi-tidewater-602",
      "wi-tidewater-603",
      "wi-lamplight-604",
      "wi-lamplight-605",
      "wi-lamplight-606",
      "wi-saltmarsh-607",
      "wi-saltmarsh-608",
      "wi-saltmarsh-609",
      "wi-cordage-610",
      "wi-cordage-611",
      "wi-cordage-612",
    ]) {
      const { stages, segments, openEnd } = rail(id);
      assert.equal(segments, Number(stages), `${id} draws one segment per stage it has`);
      assert.ok(!openEnd, `${id} knows where its rail ends`);
    }
  });

  test("finished work on a short rail reads as finished", () => {
    // Three of three is done. The same three lit segments under a six-stage
    // rail would be a worker halfway through, and an operator reading the
    // column has to be able to tell those apart without opening anything.
    assert.equal(rail("wi-cordage-612").line, "Landed · stage 3 of 3, the last of this rail");
    assert.equal(rail("wi-saltmarsh-609").line, "Landed · stage 4 of 4, the last of this rail");
    assert.equal(rail("wi-lamplight-606").line, "Landed · stage 5 of 5, the last of this rail");
    assert.equal(rail("wi-tidewater-603").line, "Landed · stage 6 of 6, the last of this rail");
    assert.ok(!rail("wi-cordage-612").line.includes("of 6"), "not three sixths of the way");
  });

  test("a stop lands on a named step of the rail the worker is actually on", () => {
    // The same stop, at the same step of the same pipeline, on two rails of
    // different lengths. Its position is read against its own rail, so the
    // marker stays pinned to the step rather than to an index of a fixed track.
    assert.equal(
      rail("wi-tidewater-602").line,
      "Held in validation · stage 3 of 6 · code review, step 3 of 9",
    );
    assert.equal(
      rail("wi-saltmarsh-608").line,
      "Held in validation · stage 3 of 4 · code review, step 3 of 9",
    );
  });

  test("draws no shape at all rather than assuming the longest rail", () => {
    // Nothing recorded means nothing known about how much is left. Drawing the
    // six-stage rail would tell an operator this work has three stages still to
    // come, which nobody established.
    const working = rail("wi-windlass-613");
    assert.equal(working.shape, "unknown");
    assert.equal(working.stages, "unknown");
    assert.ok(working.openEnd, "an open end rather than stages nobody promised");
    assert.equal(working.segments, 3, "how far it got, and the open end - nothing ahead");
    assert.equal(working.line, "Working · stage 2, of how many is not known");
    assert.equal(
      working.note,
      "No delivery contract was recorded, so how many stages this work has is not known.",
    );
    // The deduction that places a stop still works here: the track it is drawn
    // along is the longest one, which has a validating stage to land on.
    assert.ok(rail("wi-windlass-614").line.includes("code review, step 3 of 9"));
  });

  test("says which record does not fit when the stage is off the recorded rail", () => {
    // An investigation standing on a pull request. Upstream's reconciled stage
    // is the stronger witness, so the recorded shape is dropped - and the
    // sentence names the shape that was recorded rather than leaving the
    // operator to guess which of the two facts disagreed.
    const { shape, note } = rail("wi-halyard-616");
    assert.equal(shape, "unknown");
    assert.equal(
      note,
      "Recorded as an investigation, but that rail has no room for the stage observed, so how many stages this work has is not known.",
    );
  });

  test("does not frame a step as a pipeline the contract says was skipped", () => {
    // A word read out of prose must not overrule a contract that was written
    // down: the rail stays the one that was recorded, and the panel simply
    // declines to place the stop or to number the step out of nine.
    const { shape, line } = rail("wi-halyard-617");
    assert.equal(shape, "direct-pr", "the recorded rail survives a prose step");
    assert.equal(line, "Held", "no position claimed, and no validation claimed either");
    assert.ok(!line.includes("in validation"));
    assert.ok(!line.includes("step 3 of 9"));
    // Upstream's own words are on that card regardless, so nothing is lost.
    // Scoped to the card: three workers in this set stopped with the same
    // detail, and the whole page would say yes whichever one dropped it.
    const start = html.indexOf('data-worker="wi-halyard-617"');
    const card = html.slice(start, html.indexOf('data-worker="', start + 1));
    assert.ok(card.includes("parked at review: 1 finding(s) (ask-user: authority decision)"));
  });

  test("keeps the rail's meaning in words rather than only in shape and colour", () => {
    // The track is hidden from assistive technology on purpose. Everything it
    // says - which rail, how far along, and whether that is the end of it - has
    // to be in the sentence, on every shape.
    for (const id of ["wi-tidewater-601", "wi-lamplight-604", "wi-saltmarsh-607", "wi-cordage-610"]) {
      const { hidden, line } = rail(id);
      assert.ok(hidden, `${id} draws its track as decoration`);
      assert.match(line, /stage \d+ of \d+/, `${id} says where it is in words`);
    }
    for (const id of ["wi-windlass-613", "wi-halyard-616"]) {
      assert.ok(rail(id).note?.includes("is not known"), `${id} says the shape is unknown`);
    }
  });
});

/**
 * What the card says about where the work is, what it was told to do, and what
 * its pull request is doing.
 *
 * Driven against `healthy`, which is the set that carries every one of those
 * fields in every state it can hold - recorded and not recorded, a brief with
 * its text and one with only a summary, and all three forge readings.
 */
describe("the worker card", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "healthy" });
    html = await body(panel);
  });
  after(() => panel.stop());

  /** One worker's card, from its opening tag to the start of the next one. */
  function block(id: string): string {
    const start = html.indexOf(`data-worker="${id}"`);
    assert.notEqual(start, -1, `${id} should be on screen`);
    const next = html.indexOf('data-worker="', start + 1);
    return html.slice(start, next === -1 ? undefined : next);
  }

  test("shows where the work physically is and what is doing it", () => {
    const card = block("wi-tidewater-114");
    for (const value of ["crew/tidewater-114", "claude", "opus", "high"]) {
      assert.ok(card.includes(value), `${value} should be on the card`);
    }
    assert.ok(card.includes("/anchorage/worktrees/wi-tidewater-114"), "the isolated copy");
  });

  test("says a dispatch field was not recorded rather than leaving a gap", () => {
    // Upstream recorded nothing at all for this worker. Four labels with no
    // values would read as "no branch, no model" - which is a claim about the
    // work rather than about what was written down.
    const card = block("wi-cordage-404");
    for (const label of ["branch", "runtime", "model", "effort"]) {
      assert.ok(card.includes(label), `${label} should still be named`);
    }
    // Matched as a whole text node, so the brief's own absence - which is a
    // sentence containing the same words - is not counted as a fifth field.
    assert.equal(
      (card.match(/>not recorded</g) ?? []).length,
      4,
      "every absence stated, none of them skipped",
    );
    assert.ok(card.includes("instructions not recorded"), "and the brief says its own");
  });

  test("draws a recorded field and an unrecorded one differently on the same card", () => {
    // A branch and nothing else: the card has to distinguish the two halves,
    // not fall back to one treatment for the whole row.
    const card = block("wi-tidewater-121");
    assert.ok(card.includes("crew/tidewater-121"));
    assert.equal((card.match(/>not recorded</g) ?? []).length, 3, "runtime, model and effort");
  });

  test("puts the instructions on the card and the full text one click away", () => {
    const card = block("wi-tidewater-114");
    assert.ok(card.includes("Draw the lifecycle rail."), "the summary, unopened");
    assert.ok(
      card.includes("Do not invent a percentage: the shape of the rail is the progress."),
      "the full instructions, behind the one disclosure",
    );
    assert.ok(card.includes("<details"), "which is a click, not a navigation");
  });

  test("a summary with nothing behind it is drawn as ordinary, not as broken", () => {
    const card = block("wi-tidewater-118");
    assert.ok(card.includes("Pin the redis image to a digest."));
    assert.ok(card.includes("The instructions themselves were not recorded"));
    assert.ok(card.includes("/anchorage/briefs/wi-tidewater-118.md"), "the pointer is still there");
  });

  test("says so when no instructions were recorded at all", () => {
    assert.ok(block("wi-lamplight-207").includes("instructions not recorded"));
  });

  test("draws the pull request block only where there is a pull request", () => {
    assert.ok(block("wi-saltmarsh-302").includes("data-pull-request="));
    // Nothing about a pull request on a worker that has not opened one: an
    // empty block would say one is missing.
    assert.ok(!block("wi-tidewater-114").includes("data-pull-request="));
  });

  test("carries the whole address, not a word standing in for it", () => {
    assert.ok(
      block("wi-saltmarsh-302").includes("https://forge.invalid/saltmarsh/pull/302"),
      "which repository and which number, readable without opening it",
    );
  });

  test("shows how far the checks have got and what they came out as", () => {
    assert.ok(block("wi-saltmarsh-302").includes("2 of 5 checks · pending"));
    assert.ok(block("wi-saltmarsh-305").includes("5 of 5 checks · failing"));
    assert.ok(block("wi-cordage-401").includes("6 of 6 checks · passing"));
  });

  test("says whether a person has commented, and how many", () => {
    assert.ok(block("wi-saltmarsh-302").includes("1 comment from a person"));
  });

  test("never draws a forge nobody asked as a forge that answered", () => {
    // The distinction the document's three-armed signals exist for. A forge
    // that answered "nobody has commented" tells the operator they are not
    // holding anybody up; a forge nobody asked tells them nothing at all.
    assert.ok(block("wi-saltmarsh-305").includes("nobody has commented"));
    assert.ok(!block("wi-saltmarsh-305").includes("comments not looked up"));
    assert.ok(block("wi-cordage-401").includes("comments unreadable"));
    assert.ok(block("wi-cordage-401").includes("The forge refused the review listing."));
  });
});

describe("a fleet that cannot be trusted", () => {
  test("shows the last good picture with its age when the read went stale", async () => {
    const panel = await startPanel({
      port: nextPort(),
      fixtureSet: "stale",
      // Long after the snapshot was generated, pinned so this never races.
      now: "2019-03-05T11:00:00.000Z",
    });
    try {
      const html = await body(panel);
      assert.ok(html.includes("Last good picture, taken"), "the age, not just the policy");
      assert.equal((html.match(/data-worker="/g) ?? []).length, 2, "and the picture itself");
    } finally {
      await panel.stop();
    }
  });

  test("says the read failed rather than dating the content from it", async () => {
    const fixtureRoot = await copyFixtures();
    const panel = await startPanel({ port: nextPort(), fixtureSet: "healthy", fixtureRoot });
    try {
      await body(panel);
      await writeFile(
        join(fixtureRoot, "healthy", "snapshot.json"),
        '{ "schema": "fm-fleet-snapshot.v1", "generated_at": "2099-01-01T09:15',
      );
      const html = await until(
        () => body(panel),
        (text) => text.includes("Last good picture, still on screen"),
      );
      assert.equal((html.match(/data-worker="/g) ?? []).length, 12, "the fleet is still there");
    } finally {
      await panel.stop();
    }
  });

  test("says there is nothing to show when a failed read has nothing behind it", async () => {
    // The malformed set never parses, so there is no earlier picture to keep.
    const panel = await startPanel({ port: nextPort(), fixtureSet: "malformed" });
    try {
      const html = await body(panel);
      assert.ok(html.includes("Nothing to show"));
      assert.ok(!html.includes("No workers under way"), "an unread fleet is not an empty one");
    } finally {
      await panel.stop();
    }
  });

  test("shows the last good picture's age even when that picture is empty", async () => {
    const panel = await startPanel({
      port: nextPort(),
      fixtureSet: "fleet-empty-stale",
      // Long after the snapshot was generated, pinned so this never races.
      now: "2019-03-05T11:00:00.000Z",
    });
    try {
      const html = await body(panel);
      assert.ok(html.includes("Last good picture, taken"), "a stale empty fleet still ages");
      assert.ok(html.includes("No workers under way"));
      assert.ok(!html.includes("read cleanly"), "a stale read is not a clean one");
    } finally {
      await panel.stop();
    }
  });
});

/**
 * The one forge state `healthy` does not carry: a checks block that was asked
 * for and could not be answered.
 *
 * `crowded` is where it lives, on a pull request whose review nobody asked
 * about at all - which puts both halves of the distinction on one card, and is
 * why this is asserted here rather than folded into the suite above.
 */
describe("a forge that could not answer", () => {
  test("says the checks were unreadable, and the comments unasked, on one card", async () => {
    const panel = await startPanel({ port: nextPort(), fixtureSet: "crowded" });
    try {
      const html = await body(panel);
      const start = html.indexOf('data-worker="wi-windlass-142"');
      assert.notEqual(start, -1);
      const card = html.slice(start, html.indexOf('data-worker="', start + 1));

      assert.ok(card.includes("checks unreadable"));
      assert.ok(card.includes("The forge timed out on the check run."), "and what failed");
      // The other half, on the same pull request: a read that failed and a read
      // nobody did are two different facts and both are on screen.
      assert.ok(card.includes("comments not looked up"));
      assert.ok(!card.includes("checks not looked up"), "the checks were asked for");
    } finally {
      await panel.stop();
    }
  });
});

/**
 * The forge read, driven through the built server against a `gh` that is a
 * shell script on the panel's own `PATH`.
 *
 * `tests/forge.test.ts` proves the cost rule against a stub. This proves the
 * part a stub cannot: that the panel really starts the command, really reads
 * what it prints, and - the claim the whole feature turns on - really starts
 * nothing at all until the operator has asked for it.
 *
 * The clock is not pinned here on purpose. The floor is a minute of real time,
 * the whole file runs in a fraction of it, and that is exactly what makes "the
 * count did not move" a statement about the floor rather than about a fixture.
 */
describe("reading the forge", () => {
  /** A `gh` that records the address it was asked about and answers the query. */
  async function fakeForge(): Promise<{ dir: string; log: string }> {
    const dir = await mkdtemp(join(tmpdir(), "quarterdeck-forge-"));
    const log = join(dir, "asked.log");
    const command = join(dir, "gh");
    await writeFile(
      command,
      [
        "#!/bin/sh",
        // One line per address asked about, which is what the floor is counted in.
        'for arg in "$@"; do',
        '  case "$arg" in url=*) echo "${arg#url=}" >> "$QUARTERDECK_TEST_FORGE_LOG" ;; esac',
        "done",
        "cat <<'JSON'",
        '{"data":{"resource":{',
        '  "__typename":"PullRequest",',
        '  "comments":{"totalCount":1,"nodes":[{"author":{"__typename":"User"}}]},',
        '  "reviews":{"totalCount":0,"nodes":[]},',
        '  "commits":{"nodes":[{"commit":{"statusCheckRollup":',
        '    {"state":"SUCCESS","contexts":{"totalCount":4,"nodes":[',
        '      {"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"},',
        '      {"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"},',
        '      {"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"},',
        '      {"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"}',
        '    ]}}}}]}',
        "}}}",
        "JSON",
        "",
      ].join("\n"),
    );
    await chmod(command, 0o755);
    return { dir, log };
  }

  /** How many addresses the fake forge has been asked about. */
  async function asked(log: string): Promise<string[]> {
    const text = await readFile(log, "utf8").catch(() => "");
    return text.split("\n").filter((line) => line.length > 0);
  }

  function withForgeOnPath(dir: string): Record<string, string> {
    return { PATH: `${dir}:${process.env.PATH ?? ""}`, QUARTERDECK_TEST_FORGE_LOG: join(dir, "asked.log") };
  }

  test("asks nothing, and says nobody asked, until the operator opts in", async () => {
    const { dir, log } = await fakeForge();
    const panel = await startPanel({
      port: nextPort(),
      fixtureSet: "fleet-only",
      // The forge is right there on the path and reachable. What is missing is
      // the operator having said so.
      env: withForgeOnPath(dir),
    });
    try {
      const html = await body(panel);
      assert.ok(html.includes("checks not looked up"));
      assert.ok(html.includes("comments not looked up"));
      assert.deepEqual(await asked(log), [], "the first paint costs no network call");
    } finally {
      await panel.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reads once per pull request, and no more than that in a minute", async () => {
    const { dir, log } = await fakeForge();
    const panel = await startPanel({
      port: nextPort(),
      fixtureSet: "fleet-only",
      env: { ...withForgeOnPath(dir), QUARTERDECK_READ_FORGE: "1" },
    });
    try {
      // The first render is served before anything is asked - the read is
      // scheduled behind it - so the readings arrive on a later one.
      const html = await until(
        () => body(panel),
        (text) => text.includes("4 of 4 checks · passing"),
      );
      assert.ok(html.includes("1 comment from a person"));

      // The three pull requests this set carries, and nothing else: the nine
      // workers without one are never asked about.
      const first = await asked(log);
      assert.equal(first.length, 3);
      assert.equal(new Set(first).size, 3, "one call per address");

      // Ten more renders inside the same minute. The floor is what stops each
      // of them turning into another three calls.
      for (let i = 0; i < 10; i++) await body(panel);
      assert.deepEqual(await asked(log), first, "the floor held");
    } finally {
      await panel.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
