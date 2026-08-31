import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { copyFixtures, startPanel, type Panel } from "./lib/server.ts";

/**
 * What the shipshape lens draws, driven end to end through the built server.
 *
 * The claims here are the ones the lens exists to make: five signals, each
 * with a verdict of its own; a positive finding told apart from a signal that
 * did not read; a cycle that calls itself alive but has gone quiet read as a
 * concern; and - the assertions that matter most - an unreadable signal never
 * implying what it would have said. `panel.test.ts` asserts the frame around
 * it, and `document.test.ts` asserts the document underneath.
 *
 * Two of the five - the notification queue and attendance - share a source
 * directory with two others and so cannot be broken alone at the source; see
 * `tests/health.test.ts` for what the module does when that directory goes.
 * What can be pinned here, and is, is the seam the lens actually consumes: a
 * document with exactly one signal dark renders exactly one dark block.
 */

const nextPort = portsFor(import.meta.filename);

/** The rendered page, with React's text-node markers removed. */
async function body(panel: Panel, path = "/"): Promise<string> {
  const response = await fetch(`${panel.url}${path}`);
  return (await response.text()).replaceAll("<!-- -->", "");
}

/** The verdict the lens put on one signal, or null when that signal is absent. */
function verdict(html: string, signal: string): string | null {
  return (
    new RegExp(`data-signal="${signal}" data-read="[a-z]+" data-verdict="([^"]*)"`).exec(html)?.[1] ??
    null
  );
}

/** Whether one signal read at all. */
function read(html: string, signal: string): string | null {
  return new RegExp(`data-signal="${signal}" data-read="([a-z]+)"`).exec(html)?.[1] ?? null;
}

const SIGNALS = ["supervisor", "queue", "attendance", "overdue", "drift"] as const;

/**
 * The claims a signal only makes when it read.
 *
 * Asserted absent wherever a signal is dark: the bug this lens must never grow
 * is an unread signal rendering as one that read and found nothing, and the
 * cheapest way that happens is copy that leaks a healthy phrase into a dark
 * block. Each entry belongs to exactly one signal and appears nowhere else on
 * the page, which is what makes a whole-page `includes` a fair check.
 */
const READ_CLAIMS: Readonly<Record<(typeof SIGNALS)[number], readonly string[]>> = {
  supervisor: ["Last seen", "Alive", "Stopped"],
  queue: ["Nothing queued", "notifications are waiting", "notification is waiting"],
  attendance: ["Away mode is", "lock is present", "home held"],
  overdue: ["Nothing overdue", "overdue<"],
  drift: ["No disagreement", "disagreeing<"],
};

/**
 * The instant `document.test.ts` pins: thirty seconds after the fresh sets were
 * generated, inside the sixty-second freshness window.
 */
const NOW = "2099-01-01T09:15:30.000Z";

describe("five signals that read cleanly and found nothing wrong", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    panel = await startPanel({ port: nextPort(), fixtureSet: "healthy", now: NOW });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("draws all five signals, each with a verdict of its own", () => {
    for (const signal of SIGNALS) {
      assert.equal(read(html, signal), "ok", `${signal} should be on screen and read`);
    }
    assert.equal(verdict(html, "supervisor"), "alive");
    assert.equal(verdict(html, "queue"), "empty");
    // The set is a fleet with a session running: nobody away, the home held.
    assert.equal(verdict(html, "attendance"), "present-held");
    assert.equal(verdict(html, "overdue"), "clear");
    assert.equal(verdict(html, "drift"), "clear");
  });

  test("states an empty queue as a finding rather than as an empty area", () => {
    assert.ok(html.includes("Nothing queued"));
    assert.ok(html.includes("found holding nothing"), "read and found empty, not unread");
  });

  test("draws attendance as the two entries the strip asks for, under one verdict", () => {
    assert.ok(html.includes("away mode"), "the first entry");
    assert.ok(html.includes('data-fact="away" class="font-mono text-foreground">off'));
    assert.ok(html.includes('data-fact="locked" class="font-mono text-foreground">held by a session'));
    assert.ok(html.includes("Away mode is off"));
  });

  test("says a lock is held without claiming its holder is still running", () => {
    // `attendance.locked` is a file's presence. Whether the session holding it
    // is alive is the fleet's own liveness policy - see docs/quality.md - and
    // the copy must not quietly promise an answer the panel does not have.
    assert.ok(html.includes("A lock is present"));
    assert.ok(
      html.includes("whether that session is still running"),
      "the caveat, in the lens's own words",
    );
  });

  test("says when the cycle was last seen, and names the threshold it is inside", () => {
    assert.ok(html.includes("Last seen 30s ago"), "the age, not only the verdict");
    assert.ok(html.includes("inside the 10 minutes"), "the threshold, stated in the copy");
  });

  test("states nothing overdue and nothing disagreeing as findings, not silences", () => {
    assert.ok(html.includes("Nothing overdue"));
    assert.ok(html.includes("found nothing waiting longer than it should"));
    assert.ok(html.includes("No disagreement"));
    assert.ok(html.includes("every one of them agrees"));
  });
});

