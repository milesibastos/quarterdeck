import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  derivePort,
  PORT_RANGE_SIZE,
  PORT_RANGE_START,
} from "../src/config/port.ts";
import { TEST_BAND_SIZE, TEST_BAND_START } from "./lib/band.ts";
import {
  BLOCK_SIZE,
  allocate,
  portAt,
  portsFor,
  testFiles,
} from "./lib/ports.ts";
import { checkHandPickedPorts } from "./lib/port-usage.ts";
import {
  REPO_ROOT,
  explainEarlyDeath,
  startPanel,
  stopChild,
  whatAnswersOn,
} from "./lib/server.ts";
import { formatViolation, formatViolations } from "./lib/violation.ts";

/**
 * The test harness itself, where the suite's own failure modes live.
 *
 * Two of them cost real time before this file existed. Test files picked panel
 * ports by hand, so two of them claimed the same range and raced whenever
 * `node --test` ran them together; and `stop()` waited on the child forever, so
 * the loser of that race did not fail - it hung, and took a CI job with it. A
 * suite that fails by hanging costs an hour to learn nothing, which is why both
 * the allocation contract and the bounded stop are asserted here rather than
 * trusted.
 *
 * The third cost a day. Allocation keeps this suite's files off each other's
 * ports and says nothing about the rest of the machine, so a sibling checkout's
 * panel sitting on one of these ports was answered, believed, and asserted
 * against - as wrong content, never as a port clash. The suite now draws from a
 * band no panel can be derived into, which removes the panel half of that for
 * good; a sibling checkout running this same suite remains, and is what the
 * occupancy check below is for.
 */

/**
 * This file's own ports, claimed once at module scope because two tests below
 * draw from the same supply: the refusal proof takes the ports it squats on,
 * and the exhaustion test - registered last, so it runs last - drains whatever
 * is left.
 */
const nextPort = portsFor(import.meta.filename);
const drawnHere = new Set<number>();

/**
 * Where the kernel starts handing out ephemeral source ports on Linux.
 *
 * `/proc/sys/net/ipv4/ip_local_port_range` defaults to 32768-60999 - lower
 * than macOS's 49152, and the reason 46000-46999 still let an outbound
 * connection this suite made land on a port a panel was about to bind.
 */
const LINUX_EPHEMERAL_FLOOR = 32768;

/** Something on a port that is not a panel, for the tests that need one. */
function squat(port: number, body: string): Promise<Server> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(body);
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve(server)),
  );
}

const closed = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

