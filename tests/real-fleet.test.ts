import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { REPO_ROOT, startPanel, until, type Panel } from "./lib/server.ts";

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

const nextPort = portsFor(import.meta.filename);

/** The rendered page, with React's text-node markers removed. */
async function body(panel: Panel): Promise<string> {
  const response = await fetch(panel.url);
  return (await response.text()).replaceAll("<!-- -->", "");
}

function lensStatus(html: string, name: string): string | null {
  return (
    new RegExp(`data-lens="${name}" data-lens-status="([a-z]+)"`).exec(
      html,
    )?.[1] ?? null
  );
}

/** How many worker cards the fleet lens drew. */
function workerCards(html: string): number {
  return (html.match(/data-worker="/g) ?? []).length;
}

/** How many rows the deck lens drew. */
function deckItems(html: string): number {
  return (html.match(/data-deck-item="/g) ?? []).length;
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
      port: nextPort(),
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
    assert.equal(deckItems(html), 5);
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
      const section = new RegExp(
        `data-lens="${lens}"[\\s\\S]*?</section>`,
      ).exec(html);
      assert.ok(section, `the ${lens} lens is mounted`);
      assert.ok(
        !section[0].includes(home),
        `the ${lens} lens names no machine path`,
      );
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
    await writeFile(
      join(home, "state", "wi-northreach-509.meta"),
      "id: wi-northreach-509\n",
    );

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
      port: nextPort(),
      now: "2099-01-01T09:15:30.000Z",
      env: { QUARTERDECK_FLEET_HOME: home },
    });
  });

  after(async () => {
    await panel.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("is noticed, even though no worker moved", async () => {
    assert.equal(deckItems(await body(panel)), 5);

    const snapshot = JSON.parse(
      await readFile(join(home, "snapshot.json"), "utf8"),
    );
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
    await writeFile(
      join(home, "snapshot.json"),
      JSON.stringify(snapshot, null, 2),
    );
    // The backlog a captain edits lives under `data`, and nothing under
    // `state` moved. Watching only the workers would leave the deck stale
    // until some unrelated worker happened to change.
    await writeFile(
      join(home, "data", "backlog.md"),
      "- [ ] wi-northreach-520\n",
    );

    const html = await until(
      () => body(panel),
      (text) => deckItems(text) === 6,
    );
    assert.equal(lensStatus(html, "deck"), "fresh");
  });
});

/**
 * The snapshot command, rewritten to take longer than it is allowed.
 *
 * The sleep runs in a process group of its own, which is not decoration: it is
 * what upstream's own bounded runner does, and it is why an abort here frees
 * the panel's wait without stopping the fleet's work. A stub that died on
 * SIGTERM would prove the copy and quietly misrepresent the cost.
 */
async function makeSlow(home: string, seconds: number): Promise<void> {
  const command = join(home, "bin", "fm-fleet-snapshot.sh");
  await writeFile(
    command,
    [
      "#!/bin/sh",
      `perl -e 'my $p = fork; if (!$p) { setpgrp(0,0); exec @ARGV } waitpid $p, 0' sleep ${seconds}`,
      'exec cat "$FM_HOME/snapshot.json"',
      "",
    ].join("\n"),
  );
  await chmod(command, 0o755);
}

/** Every way a band can call an absent reading a failure, in rendered prose. */
const CALLED_IT_A_FAILURE = /read (?:that )?(?:carries landed work )?failed/;

/**
 * A fleet that is merely slow, said in the panel's own words.
 *
 * Two shapes, because the bands draw different copy for each and the wrong word
 * hid in the second one until a deliberately reintroduced fault went unnoticed:
 * a first read that never landed, where the lenses have nothing behind them,
 * and a fleet that answered once and then stopped answering in time, where they
 * are still showing the last good picture and have to date it.
 */
describe("a fleet slower than the budget it is read under", () => {
  let home: string;
  let panel: Panel;

  before(async () => {
    home = await fakeFleetHome("upstream-shape");
    await makeSlow(home, 30);
    panel = await startPanel({
      port: nextPort(),
      now: "2099-01-01T09:15:30.000Z",
      env: {
        QUARTERDECK_FLEET_HOME: home,
        QUARTERDECK_READ_TIMEOUT_MS: "500",
      },
    });
  });

  after(async () => {
    await panel.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("says it timed out, on a first read that never landed", async () => {
    const html = await body(panel);

    for (const lens of ["fleet", "deck", "landed"]) {
      assert.equal(lensStatus(html, lens), "unreadable");
      assert.ok(
        html.includes(
          `data-lens="${lens}" data-lens-status="unreadable" data-lens-reason="timed-out"`,
        ),
        `expected the ${lens} lens to name running out of time as the reason`,
      );
    }

    assert.ok(html.includes("Timed out"), "the badge says which it was");
    assert.ok(
      html.includes("QUARTERDECK_READ_TIMEOUT_MS"),
      "and the operator is told which setting raises the budget",
    );
    assert.ok(
      !CALLED_IT_A_FAILURE.test(html),
      "no band may call a slow fleet a failed one",
    );
  });

  test("a slow fleet does not take the health signals down with it", async () => {
    assert.equal(lensStatus(await body(panel), "shipshape"), "fresh");
  });
});

describe("a fleet that answered once and then stopped answering in time", () => {
  let home: string;
  let panel: Panel;

  before(async () => {
    home = await fakeFleetHome("upstream-shape");
    panel = await startPanel({
      port: nextPort(),
      now: "2099-01-01T09:15:30.000Z",
      env: {
        QUARTERDECK_FLEET_HOME: home,
        QUARTERDECK_READ_TIMEOUT_MS: "500",
      },
    });
  });

  after(async () => {
    await panel.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("keeps the last good picture, and dates it as timed out rather than failed", async () => {
    assert.equal(lensStatus(await body(panel), "fleet"), "fresh");
    const showing = workerCards(await body(panel));
    assert.ok(showing > 0, "there is a picture to keep");

    await makeSlow(home, 30);
    await writeFile(join(home, "state", "moved"), "");

    const html = await until(
      () => body(panel),
      (text) => lensStatus(text, "fleet") === "unreadable",
    );

    assert.equal(
      workerCards(html),
      showing,
      "the last good picture is still on screen",
    );
    assert.ok(
      html.includes('data-lens-reason="timed-out"'),
      "and it is dated by a read that ran out of time",
    );
    assert.ok(
      !CALLED_IT_A_FAILURE.test(html),
      "no band may call a slow fleet a failed one",
    );
  });
});