describe("signals that read cleanly and found something", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: "stale",
      // Long after the reading was taken, pinned so this never races.
      now: "2019-03-05T11:00:00.000Z",
    });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("reads a cycle that is not running as a fault", () => {
    assert.equal(verdict(html, "supervisor"), "stopped");
    assert.ok(html.includes("The cycle is not running"));
  });

  test("reads a queue holding exactly the threshold as backed up, not as draining", () => {
    // The set holds four, which is the number itself. The comparison is `>=`,
    // so the boundary belongs to the concern rather than to the clean side of
    // it, and this is the assertion that pins which way round that is.
    assert.equal(verdict(html, "queue"), "backed-up");
    assert.ok(html.includes("4 queued"));
    assert.ok(html.includes("arriving faster than they are handled"));
    assert.ok(!html.includes("Nothing queued"), "four queued is not none");
  });

  test("names away mode and the home lock as two facts that move apart", () => {
    // Away with the home unheld: the opposite of the healthy set on both
    // entries, which is what shows the two are read rather than paired.
    assert.equal(verdict(html, "attendance"), "away");
    assert.ok(html.includes("Away mode is on"));
    assert.ok(html.includes("No lock is present"));
    assert.ok(!html.includes("home held"), "nobody holds this home");
  });

  test("names each overdue item and how long it has been waiting", () => {
    assert.equal(verdict(html, "overdue"), "overdue");
    assert.ok(html.includes("1 overdue"));
    assert.ok(html.includes("wi-tidewater-126"));
    assert.ok(html.includes("waiting since"), "the age, from the shared helper");
    assert.ok(!html.includes("Nothing overdue"), "one overdue item is not none");
  });

  test("names each disagreeing record and upstream's line on how", () => {
    assert.equal(verdict(html, "drift"), "disagreeing");
    assert.ok(html.includes("1 disagreeing"));
    assert.ok(html.includes("wi-lamplight-207 is queued here but has a worktree"));
    assert.ok(!html.includes("No disagreement"));
  });

  test("dates the reading itself rather than leaving it undated", () => {
    assert.ok(html.includes("Last good reading, taken"));
  });
});

describe("signals that could not be read", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    // The health file reads; its five signals each report that they did not.
    panel = await startPanel({ port: nextPort(), fixtureSet: "health-unread", now: NOW });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("draws every signal as unread, under a frame that is still current", () => {
    assert.ok(html.includes('data-lens="shipshape" data-lens-status="fresh"'));
    for (const signal of SIGNALS) {
      assert.equal(read(html, signal), "unreadable", `${signal} should be dark`);
      assert.equal(verdict(html, signal), "unreadable");
    }
  });

  test("names what failed and what is therefore unknown", () => {
    assert.ok(html.includes("The wait ledger could not be opened."));
    assert.ok(html.includes("Whether anything has been waiting too long is unknown"));
    assert.ok(html.includes("Whether any record disagrees is unknown"));
    assert.ok(html.includes("Whether the cycle is running"));
    assert.ok(html.includes("No notification queue in the state directory."));
    assert.ok(html.includes("whether it is draining, is unknown"));
    assert.ok(html.includes("Could not list the state directory for away mode"));
    assert.ok(html.includes("whether a session holds the home, are both unknown"));
  });

  test("implies nothing about what an unread signal would have said", () => {
    // The bug this lens must not grow: a signal that did not read rendering as
    // one that read and found nothing. Five signals, five sets of claims, and
    // not one of them may appear anywhere on a page where every signal is dark.
    for (const [signal, claims] of Object.entries(READ_CLAIMS)) {
      for (const claim of claims) {
        assert.ok(!html.includes(claim), `an unread ${signal} should not claim ${claim}`);
      }
    }
  });

  test("stays legible with every signal unknown at once", () => {
    // Five dark blocks in one column is the state this lens is most likely to
    // be read in on a bad day. Each still carries its own question and its own
    // two sentences rather than collapsing into one repeated apology.
    assert.equal((html.match(/data-read="unreadable"/g) ?? []).length, SIGNALS.length);
    for (const question of [
      "Is the supervision cycle alive?",
      "Is the notification queue draining?",
      "Is away mode on, and is the home locked?",
      "Is anything waiting too long?",
      "Does any record disagree with reality?",
    ]) {
      assert.ok(html.includes(question), `${question} should still be asked`);
    }
  });
});

