import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { REPO_ROOT, startPanel, type Panel } from "./lib/server.ts";
import {
  snapshotAge,
  SNAPSHOT_AGEING_AFTER_MS,
  SNAPSHOT_OLD_AFTER_MS,
} from "../src/ui/lib/snapshot-age.ts";

/**
 * The age badge: three states at two named thresholds, and what to do about it.
 *
 * Every card on this page is drawn as though it were true now, and it is not -
 * it is a snapshot. The badge is the only element that says so, which is why it
 * is tested against the built server rather than trusted to a unit check: what
 * matters is that the page an operator loads carries the state, the word for
 * it, and the command that makes a newer one.
 *
 * The fixtures are all generated at 2099-01-01T09:15:00Z, and the panel's
 * "now" is pinned, so each state below is an arithmetic fact rather than a race
 * with the wall clock.
 */

const nextPort = portsFor(import.meta.filename);
const GENERATED = "2099-01-01T09:15:00.000Z";

async function body(panel: Panel): Promise<string> {
  const response = await fetch(panel.url);
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** The state the badge put in the markup, or `null` if it drew none. */
function badge(html: string): string | null {
  return /data-snapshot-age="([a-z]+)"/.exec(html)?.[1] ?? null;
}

/** `GENERATED` plus an offset, as an instant to pin the panel's clock to. */
function later(ms: number): string {
  return new Date(Date.parse(GENERATED) + ms).toISOString();
}

describe("the thresholds", () => {
  test("live in one place, and divide the range into exactly three", () => {
    // Read from the module the badge reads, so a threshold that moves moves
    // this test with it rather than leaving it asserting a stale number.
    const now = Date.parse(GENERATED);
    assert.equal(snapshotAge(GENERATED, now + 30_000), "current");
    assert.equal(
      snapshotAge(GENERATED, now + SNAPSHOT_AGEING_AFTER_MS - 1),
      "current",
    );
    assert.equal(
      snapshotAge(GENERATED, now + SNAPSHOT_AGEING_AFTER_MS),
      "ageing",
    );
    assert.equal(
      snapshotAge(GENERATED, now + SNAPSHOT_OLD_AFTER_MS - 1),
      "ageing",
    );
    assert.equal(snapshotAge(GENERATED, now + SNAPSHOT_OLD_AFTER_MS), "old");
  });

  test("read a snapshot dated ahead of the clock as current, not as a fourth state", () => {
    // The fresh fixtures are dated in the future on purpose, so they never
    // drift into looking old as the repository ages.
    assert.equal(
      snapshotAge(GENERATED, Date.parse(GENERATED) - 60_000),
      "current",
    );
  });
});

describe("the badge on the page", () => {
  for (const [state, offsetMs] of [
    ["current", 30_000],
    ["ageing", SNAPSHOT_AGEING_AFTER_MS + 60_000],
    ["old", SNAPSHOT_OLD_AFTER_MS + 300_000],
  ] as const) {
    test(`a snapshot ${Math.round(offsetMs / 1000)}s old reads as ${state}`, async () => {
      const panel = await startPanel({
        port: nextPort(),
        fixtureSet: "healthy",
        now: later(offsetMs),
        // Wide enough that the lenses stay fresh at every offset: this is a
        // statement about the age of the page, not about upstream's promise.
        staleAfterMs: SNAPSHOT_OLD_AFTER_MS * 4,
      });
      try {
        const html = await body(panel);
        assert.equal(badge(html), state);
        // The word, not only the hue. A badge whose one signal is a colour says
        // nothing at all to a reader who cannot separate gold from rust, and
        // this is the element that has to reach every operator.
        assert.match(
          html,
          new RegExp(
            `data-snapshot-word="true"[^>]*>${state === "current" ? "Current" : state === "ageing" ? "Ageing" : "Old"}<`,
          ),
          "the state is in words as well as in colour",
        );
      } finally {
        await panel.stop();
      }
    });
  }
});

describe("the rebuild command", () => {
  /**
   * A fleet home: the snapshot command, and the directories a real one keeps
   * its worker records and its backlog in. The same shape
   * `tests/real-fleet.test.ts` builds, for the same reason - no fleet is
   * needed, and none is looked for.
   */
  async function fakeFleetHome(): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), "quarterdeck-fleet-"));
    await mkdir(join(home, "bin"), { recursive: true });
    await mkdir(join(home, "state"), { recursive: true });
    await mkdir(join(home, "data"), { recursive: true });
    await copyFile(
      join(REPO_ROOT, "fixtures", "healthy", "snapshot.json"),
      join(home, "snapshot.json"),
    );
    const command = join(home, "bin", "fm-fleet-snapshot.sh");
    await writeFile(
      command,
      ["#!/bin/sh", 'exec cat "$FM_HOME/snapshot.json"', ""].join("\n"),
    );
    await chmod(command, 0o755);
    return home;
  }

  let panel: Panel;
  let home: string;
  before(async () => {
    home = await fakeFleetHome();
    panel = await startPanel({
      port: nextPort(),
      now: later(SNAPSHOT_OLD_AFTER_MS + 60_000),
      env: { QUARTERDECK_FLEET_HOME: home },
    });
  });
  after(() => panel.stop());

  test("is on the badge, so distrusting the age and fixing it are one glance apart", async () => {
    const html = await body(panel);
    assert.equal(badge(html), "old");
    const line = /data-snapshot-rebuild="true"[^>]*>([\s\S]*?)<\/p>/.exec(
      html,
    )?.[1];
    assert.ok(line, "an old snapshot offers the command that replaces it");
    assert.ok(line.includes("bin/fm-fleet-snapshot.sh --json"), line);
  });

  test("stays relative, and names the home the way the picker does", async () => {
    const html = await body(panel);
    const line =
      /data-snapshot-rebuild="true"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    const label = home.slice(home.lastIndexOf("/") + 1);
    // The command an operator is handed is the one upstream publishes,
    // relative to the home, and the home is named by the label the picker
    // already uses. An absolute path here would be the badge inventing a
    // second name for a fleet the page has already named once.
    assert.ok(
      !line.includes(home),
      `the badge printed the home's path: ${line}`,
    );
    assert.ok(
      line.includes(label),
      `the badge did not name the fleet: ${line}`,
    );
  });
});

describe("a fleet with no snapshot command", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  test("offers no command rather than inventing one", async () => {
    const html = await body(panel);
    // A fixture set is a committed file; telling an operator to run something
    // that does not exist is worse than telling them there is nothing to run.
    assert.ok(!html.includes("data-snapshot-rebuild"));
    assert.ok(html.includes("No command here makes a newer one"));
  });
});
