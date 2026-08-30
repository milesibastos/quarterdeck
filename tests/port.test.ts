import assert from "node:assert/strict";
import { test } from "node:test";
import { derivePort, PORT_RANGE_SIZE, PORT_RANGE_START } from "../src/config/port.ts";

/**
 * Two worktrees must be able to run their panels side by side, and each must
 * always answer on the same URL. Both properties come from the derivation being
 * a pure function of the absolute path.
 */

test("a path always derives the same port", () => {
  assert.equal(derivePort("/fake-root/one"), derivePort("/fake-root/one"));
});

test("the derivation spreads paths across the whole range", () => {
  const paths = Array.from({ length: 200 }, (_, i) => `/fake-root/worktree-${i}`);
  const ports = new Set(paths.map(derivePort));

  // A 1000-wide range cannot promise no collisions: uniform hashing of 200
  // paths yields about 181 distinct values, and this asserts the hash is not
  // degenerate rather than that collisions never happen. Two worktrees that do
  // collide set QUARTERDECK_PORT; see src/config/index.ts.
  assert.ok(ports.size > 160, `only ${ports.size} distinct ports across 200 paths`);

  const buckets = new Set([...ports].map((p) => Math.floor((p - PORT_RANGE_START) / 100)));
  assert.equal(buckets.size, 10, "every hundred-port band of the range is reachable");
});

test("ports land below the ephemeral range", () => {
  for (let i = 0; i < 500; i += 1) {
    const port = derivePort(`/fake-root/${i}`);
    assert.ok(port >= PORT_RANGE_START);
    assert.ok(port < PORT_RANGE_START + PORT_RANGE_SIZE);
    assert.ok(port < 49152, "the kernel hands out 49152+ as ephemeral ports");
  }
});
