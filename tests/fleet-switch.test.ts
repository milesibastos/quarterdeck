import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { FLEET_COOKIE } from "../src/types/selection.ts";
import {
  copyFixtures,
  rawRequest,
  startPanel,
  testPort,
  type Panel,
} from "./lib/server.ts";

/**
 * Choosing which fleet the panel is looking at, driven through the built server.
 *
 * The claim this file exists for is the third one in the brief: **no content is
 * ever attributed to the wrong fleet.** That is not a claim about how a switch
 * looks, so it is not asserted by looking. It is asserted structurally: every
 * response the panel gives carries the id of the fleet it read, and this file
 * checks that the content beside that id is that fleet's and no other - one
 * request at a time, and with two fleets' requests interleaved on the same
 * server, which is what a shared cache would fail.
 *
 * The fleets here are fixture sets, because a fixture set is what the reader
 * calls a fleet when there is no real one - see fixtures/README.md. Two of them
 * are marked before the panel starts, so "this is the other fleet's content"
 * is a string that can only have come from one file on disk.
 */

/** The two fleets under test, and the mark planted in each. */
const ONE = { set: "healthy", mark: "brightwater-one" };
const TWO = { set: "fleet-only", mark: "brightwater-two" };

/**
 * A fleet the panel cannot read: a truncated snapshot, which is the `malformed`
 * set's whole purpose. Selecting it is a normal outcome, not an error page.
 */
const UNREADABLE = "malformed";

/** A fleet whose snapshot announces a schema this build refuses outright. */
const REFUSED = "mismatched";

const FLEETS = [ONE.set, TWO.set, UNREADABLE, REFUSED].join(":");

/**
 * Give one fixture set a project name that appears in no other set, so a worker
 * card drawn from it can only have come from that file.
 */
async function mark(fixtureRoot: string, set: string, project: string): Promise<void> {
  const file = join(fixtureRoot, set, "snapshot.json");
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  snapshot.tasks[0].project = project;
  await writeFile(file, JSON.stringify(snapshot, null, 2));
}

interface Rendered {
  readonly status: number;
  readonly html: string;
  /** The fleet the server says this page was rendered from. */
  readonly fleet: string | null;
}

/**
 * The page as an operator carrying a remembered selection would get it.
 *
 * Through `rawRequest` rather than `fetch`, because `Cookie` is on undici's
 * forbidden-header list and a silently dropped cookie would make every
 * assertion below pass for the wrong reason.
 */
async function page(port: number, selected?: string): Promise<Rendered> {
  const headers: Record<string, string> =
    selected === undefined ? {} : { cookie: `${FLEET_COOKIE}=${selected}` };
  const response = await rawRequest(port, "/", headers);
  const html = response.body.replaceAll("<!-- -->", "");
  return {
    status: response.status,
    html,
    fleet: /data-fleet="([^"]*)"/.exec(html)?.[1] ?? null,
  };
}

/** Every fleet the picker offered, in the order it drew them. */
function choices(html: string): string[] {
  return [...html.matchAll(/data-fleet-choice="([^"]+)"/g)].map((match) => match[1]);
}

/** How many worker cards the fleet lens drew. */
function workerCards(html: string): number {
  return (html.match(/data-worker="/g) ?? []).length;
}

/** The status the shell put on one lens, or null when that lens is absent. */
function lensStatus(html: string, name: string): string | null {
  return (
    new RegExp(`data-lens="${name}" data-lens-status="([a-z]+)"`).exec(html)?.[1] ?? null
  );
}

/**
 * The first change signal one fleet's stream publishes.
 *
 * Opened before the change is made, because the signal carries no data and a
 * stream joined afterwards would simply wait for the next one.
 */
async function signalFrom(
  url: string,
  fleet: string,
  timeoutMs = 10_000,
): Promise<{ event: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${url}/api/events?fleet=${fleet}`, {
    signal: controller.signal,
  });
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("the channel closed before the signal arrived");
      buffer += value;
      const event = /^event:\s*(.*)$/m.exec(buffer)?.[1];
      if (event) return { event };
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * The one claim, as a function: whatever fleet a page says it is showing, every
 * mark on it belongs to that fleet and to no other.
 *
 * Written as an assertion over the marks rather than over one expected string,
 * so it fails on content leaking in from the other fleet as loudly as it fails
 * on the wrong fleet being read.
 */
function assertAttributedTo(rendered: Rendered, expected: { set: string; mark: string }) {
  const other = expected.set === ONE.set ? TWO : ONE;
  assert.equal(rendered.fleet, expected.set, "the page names the fleet it was read from");
  assert.ok(
    rendered.html.includes(expected.mark),
    `expected ${expected.set}'s own content on a page showing ${expected.set}`,
  );
  assert.ok(
    !rendered.html.includes(other.mark),
    `${other.set}'s content appeared on a page showing ${expected.set}`,
  );
}

describe("a panel that can see more than one fleet", () => {
  let panel: Panel;
  const port = testPort(30);

  before(async () => {
    const fixtureRoot = await copyFixtures();
    await mark(fixtureRoot, ONE.set, ONE.mark);
    await mark(fixtureRoot, TWO.set, TWO.mark);
    panel = await startPanel({
      port,
      fixtureRoot,
      env: { QUARTERDECK_FIXTURE_SET: FLEETS },
    });
  });
  after(() => panel.stop());

  test("offers every configured fleet, in the order they were configured", async () => {
    assert.deepEqual(choices((await page(port)).html), [
      ONE.set,
      TWO.set,
      UNREADABLE,
      REFUSED,
    ]);
  });

  test("shows the first fleet when nothing has been chosen yet", async () => {
    assertAttributedTo(await page(port), ONE);
  });

  test("the content follows the selection", async () => {
    assertAttributedTo(await page(port, ONE.set), ONE);
    assertAttributedTo(await page(port, TWO.set), TWO);
  });

  test("each fleet keeps its own picture, not the last one read", async () => {
    // `healthy` has a deck and `fleet-only` does not, which is a difference no
    // amount of shared cache could reproduce by accident.
    assert.ok((await page(port, ONE.set)).html.includes("Settle the hold vocabulary"));
    assert.ok(!(await page(port, TWO.set)).html.includes("Settle the hold vocabulary"));
  });

  test("two fleets read at once are never mixed up with each other", async () => {
    // The failure this guards against is a cache keyed on nothing: the panel
    // holds one runtime per fleet precisely so that a request for one cannot be
    // answered out of the other's last read. Interleaved, and repeatedly, so a
    // race has somewhere to show up rather than a single ordering.
    const wanted = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? ONE : TWO));
    const rendered = await Promise.all(wanted.map((fleet) => page(port, fleet.set)));
    for (const [i, response] of rendered.entries()) {
      assertAttributedTo(response, wanted[i]);
    }
  });

  test("a remembered fleet the panel no longer has falls back, and says which", async () => {
    const rendered = await page(port, "a-fleet-that-was-removed");
    assertAttributedTo(rendered, ONE);
  });

  test("the signal stream is asked for, and watches, the fleet on screen", async () => {
    const rendered = await page(port, TWO.set);
    assert.ok(
      rendered.html.includes(`/api/events?fleet=${TWO.set}`),
      "the page listens to the fleet it is showing",
    );

    // And that stream really is watching that fleet: the panel holds one
    // watcher per fleet, so a change to this one has to reach this stream.
    const signal = signalFrom(panel.url, TWO.set);
    const file = join(panel.fixtureRoot, TWO.set, "snapshot.json");
    const snapshot = JSON.parse(await readFile(file, "utf8"));
    snapshot.tasks[0].kind = "research";
    await writeFile(file, JSON.stringify(snapshot, null, 2));
    assert.equal((await signal).event, "fleet-changed");
  });
});