describe("no two test files can claim the same panel ports", () => {
  test("a collision is refused, and names both claimants", () => {
    assert.throws(
      () =>
        allocate([
          { file: "answering.test.ts", slot: 3 },
          { file: "shipshape-lens.test.ts", slot: 3 },
        ]),
      (error: Error) =>
        error.message.includes("answering.test.ts") &&
        error.message.includes("shipshape-lens.test.ts") &&
        /slot 3/.test(error.message),
      "a duplicate claim must fail loudly, naming both files",
    );
  });

  test("one file cannot hold two blocks", () => {
    assert.throws(
      () =>
        allocate([
          { file: "a.test.ts", slot: 0 },
          { file: "a.test.ts", slot: 1 },
        ]),
      /a\.test\.ts claims two port slots/,
    );
  });

  test("more files than the range holds is refused, not wrapped around", () => {
    const tooMany = Array.from({ length: 1000 }, (_, slot) => ({
      file: `f${slot}.test.ts`,
      slot,
    }));
    assert.throws(() => allocate(tooMany), /Lower BLOCK_SIZE/);
  });

  test("the suite as it stands allocates every file a block of its own", () => {
    const files = testFiles();
    assert.ok(
      files.includes("harness.test.ts"),
      "discovery should find this very file",
    );

    const blocks = allocate();
    assert.equal(blocks.size, files.length);

    const owner = new Map<number, string>();
    const panelPort = derivePort(REPO_ROOT);
    for (const block of blocks.values()) {
      for (let i = 0; i < block.size; i += 1) {
        const port = portAt(block.firstOffset + i);
        const held = owner.get(port);
        assert.equal(
          held,
          undefined,
          `${held} and ${block.file} would share port ${port}`,
        );
        owner.set(port, block.file);

        assert.ok(port >= TEST_BAND_START, `${port} is below the band`);
        assert.ok(
          port < TEST_BAND_START + TEST_BAND_SIZE,
          `${port} is above the band`,
        );
        assert.notEqual(
          port,
          panelPort,
          `${block.file}'s port collides with the panel's own derived port ${panelPort}`,
        );
      }
    }
  });

  /**
   * The 2026-09-01 defect, as an assertion.
   *
   * A worker's suite in a disposable worktree drew 45229 and met the operator's
   * panel from the primary checkout, which derives exactly that. The two
   * worktrees do not collide by hash - 45659 and 45229 - and nothing was
   * hashing the wrong path. The suite simply drew from the thousand ports every
   * checkout's panel is derived into, so it could land on any of them.
   *
   * Stating it as "this worktree and the primary checkout must not agree" would
   * be the wrong test: it names two paths, and the collision is with whatever
   * checkout happens to exist. What actually has to hold is that no port this
   * suite can hand out is reachable by `derivePort` at all, for any path
   * whatsoever - which is a property of the two ranges and needs no paths.
   */
  test("no test port is one any checkout's panel could take", () => {
    const panelRangeEnd = PORT_RANGE_START + PORT_RANGE_SIZE;

    for (const block of allocate().values()) {
      for (let i = 0; i < block.size; i += 1) {
        const port = portAt(block.firstOffset + i);
        assert.ok(
          port < PORT_RANGE_START || port >= panelRangeEnd,
          `${block.file} would use port ${port}, which is inside the ` +
            `${PORT_RANGE_START}-${panelRangeEnd - 1} range every checkout's panel ` +
            `is derived into - so a panel in any other checkout can be sitting on it`,
        );
        assert.ok(
          port < LINUX_EPHEMERAL_FLOOR,
          "the kernel can hand this out as an outbound source port, on Linux, " +
            "once a listener above 32768 is free",
        );
      }
    }
  });

  test("the band cannot overlap the range the panels are derived into", () => {
    assert.ok(
      TEST_BAND_START >= PORT_RANGE_START + PORT_RANGE_SIZE ||
        TEST_BAND_START + TEST_BAND_SIZE <= PORT_RANGE_START,
      "the two bands must be disjoint, or a suite can land on a foreign panel",
    );
    assert.ok(
      TEST_BAND_START + TEST_BAND_SIZE <= LINUX_EPHEMERAL_FLOOR,
      "Linux's default ip_local_port_range starts at 32768, well below " +
        "macOS's 49152 - a band above either can be handed out from under a " +
        "listener that has not bound yet",
    );
  });

  test("a file that is not a test file has no block", () => {
    assert.throws(
      () => portsFor(join(REPO_ROOT, "tests", "lib", "server.ts")),
      /has no port block/,
    );
  });

  test("a file gets one claim, and no more", () => {
    assert.throws(
      () => portsFor(import.meta.filename),
      /already claimed its ports/,
    );
  });
});

/**
 * Every file that starts a panel takes its ports from the allocator.
 *
 * The contract is only worth as much as its coverage: one hand-written number
 * is enough to bring back the race it exists to prevent, and nothing else in
 * the suite would notice. Checked by parsing and walking the AST, the same
 * way `tests/lib/invariants.ts` checks `src/` - not by matching source text,
 * which a renamed binding or a string that merely looks like a violation
 * would defeat either way.
 */
