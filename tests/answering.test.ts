import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { SESSION_HEADER } from "../src/runtime/session.ts";
import { REPO_ROOT, startPanel, testPort, type Panel } from "./lib/server.ts";

/**
 * Answering a held decision, against the built server.
 *
 * The property under test is not "the answer worked" - this panel cannot know
 * that. It is that answering produces exactly one durable record in exactly the
 * shape the fleet's keyed-answer intake reads, that answering twice produces
 * nothing further, and that the panel says only what it has established.
 *
 * Nothing here runs a fleet command, and nothing in the panel can: the record
 * is the whole of the panel's side. What happens next is the fleet's, and it
 * re-verifies the decision is still open before acting - which is why none of
 * these tests expect the panel to filter a stale answer out.
 */

/** The deck's three held items, from the `healthy` fixture set. */
const ANSWERABLE = { id: "wi-tidewater-126", since: "2099-01-01T07:20:05.000Z" };
const ANSWERABLE_IN_FLIGHT = "wi-driftwood-540";
const HELD_BY_SOMETHING_ELSE = "wi-brackish-277";
const NOT_HELD = "wi-lamplight-231";

async function spoolDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "quarterdeck-intents-"));
}

/** Every record in the spool, name and content, in a stable order. */
async function spool(dir: string): Promise<[string, string][]> {
  const names = (await readdir(dir)).sort();
  return Promise.all(
    names.map(async (name): Promise<[string, string]> => [
      name,
      await readFile(join(dir, name), "utf8"),
    ]),
  );
}

async function html(panel: Panel): Promise<string> {
  return (await fetch(panel.url)).text();
}

/**
 * The secret the page carries, which is also the proof it carries one.
 *
 * It reaches the browser in the server-rendered payload; the security baseline
 * named getting it there as part of the write path. What keeps it safe is the
 * front door, and `security.test.ts` holds that.
 */
function secretFrom(page: string): string {
  const match = /\\?"secret\\?":\\?"([A-Za-z0-9_-]{20,})\\?"/.exec(page);
  assert.ok(match, "the page carries the session secret once a spool is configured");
  return match[1];
}