describe("a fleet that cannot be read", () => {
  let panel: Panel;
  const port = testPort(31);

  before(async () => {
    const fixtureRoot = await copyFixtures();
    await mark(fixtureRoot, ONE.set, ONE.mark);
    await mark(fixtureRoot, TWO.set, TWO.mark);
    panel = await startPanel({
      port,
      fixtureRoot,
      env: { QUARTERDECK_FIXTURE_SET: FLEETS },
    });
  });
  after(() => panel.stop());

  test("degrades through the lens statuses rather than through a new failure path", async () => {
    const { html, fleet } = await page(port, UNREADABLE);
    assert.equal(fleet, UNREADABLE);
    assert.equal(lensStatus(html, "fleet"), "unreadable");
    assert.equal(lensStatus(html, "deck"), "unreadable");
    assert.equal(lensStatus(html, "shipshape"), "fresh", "health reads on its own");
    assert.equal(workerCards(html), 0, "nothing is drawn for a fleet nothing was read from");
  });

  test("shows no other fleet's content while it is the one selected", async () => {
    const { html } = await page(port, UNREADABLE);
    assert.ok(!html.includes(ONE.mark) && !html.includes(TWO.mark));
  });

  test("the operator can still get back to one that works", async () => {
    assert.deepEqual(choices((await page(port, UNREADABLE)).html), [
      ONE.set,
      TWO.set,
      UNREADABLE,
      REFUSED,
    ]);
    assertAttributedTo(await page(port, ONE.set), ONE);
  });

  test("a refused snapshot keeps the picker, so the refusal is not a dead end", async () => {
    const { html, fleet } = await page(port, REFUSED);
    assert.equal(fleet, REFUSED);
    assert.ok(html.includes("Snapshot refused"), "the loud refusal, unchanged");
    assert.deepEqual(choices(html), [ONE.set, TWO.set, UNREADABLE, REFUSED]);
    assertAttributedTo(await page(port, TWO.set), TWO);
  });
});

describe("a panel that can see exactly one fleet", () => {
  let panel: Panel;
  const port = testPort(32);

  before(async () => {
    panel = await startPanel({ port, fixtureSet: ONE.set });
  });
  after(() => panel.stop());

  test("still names the fleet it is showing rather than hiding the control", async () => {
    const { html } = await page(port);
    assert.deepEqual(choices(html), [ONE.set]);
    assert.ok(html.includes("showing"), "the one fleet is marked as the one being shown");
    assert.ok(
      html.includes("The only fleet this panel is configured to see."),
      "and says why there is nothing to switch to, rather than looking broken",
    );
  });
});

describe("a selection outlives the panel that was told it", () => {
  const port = testPort(33);

  test("a restarted panel is still pointed where it was left", async () => {
    const fixtureRoot = await copyFixtures();
    await mark(fixtureRoot, ONE.set, ONE.mark);
    await mark(fixtureRoot, TWO.set, TWO.mark);
    const env = { QUARTERDECK_FIXTURE_SET: FLEETS };

    const first = await startPanel({ port, fixtureRoot, env });
    try {
      assertAttributedTo(await page(port, TWO.set), TWO);
    } finally {
      await first.stop();
    }

    // The selection is remembered in the browser, so what survives the restart
    // is the cookie the operator's browser would send again - nothing on this
    // machine has to have been written for the panel to come back pointed here.
    const second = await startPanel({ port, fixtureRoot, env });
    try {
      assertAttributedTo(await page(port, TWO.set), TWO);
    } finally {
      await second.stop();
    }
  });
});
