import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  REPO_ROOT,
  startPanel,
  testPort,
  until,
  type Panel,
} from "./lib/server.ts";

/**
 * The panel pointed at a fleet home, end to end through the built server.
 *
 * `tests/fleet-source.test.ts` drives the same path with a stubbed `Runner`,
 * which proves the parsing, the refusals and the read discipline. This file
 * proves the part a stub cannot: that the panel really starts a process, really
 * reads what it prints, and really keeps the last good document when that
 * process starts failing.
 *
 * The fleet home is a temporary directory holding one executable script - the
 * shape upstream's contract describes, and nothing else. No fleet is needed,
 * and none is looked for.
 */

/** The rendered page, with React's text-node markers removed. */
async function body(panel: Panel): Promise<string> {
  const response = await fetch(panel.url);
  return (await response.text()).replaceAll("<!-- -->", "");
}

function lensStatus(html: string, name: string): string | null {
  return (
    new RegExp(`data-lens="${name}" data-lens-status="([a-z]+)"`).exec(html)?.[1] ?? null
  );
}

/** How many worker cards the fleet lens drew. */
function workerCards(html: string): number {
  return (html.match(/data-worker="/g) ?? []).length;
}

/**
 * A fleet home: the snapshot command, and the two directories a real one keeps
 * its worker records and its backlog in. What the command prints is whatever is
 * in `snapshot.json` beside it, so a test can change the fleet's answer.
 */
async function fakeFleetHome(fixtureSet: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "quarterdeck-fleet-"));
  await mkdir(join(home, "bin"), { recursive: true });
  await mkdir(join(home, "state"), { recursive: true });
  await mkdir(join(home, "data"), { recursive: true });
  await copyFile(
    join(REPO_ROOT, "fixtures", fixtureSet, "snapshot.json"),
    join(home, "snapshot.json"),
  );

  const command = join(home, "bin", "fm-fleet-snapshot.sh");
  // Refuses anything but `--json`, the way upstream's own command distinguishes
  // its structured surface from its human one - so a test would notice if the
  // adapter ever stopped asking for it.
  await writeFile(
    command,
    [
      "#!/bin/sh",
      'test "$1" = "--json" || { echo "expected --json" >&2; exit 64; }',
      'test -n "$FM_HOME" || { echo "FM_HOME is not set" >&2; exit 65; }',
      'exec cat "$FM_HOME/snapshot.json"',
      "",
    ].join("\n"),
  );
  await chmod(command, 0o755);
  return home;
}

describe("the panel pointed at a fleet home", () => {
  let home: string;
  let panel: Panel;

  before(async () => {
    home = await fakeFleetHome("upstream-shape");
    panel = await startPanel({
      port: testPort(12),
      now: "2099-01-01T09:15:30.000Z",
      env: { QUARTERDECK_FLEET_HOME: home },
    });
  });

  after(async () => {
    await panel.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("renders that fleet's workers and its deck", async () => {
    const html = await body(panel);
    assert.equal(lensStatus(html, "fleet"), "fresh");
    assert.equal(lensStatus(html, "deck"), "fresh");
    assert.equal(workerCards(html), 8);
    assert.ok(html.includes("5 items in the document"));
  });

  test("draws the fleet and the deck without naming the home", async () => {
    // The home is configuration. Reading it is the only place it enters the
    // panel, and a worker's project reaches the document as a name rather than
    // as the path upstream recorded it.
    //
    // Scoped to these two lenses on purpose: a refusal names the fleet it came
    // from - which is the point of it - and the shipshape lens names the file
    // it could not read, which is the quarantined module's own contract.
    const html = await body(panel);
    for (const lens of ["fleet", "deck"]) {
      const section = new RegExp(`data-lens="${lens}"[\\s\\S]*?</section>`).exec(html);
      assert.ok(section, `the ${lens} lens is mounted`);
      assert.ok(!section[0].includes(home), `the ${lens} lens names no machine path`);
    }
  });

  test("a failing command leaves the last good document standing", async () => {
    // The fleet home goes away under the running panel: the command is still
    // where the adapter looks, and no longer works.
    await writeFile(
      join(home, "bin", "fm-fleet-snapshot.sh"),
      '#!/bin/sh\necho "the fleet home is not readable" >&2\nexit 70\n',
    );
    await chmod(join(home, "bin", "fm-fleet-snapshot.sh"), 0o755);
    // Touching a watched directory is what makes the panel look again.
    await writeFile(join(home, "state", "wi-northreach-509.meta"), "id: wi-northreach-509\n");

    const html = await until(
      () => body(panel),
      (text) => lensStatus(text, "fleet") === "unreadable",
    );

    assert.equal(lensStatus(html, "deck"), "unreadable");
    assert.equal(
      workerCards(html),
      8,
      "the fleet the operator was looking at is still on screen",
    );
    assert.ok(
      html.includes("exited 70") || html.includes("not readable"),
      "and the panel says what went wrong, in the command's own words",
    );
  });
});

describe("a fleet home whose backlog changes", () => {
  let home: string;
  let panel: Panel;

  before(async () => {
    home = await fakeFleetHome("upstream-shape");
    panel = await startPanel({
      port: testPort(13),
      now: "2099-01-01T09:15:30.000Z",
      env: { QUARTERDECK_FLEET_HOME: home },
    });
  });

  after(async () => {
    await panel.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("is noticed, even though no worker moved", async () => {
    assert.ok((await body(panel)).includes("5 items in the document"));

    const snapshot = JSON.parse(await readFile(join(home, "snapshot.json"), "utf8"));
    snapshot.backlog.records.push({
      order: 8,
      state: "queued",
      structured: true,
      id: "wi-northreach-520",
      title: "Sound the north channel",
      priority: "2",
      hold_reason: null,
      hold_kind: null,
      hold_until: null,
      blocked_by_ids: [],
      blocked_reason: null,
      since: "2099-01-01",
      captain_actionable: false,
    });
    await writeFile(join(home, "snapshot.json"), JSON.stringify(snapshot, null, 2));
    // The backlog a captain edits lives under `data`, and nothing under
    // `state` moved. Watching only the workers would leave the deck stale
    // until some unrelated worker happened to change.
    await writeFile(join(home, "data", "backlog.md"), "- [ ] wi-northreach-520\n");

    const html = await until(
      () => body(panel),
      (text) => text.includes("6 items in the document"),
    );
    assert.equal(lensStatus(html, "deck"), "fresh");
  });
});