describe("no test file picks a panel port by hand", () => {
  const sourceFileOf = (path: string) => {
    const text = readFileSync(join(REPO_ROOT, "tests", path), "utf8");
    return { path, text, lines: text.split("\n") };
  };
  const planted = (text: string) => [
    { path: "planted.test.ts", text, lines: text.split("\n") },
  ];

  test("the real suite draws every panel port from the allocator", () => {
    const violations = checkHandPickedPorts(testFiles().map(sourceFileOf));
    assert.deepEqual(violations, [], `\n\n${formatViolations(violations)}\n`);
  });

  test("a literal port fails the check, naming the file and line", () => {
    const source = [
      `const nextPort = portsFor(import.meta.filename);`,
      `startPanel({ port: 45231 });`,
    ].join("\n");
    const found = checkHandPickedPorts(planted(source));
    assert.equal(found.length, 1);
    assert.match(found[0].what, /chosen by hand/);
    assert.match(formatViolation(found[0]), /planted\.test\.ts:2/);
  });

  test("a name assigned from a literal is still a literal", () => {
    const source = [
      `const nextPort = portsFor(import.meta.filename);`,
      `const PORT = 45231;`,
      `startPanel({ port: PORT });`,
    ].join("\n");
    const found = checkHandPickedPorts(planted(source));
    assert.equal(
      found.length,
      1,
      "a numeric constant referenced by name must not defeat the check",
    );
    assert.match(found[0].what, /chosen by hand/);
  });

  test("a file that starts a panel without claiming a block is refused", () => {
    const found = checkHandPickedPorts(
      planted(`startPanel({ port: nextPort() });`),
    );
    assert.ok(
      found.some((v) => /without claiming a port block/.test(v.what)),
      "a file with no portsFor(import.meta.filename) claim must be refused",
    );
  });

  test("a port drawn directly from the allocator passes", () => {
    const source = [
      `const nextPort = portsFor(import.meta.filename);`,
      `startPanel({ port: nextPort() });`,
    ].join("\n");
    assert.deepEqual(checkHandPickedPorts(planted(source)), []);
  });

  test("a port drawn from a local variable passes", () => {
    const source = [
      `const nextPort = portsFor(import.meta.filename);`,
      `const port = nextPort();`,
      `startPanel({ port, fixtureSet: "healthy" });`,
    ].join("\n");
    assert.deepEqual(checkHandPickedPorts(planted(source)), []);
  });
});

/**
 * The suite will not test against a panel it did not start.
 *
 * The port squatted here is one of this file's own, rather than one another
 * file's block would hand out: taking a neighbour's port to prove a point would
 * be the very collision this is about, and would fail that file instead. What
 * matters is not whose block the number came from - it is that something the
 * suite did not start is on it, which is exactly what a sibling checkout
 * running this same suite is.
 */
