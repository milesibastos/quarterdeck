import assert from "node:assert/strict";
import { test } from "node:test";
import {
  derivePort,
  PORT_RANGE_SIZE,
  PORT_RANGE_START,
} from "../src/config/port.ts";
import {
  KUBERNETES_NODEPORT_FLOOR,
  LINUX_EPHEMERAL_FLOOR,
  TEST_BAND_SIZE,
  TEST_BAND_START,
} from "./lib/band.ts";

/**
 * Two worktrees must be able to run their panels side by side, and each must
 * always answer on the same URL. Both properties come from the derivation being
 * a pure function of the absolute path.
 *
 * Nothing below names a port. A test that asserted `derivePort("/x") === 28517`
 * would pin today's arithmetic and say nothing about why the band is where it
 * is; what has to hold is that the ports are stable, that they spread, and that
 * they land under every floor `tests/lib/band.ts` names.
 */

const PATHS = Array.from({ length: 500 }, (_, i) => `/fake-root/worktree-${i}`);

test("a path always derives the same port", () => {
  assert.equal(derivePort("/fake-root/one"), derivePort("/fake-root/one"));
});

test("the derivation spreads paths across the whole range", () => {
  const ports = new Set(PATHS.slice(0, 200).map(derivePort));

  // A 1000-wide range cannot promise no collisions: uniform hashing of 200
  // paths yields about 181 distinct values, and this asserts the hash is not
  // degenerate rather than that collisions never happen. Two worktrees that do
  // collide set QUARTERDECK_PORT; see src/config/index.ts.
  assert.ok(
    ports.size > 160,
    `only ${ports.size} distinct ports across 200 paths`,
  );

  const buckets = new Set(
    [...ports].map((p) => Math.floor((p - PORT_RANGE_START) / 100)),
  );
  assert.equal(
    buckets.size,
    10,
    "every hundred-port band of the range is reachable",
  );
});

test("every derived port lands inside the band", () => {
  for (const port of PATHS.map(derivePort)) {
    assert.ok(port >= PORT_RANGE_START, `${port} is below the band`);
    assert.ok(
      port < PORT_RANGE_START + PORT_RANGE_SIZE,
      `${port} is above the band`,
    );
  }
});

/**
 * The 2026-09-01 defect, as an assertion: the band the panel derives into has
 * to clear every range something else hands out on its own. Stated against the
 * band's boundaries rather than against sampled ports, because it is a property
 * of the two numbers and holds for every path there is.
 */
test("the band clears every floor a kernel or a scheduler allocates from", () => {
  const bandEnd = PORT_RANGE_START + PORT_RANGE_SIZE;

  assert.ok(
    bandEnd <= LINUX_EPHEMERAL_FLOOR,
    "Linux hands out 32768+ as ephemeral source ports, so the kernel can hold " +
      "a port in this band before the panel binds it",
  );
  assert.ok(
    bandEnd <= KUBERNETES_NODEPORT_FLOOR,
    "Kubernetes allocates NodePort services from 30000-32767",
  );
  assert.ok(
    PORT_RANGE_START >= 1024,
    "below 1024 needs privilege the panel does not have",
  );
  assert.ok(
    PORT_RANGE_START >= TEST_BAND_START + TEST_BAND_SIZE ||
      bandEnd <= TEST_BAND_START,
    "a panel that can derive into the suite's band can be sat on by a test run",
  );
});
