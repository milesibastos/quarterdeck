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
      html.includes("Validating · tests, step 4 of 9"),
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
    assert.ok(html.includes("Held in validation · code review, step 3 of 9"));
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
      assert.equal((html.match(/data-worker="/g) ?? []).length, 11, "the fleet is still there");
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
