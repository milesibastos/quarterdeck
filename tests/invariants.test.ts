import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { CHECKS, plantedTrees, runChecks, type CheckName } from "./lib/invariants.ts";
import { formatViolation, formatViolations } from "./lib/violation.ts";
import { REPO_ROOT } from "./lib/server.ts";

/**
 * The checks are the foundation every other rule rests on, so they are tested
 * twice: silent on the real source, and loud on a tree planted to break them.
 * A check that quietly stopped matching would let every rule it guards rot.
 */

const VIOLATIONS_ROOT = join(REPO_ROOT, "tests", "violations");

test("src/ satisfies every invariant", () => {
  const violations = runChecks(join(REPO_ROOT, "src"));
  assert.deepEqual(
    violations,
    [],
    `\n\n${formatViolations(violations)}\n`,
  );
});

test("every check has a planted violation to prove it works", () => {
  assert.deepEqual(
    plantedTrees(VIOLATIONS_ROOT).sort(),
    Object.keys(CHECKS).sort(),
    "each check needs a tree under tests/violations/ named after its slug",
  );
});

for (const name of Object.keys(CHECKS) as CheckName[]) {
  test(`${name} reports its planted violation`, () => {
    const found = runChecks(join(VIOLATIONS_ROOT, name));

    assert.ok(found.length > 0, `${name} did not report its planted violation`);
    assert.deepEqual(
      [...new Set(found.map((v) => v.slug))],
      [name],
      `${name}'s tree tripped a different check: ${formatViolations(found)}`,
    );

    // The message shape is the contract: an agent reads it and acts on it.
    const lines = formatViolation(found[0]).split("\n");
    assert.match(lines[0], new RegExp(`^x ${name}  \\S+\\.tsx?:\\d+$`));
    assert.ok(
      lines.slice(1, -1).every((l) => l.startsWith("  ")),
      "the body of a violation is indented under its heading",
    );
    assert.match(lines.at(-1)!, /^ {2}See \S+\.md - .+\.$/);
    assert.ok(lines.length >= 5, "a violation states what, why, and the fix");
  });
}