/** One answer, posted the way the control posts it. */
async function answer(
  panel: Panel,
  secret: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${panel.url}/api/act/answer-decision`, {
    method: "POST",
    headers: { "content-type": "application/json", [SESSION_HEADER]: secret },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("the answer control in the deck", () => {
  let panel: Panel;
  let dir: string;
  before(async () => {
    dir = await spoolDir();
    panel = await startPanel({
      port: testPort(30),
      fixtureSet: "healthy",
      env: { QUARTERDECK_INTENT_DIR: dir },
    });
  });
  after(async () => {
    await panel.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("offers the control on work held for a person", async () => {
    const page = await html(panel);
    assert.ok(page.includes(`data-answer-control="${ANSWERABLE.id}"`));
    assert.ok(
      page.includes(`data-answer-control="${ANSWERABLE_IN_FLIGHT}"`),
      "a deferred hold and an undeferred one are both answerable",
    );
  });

  test("offers no control on a hold that waits on something else", async () => {
    const page = await html(panel);
    assert.ok(
      !page.includes(`data-answer-control="${HELD_BY_SOMETHING_ELSE}"`),
      "an external hold is not a question anyone can answer here",
    );
    assert.ok(
      page.includes(`data-deck-item="${HELD_BY_SOMETHING_ELSE}"`),
      "it is still drawn - it is just not answerable",
    );
  });

  test("offers no control on work that is not held at all", async () => {
    const page = await html(panel);
    assert.ok(!page.includes(`data-answer-control="${NOT_HELD}"`));
  });

  test("declares both of the fleet's close modes and invents neither", async () => {
    const page = await html(panel);
    assert.ok(page.includes('data-close-mode="done"'));
    assert.ok(page.includes('data-close-mode="release"'));
    assert.ok(page.includes("completes this item"), "what each close does, on the card");
    assert.ok(page.includes("lifts the hold so the work resumes"));
  });
});

describe("recording an answer", () => {
  let panel: Panel;
  let dir: string;
  let secret: string;
  before(async () => {
    dir = await spoolDir();
    panel = await startPanel({
      port: testPort(31),
      fixtureSet: "healthy",
      env: { QUARTERDECK_INTENT_DIR: dir },
    });
    secret = secretFrom(await html(panel));
  });
  after(async () => {
    await panel.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("writes exactly the keyed line the intake reads, and nothing else", async () => {
    const result = await answer(panel, secret, {
      taskId: ANSWERABLE.id,
      since: ANSWERABLE.since,
      answer: "Call it a hold, not a park.",
      label: "Answer and close",
      mode: "done",
    });
    assert.equal(result.status, 200);

    const records = await spool(dir);
    assert.equal(records.length, 1, "one answer, one record");
    const [name, content] = records[0];
    assert.match(name, /^[0-9a-f]{32}\.keyed-answer-v1$/, "named by the request identity");
    // `<task-id>\t<answer>\t<label>\t<mode>` and one newline. The key IS the
    // task id: no mapping, no derived identity, no second line for the intake
    // to read as a bogus key.
    assert.equal(
      content,
      "wi-tidewater-126\tCall it a hold, not a park.\tAnswer and close\tdone\n",
    );
  });

  test("carries the close mode the card declared, unchanged", async () => {
    const result = await answer(panel, secret, {
      taskId: ANSWERABLE_IN_FLIGHT,
      since: "2099-01-01T09:35:00.000Z",
      answer: "Take the second layout.",
      label: "Answer and resume",
      mode: "release",
    });
    assert.equal(result.status, 200);
    const records = await spool(dir);
    const released = records.find(([, content]) => content.includes(ANSWERABLE_IN_FLIGHT));
    assert.ok(released);
    assert.ok(
      released[1].endsWith("\trelease\n"),
      "release, because that is the button that was pressed",
    );
  });

  test("says the answer was recorded, and never that the decision is closed", async () => {
    const result = await answer(panel, secret, {
      taskId: ANSWERABLE.id,
      since: ANSWERABLE.since,
      answer: "A second, different answer.",
      label: "Answer and close",
      mode: "done",
    });
    assert.equal(result.status, 200);
    assert.match(String(result.body.detail), /recorded/i);
    assert.doesNotMatch(
      String(result.body.detail),
      /closed|resolved|answered the decision|done\b/i,
      "the panel has read nothing since; it cannot know the call is closed",
    );
  });

  test("records an answer to work the deck no longer shows, rather than filtering it", async () => {
    // The panel's reading is always older than the fleet's, so "is this still
    // open" is not a question it can answer. The record is inert on its own -
    // the intake skips a key naming no task - and that is what makes a stale
    // click harmless.
    const result = await answer(panel, secret, {
      taskId: "wi-nothing-here-999",
      since: "2099-01-01T00:00:00.000Z",
      answer: "Answered from a page that had gone stale.",
      label: "Answer and close",
      mode: "done",
    });
    assert.equal(result.status, 200);
    const records = await spool(dir);
    assert.ok(records.some(([, content]) => content.startsWith("wi-nothing-here-999\t")));
  });
});

describe("replaying an answer", () => {
  let panel: Panel;
  let dir: string;
  let secret: string;
  before(async () => {
    dir = await spoolDir();
    panel = await startPanel({
      port: testPort(32),
      fixtureSet: "healthy",
      env: { QUARTERDECK_INTENT_DIR: dir },
    });
    secret = secretFrom(await html(panel));
  });
  after(async () => {
    await panel.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const request = {
    taskId: ANSWERABLE.id,
    since: ANSWERABLE.since,
    answer: "Keep the current names.",
    label: "Answer and close",
    mode: "done",
  };

  test("the same request twice changes nothing the second time", async () => {
    const first = await answer(panel, secret, request);
    assert.equal(first.status, 200);
    assert.equal(first.body.duplicate, false);
    const after = await spool(dir);

    const second = await answer(panel, secret, request);
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true, "the replay is recognised as one");
    assert.equal(second.body.requestId, first.body.requestId, "and has the same identity");

    // The acceptance is the disk, not the reply: byte for byte, name for name,
    // the spool is what it was before the replay arrived.
    assert.deepEqual(await spool(dir), after);
  });

  test("a burst of identical requests still leaves one record", async () => {
    const dir2 = await spoolDir();
    const burst = await startPanel({
      port: testPort(33),
      fixtureSet: "healthy",
      env: { QUARTERDECK_INTENT_DIR: dir2 },
    });
    try {
      const key = secretFrom(await html(burst));
      const results = await Promise.all(
        Array.from({ length: 8 }, () => answer(burst, key, request)),
      );
      assert.ok(results.every((result) => result.status === 200));
      const records = await spool(dir2);
      assert.equal(records.length, 1, "eight simultaneous clicks, one record");
      assert.equal(
        results.filter((result) => result.body.duplicate === false).length,
        1,
        "exactly one of them wrote it",
      );
      // Nothing half-written and nothing staged is left behind.
      assert.match(records[0][0], /\.keyed-answer-v1$/);
    } finally {
      await burst.stop();
      await rm(dir2, { recursive: true, force: true });
    }
  });

  test("a different answer to the same question is a different record", async () => {
    const changed = await answer(panel, secret, { ...request, answer: "On reflection, rename it." });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.duplicate, false);
    assert.notEqual(changed.body.requestId, undefined);
    const contents = (await spool(dir)).map(([, content]) => content);
    assert.ok(contents.some((line) => line.includes("Keep the current names.")));
    assert.ok(contents.some((line) => line.includes("On reflection, rename it.")));
    // What a changed answer MEANS is the intake's to decide, not this panel's:
    // it rejects a decision that contradicts the one already recorded. The
    // panel's job ended at recording what the operator said.
  });
});

describe("what the panel refuses to record", () => {
  let panel: Panel;
  let dir: string;
  let secret: string;
  before(async () => {
    dir = await spoolDir();
    panel = await startPanel({
      port: testPort(34),
      fixtureSet: "healthy",
      env: { QUARTERDECK_INTENT_DIR: dir },
    });
    secret = secretFrom(await html(panel));
  });
  after(async () => {
    await panel.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const base = {
    taskId: ANSWERABLE.id,
    since: ANSWERABLE.since,
    answer: "Fine.",
    label: "Answer and close",
    mode: "done",
  };

  test("a close mode the fleet does not have", async () => {
    const result = await answer(panel, secret, { ...base, mode: "delete" });
    assert.equal(result.status, 400);
    assert.match(String(result.body.error), /not a close mode/);
    assert.deepEqual(await spool(dir), []);
  });

  test("an answer carrying a tab or a line break", async () => {
    for (const bad of ["one\ttwo", "one\ntwo"]) {
      const result = await answer(panel, secret, { ...base, answer: bad });
      assert.equal(result.status, 409, bad);
      assert.match(String(result.body.error), /tab or a line break/);
    }
    // Refused rather than quietly repaired: an edited answer recorded as the
    // operator's exact words would be a lie, and one line cut into two would
    // reach the intake as a second, bogus key.
    assert.deepEqual(await spool(dir), []);
  });

  test("an empty answer", async () => {
    const result = await answer(panel, secret, { ...base, answer: "   " });
    assert.equal(result.status, 409);
    assert.deepEqual(await spool(dir), []);
  });

  test("a body that is not the shape the route takes", async () => {
    const result = await answer(panel, secret, { taskId: ANSWERABLE.id });
    assert.equal(result.status, 400);
    assert.deepEqual(await spool(dir), []);
  });

  test("an intent that does not exist", async () => {
    const response = await fetch(`${panel.url}/api/act/close-everything`, {
      method: "POST",
      headers: { [SESSION_HEADER]: secret },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await spool(dir), []);
  });
});

describe("a panel with nowhere to record an answer", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: testPort(35), fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  test("says so on the card rather than offering a control that cannot work", async () => {
    const page = await html(panel);
    assert.ok(page.includes(`data-answer-unavailable="${ANSWERABLE.id}"`));
    assert.ok(!page.includes(`data-answer-control="${ANSWERABLE.id}"`));
    assert.ok(page.includes("No answer spool is configured"));
  });

  test("refuses an answer posted anyway, and writes nothing", async () => {
    // No spool, so nothing to inspect - the refusal itself is the assertion,
    // and it names the reason rather than failing obscurely.
    const response = await fetch(`${panel.url}/api/act/answer-decision`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: "not-the-secret" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403, "the acting guard is still in front of it");
  });
});

describe("the permitted writer", () => {
  /**
   * The one file that could spawn something, checked because nothing else will.
   *
   * Invariant 3 bans `child_process` and `worker_threads` everywhere in `src/`
   * except here - the permitted writer is exempt by construction, since it is
   * the file the exemption exists for. So "the page executes nothing" rests on
   * this one file's restraint, and this project's rule is that a boundary is
   * checked by `npm test` rather than remembered.
   */
  test("cannot spawn anything", async () => {
    const source = await readFile(
      join(REPO_ROOT, "src", "adapters", "intent.ts"),
      "utf8",
    );
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const forbidden of [
      "child_process",
      "worker_threads",
      "node:vm",
      "spawn",
      "execFile",
      "execSync",
    ]) {
      assert.ok(
        !code.includes(forbidden),
        `${forbidden} in the permitted writer would make a web request able to run a fleet command`,
      );
    }
  });
});

describe("the panel's own copy about an answer", () => {
  /**
   * Read from the source rather than the page, because the sentence appears
   * only after an answer has been sent and the control has re-rendered.
   *
   * This is the easiest place in the codebase to claim more than has been
   * established, and it has been got wrong three times already, so the copy is
   * checked rather than trusted.
   */
  test("claims only that the answer was recorded", async () => {
    const source = await readFile(
      join(REPO_ROOT, "src", "ui", "deck", "answer-control.tsx"),
      "utf8",
    );
    const shown = [...source.matchAll(/^\s*(?:{)?"([^"]{12,})"/gm)].map((match) => match[1]);
    const rendered = shown.concat(
      [...source.matchAll(/>\s*\{?\s*"?([A-Z][^<>{}"]{12,})/g)].map((match) => match[1]),
    );
    // A sentence that says what the panel does NOT know is the point, not a
    // violation - so what is checked is the affirmative claim, and only that.
    const claims = rendered.filter((line) => !/\bcannot\b|\bnot\b|\bnever\b/i.test(line));
    for (const line of claims) {
      assert.doesNotMatch(
        line,
        /\bclosed\b|\bresolved\b|\bsettled\b|has been (?:made|taken|answered)/i,
        `the panel must not claim a decision is settled: "${line}"`,
      );
    }
    assert.ok(
      source.includes("The fleet will act on it at its next check."),
      "it says what will happen next, not that it has happened",
    );
    assert.ok(
      source.includes("cannot say the decision is closed until a later reading shows it"),
      "and says plainly what it does not know",
    );
  });
});