describe("the whole lens dark", () => {
  let panel: Panel;
  let html: string;
  before(async () => {
    // The health-dark set has no health file at all.
    panel = await startPanel({ port: nextPort(), fixtureSet: "health-dark", now: NOW });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("says it is dark by design rather than drawing a blank area", () => {
    assert.ok(html.includes('data-lens="shipshape" data-lens-status="unreadable"'));
    assert.ok(html.includes("Dark by design, not broken"));
    assert.ok(html.includes("carry no compatibility promise"), "why this lens alone can fail");
    for (const signal of SIGNALS) {
      assert.equal(read(html, signal), "unreadable", `${signal} still has a block`);
    }
  });

  test("leaves fleet and deck untouched beside it", () => {
    assert.ok(html.includes('data-lens="fleet" data-lens-status="fresh"'));
    assert.ok(html.includes('data-lens="deck" data-lens-status="fresh"'));
    assert.equal((html.match(/data-worker="/g) ?? []).length, 3, "the fleet still renders");
  });

  test("claims nothing about the state of the lenses it cannot see", () => {
    // This component is handed document.health and nothing else. Saying the
    // others are fine would be a lie the day both readers fail together.
    assert.ok(!html.includes("Fleet and deck are unaffected"));
    assert.ok(html.includes("carry their own status"), "the separation, not their state");
  });
});

describe("a mixed reading", () => {
  /**
   * Some signals readable and some not, with a cycle that calls itself alive
   * but was last seen four hours ago.
   *
   * Written into a private copy of the fixtures before the panel starts rather
   * than committed: it is one test's material, and the committed sets already
   * cover every combination the rest of the suite needs.
   *
   * It also carries no queue and no attendance key at all, which is a health
   * file written before those two signals existed. The module reads an absent
   * signal as that signal being dark rather than as a file whose shape changed,
   * so this is the predating-file path drawn on screen: two dark blocks beside
   * three that read.
   */
  const MIXED = {
    asOf: "2099-01-01T09:15:00.000Z",
    supervisor: { read: "ok", alive: true, lastSeen: "2099-01-01T05:15:00.000Z" },
    overdue: { read: "unreadable", detail: "The wait ledger could not be opened." },
    drift: {
      read: "ok",
      disagreements: [
        { record: "backlog", detail: "wi-lamplight-207 is queued here but has a worktree" },
      ],
    },
  };

  let panel: Panel;
  let html: string;
  before(async () => {
    const fixtureRoot = await copyFixtures();
    await writeFile(join(fixtureRoot, "healthy", "health.json"), JSON.stringify(MIXED, null, 2));
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: "healthy",
      fixtureRoot,
      now: NOW,
    });
    html = await body(panel);
  });
  after(() => panel.stop());

  test("keeps five verdicts rather than collapsing to one", () => {
    assert.equal(read(html, "supervisor"), "ok");
    assert.equal(read(html, "overdue"), "unreadable");
    assert.equal(read(html, "drift"), "ok");
    assert.equal(verdict(html, "drift"), "disagreeing");
  });

  test("draws a signal the health file predates as dark, not as the file refusing", () => {
    assert.equal(read(html, "queue"), "unreadable");
    assert.equal(read(html, "attendance"), "unreadable");
    assert.ok(html.includes("The health file carries no notification queue signal."));
    assert.ok(html.includes("The health file carries no away and lock signal."));
    for (const claim of [...READ_CLAIMS.queue, ...READ_CLAIMS.attendance]) {
      assert.ok(!html.includes(claim), `a signal the file predates should not claim ${claim}`);
    }
  });

  test("reads a cycle last seen long ago as a concern, not as health", () => {
    assert.equal(verdict(html, "supervisor"), "silent");
    assert.ok(html.includes("Alive but silent"));
    assert.ok(html.includes("quiet for longer than 10 minutes"), "the named threshold");
    assert.ok(html.includes("Last seen 4h ago"));
  });

  test("says nothing about the signal that did not read", () => {
    assert.ok(!html.includes("Nothing overdue"));
    assert.ok(html.includes("Whether anything has been waiting too long is unknown"));
  });

  test("keeps the lens itself current while one signal inside it is dark", () => {
    assert.ok(html.includes('data-lens="shipshape" data-lens-status="fresh"'));
    assert.ok(!html.includes("Dark by design"), "one dark signal is not a dark lens");
  });
});

/**
 * One signal dark at a time, at the seam the lens actually consumes.
 *
 * The notification queue and attendance are read from the same state directory
 * as two of the other three, so at the source they cannot be broken alone -
 * `tests/health.test.ts` pins the one break the queue does have of its own, and
 * pins that a state directory that has gone takes four signals with it. What
 * this file can pin, and what the acceptance is really about, is that the lens
 * never amplifies: a document carrying exactly one dark signal draws exactly
 * one dark block, keeps the other four verdicts, and leaves fleet and deck
 * alone beside it.
 */
describe("exactly one signal dark", () => {
  /** The healthy set's signals, with `name` replaced by an unreadable reading. */
  function onlyDark(name: string, detail: string): Record<string, unknown> {
    const signals: Record<string, unknown> = {
      supervisor: { read: "ok", alive: true, lastSeen: "2099-01-01T09:15:00.000Z" },
      queue: { read: "ok", queued: 0 },
      attendance: { read: "ok", away: false, locked: true },
      overdue: { read: "ok", overdue: [] },
      drift: { read: "ok", disagreements: [] },
    };
    signals[name] = { read: "unreadable", detail };
    return { asOf: "2099-01-01T09:15:00.000Z", ...signals };
  }

  /** The verdict every signal but `dark` keeps in the healthy set. */
  const CLEAN: Readonly<Record<string, string>> = {
    supervisor: "alive",
    queue: "empty",
    attendance: "present-held",
    overdue: "clear",
    drift: "clear",
  };

  for (const dark of ["queue", "attendance"] as const) {
    describe(`the ${dark} signal alone`, () => {
      const detail = `The ${dark} source did not answer.`;
      let panel: Panel;
      let html: string;
      before(async () => {
        const fixtureRoot = await copyFixtures();
        await writeFile(
          join(fixtureRoot, "healthy", "health.json"),
          JSON.stringify(onlyDark(dark, detail), null, 2),
        );
        panel = await startPanel({
          port: nextPort(),
          fixtureSet: "healthy",
          fixtureRoot,
          now: NOW,
        });
        html = await body(panel);
      });
      after(() => panel.stop());

      test("darkens itself and says what could not be read", () => {
        assert.equal(read(html, dark), "unreadable");
        assert.equal(verdict(html, dark), "unreadable");
        assert.ok(html.includes(detail), "the operator is told what did not answer");
      });

      test("never renders as healthy on the reading it did not get", () => {
        for (const claim of READ_CLAIMS[dark]) {
          assert.ok(!html.includes(claim), `a dark ${dark} should not claim ${claim}`);
        }
      });

      test("leaves the other four signals with the verdicts they had", () => {
        for (const other of SIGNALS.filter((signal) => signal !== dark)) {
          assert.equal(read(html, other), "ok", `${other} should still read`);
          assert.equal(verdict(html, other), CLEAN[other]);
        }
        assert.equal((html.match(/data-read="unreadable"/g) ?? []).length, 1);
      });

      test("leaves the lens current, and fleet and deck untouched", () => {
        assert.ok(html.includes('data-lens="shipshape" data-lens-status="fresh"'));
        assert.ok(!html.includes("Dark by design"), "one dark signal is not a dark lens");
        assert.ok(html.includes('data-lens="fleet" data-lens-status="fresh"'));
        assert.ok(html.includes('data-lens="deck" data-lens-status="fresh"'));
        assert.equal((html.match(/data-worker="/g) ?? []).length, 12, "the fleet still renders");
      });
    });
  }
});