describe("a panel refuses a port it does not own", () => {
  test("a port nobody holds answers nothing", async () => {
    const quiet = nextPort();
    drawnHere.add(quiet);
    assert.equal(await whatAnswersOn(quiet), null);
  });

  test("an occupied port is reported, quoting what answered", async () => {
    const taken = nextPort();
    drawnHere.add(taken);
    const server = await squat(taken, "<html>a different fleet</html>");
    try {
      const heard = await whatAnswersOn(taken);
      assert.ok(heard, "an occupied port must not read as free");
      assert.match(heard, /a different fleet/);
    } finally {
      await closed(server);
    }
  });

  test("starting a panel on an occupied port fails, naming the cause", async () => {
    const squatted = nextPort();
    drawnHere.add(squatted);
    const server = await squat(squatted, "<html>a different fleet</html>");

    try {
      await assert.rejects(
        () => startPanel({ port: squatted }),
        (error: Error) =>
          error.message.includes(`port ${squatted} is already answering`) &&
          error.message.includes("this suite did not start") &&
          /a different fleet/.test(error.message) &&
          /sibling checkout/.test(error.message) &&
          error.message.includes(`lsof -nP -iTCP:${squatted}`),
        "the failure must name a foreign occupant, not leave a content assertion to",
      );
    } finally {
      await closed(server);
    }
  });

  test("a panel that lost its port is not mistaken for a panel that crashed", () => {
    const message = explainEarlyDeath({
      port: 45231,
      url: "http://127.0.0.1:45231",
      exitCode: 1,
      stderr:
        "Error: listen EADDRINUSE: address already in use 127.0.0.1:45231",
      occupant: "HTTP/1.1 200 OK ... a different fleet",
    });
    assert.match(message, /never bound/);
    assert.match(message, /a server this suite did not start/);
    assert.match(message, /not as a port clash/);
  });

  test("a dead panel whose port still answers is read as a port clash", () => {
    const message = explainEarlyDeath({
      port: 45231,
      url: "http://127.0.0.1:45231",
      exitCode: 0,
      stderr: "",
      occupant: "HTTP/1.1 200 OK ... a different fleet",
    });
    assert.match(message, /still answering on port 45231/);
    assert.match(message, /A dead panel cannot be what answered/);
  });

  test("a dead panel whose port is silent is read as the panel's own failure", () => {
    const message = explainEarlyDeath({
      port: 45231,
      url: "http://127.0.0.1:45231",
      exitCode: 7,
      stderr: "TypeError: undefined is not a function",
      occupant: null,
    });
    assert.match(message, /the panel's own failure and not a port clash/);
    assert.match(message, /undefined is not a function/);
  });
});

const OBEDIENT = "setInterval(() => {}, 1000);";
const DEAF = "process.on('SIGTERM', () => {});" + OBEDIENT;

/**
 * A running child.
 *
 * It reports readiness on stdout and this waits for that, because signalling a
 * child that has not reached its first line yet kills it outright - which would
 * make the deaf child look obedient and the test pass for the wrong reason.
 */
function child(script: string): Promise<ChildProcess> {
  const spawned = spawn(
    process.execPath,
    ["-e", `${script} console.log("ready");`],
    {
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return new Promise((resolve) =>
    spawned.stdout!.once("data", () => resolve(spawned)),
  );
}

describe("stopping a panel is bounded", () => {
  test("a child that exits on SIGTERM is simply stopped", async () => {
    const started = Date.now();
    await stopChild(await child(OBEDIENT), "http://127.0.0.1:0", 10_000);
    assert.ok(
      Date.now() - started < 5_000,
      "a healthy stop must not approach the bound",
    );
  });

  test("a child that ignores SIGTERM fails its test rather than hanging", async () => {
    const deaf = await child(DEAF);
    const started = Date.now();

    await assert.rejects(
      () => stopChild(deaf, "http://127.0.0.1:0", 500),
      (error: Error) =>
        /did not exit within 500ms of SIGTERM/.test(error.message) &&
        error.message.includes(String(deaf.pid)),
      "the wait must end in a message saying what happened",
    );

    assert.ok(
      Date.now() - started < 5_000,
      "the failure must arrive near the bound, not later",
    );
    assert.notEqual(
      deaf.signalCode,
      null,
      "the child must not be left running",
    );
  });

  test("stopping an already-dead child is not an error", async () => {
    const dead = await child(OBEDIENT);
    await stopChild(dead, "http://127.0.0.1:0");
    await stopChild(dead, "http://127.0.0.1:0");
  });
});

/**
 * Registered last, because it empties this file's block: every test above that
 * needs a port has already taken one, and this drains whatever remains to reach
 * the bound. A block that wrapped around instead of ending would hand a second
 * file's port out as if it were free, which is the collision all of this is for.
 */
describe("a block hands out its size, and then says so", () => {
  test("the ports are distinct, and there are exactly BLOCK_SIZE of them", () => {
    let handed = drawnHere.size;
    assert.throws(() => {
      for (;;) {
        drawnHere.add(nextPort());
        handed += 1;
      }
    }, /Raise BLOCK_SIZE/);

    assert.equal(handed, BLOCK_SIZE, "a block hands out exactly its size");
    assert.equal(
      drawnHere.size,
      BLOCK_SIZE,
      "every port in a block is distinct",
    );
  });
});
