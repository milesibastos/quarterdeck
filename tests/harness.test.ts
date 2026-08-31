import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { derivePort, PORT_RANGE_START } from "../src/config/port.ts";
import {
  BLOCK_SIZE,
  allocate,
  portAt,
  portsFor,
  testFiles,
} from "./lib/ports.ts";
import { checkHandPickedPorts } from "./lib/port-usage.ts";
import { REPO_ROOT, stopChild } from "./lib/server.ts";
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
 */

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

        assert.ok(port >= PORT_RANGE_START, `${port} is below the range`);
        assert.ok(
          port < 49152,
          "the kernel hands out 49152+ as ephemeral ports",
        );
        assert.notEqual(
          port,
          panelPort,
          `${block.file}'s port collides with the panel's own derived port ${panelPort}`,
        );
      }
    }
  });

  test("a file that is not a test file has no block", () => {
    assert.throws(
      () => portsFor(join(REPO_ROOT, "tests", "lib", "server.ts")),
      /has no port block/,
    );
  });

  test("a file gets one claim, and no more ports than its block holds", () => {
    const nextPort = portsFor(import.meta.filename);
    assert.throws(
      () => portsFor(import.meta.filename),
      /already claimed its ports/,
    );

    const drawn = new Set<number>();
    for (let i = 0; i < BLOCK_SIZE; i += 1) drawn.add(nextPort());
    assert.equal(drawn.size, BLOCK_SIZE, "every port in a block is distinct");
    assert.throws(nextPort, /Raise BLOCK_SIZE/);
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
