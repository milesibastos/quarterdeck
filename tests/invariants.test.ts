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

test("a violation under a multi-line block comment is still reported at its true line", () => {
  // path-quarantine's planted tree carries a multi-line header comment above
  // its violation on purpose: stripping comments must not shift line numbers,
  // or every check built on codeLines() would misreport where the fault is.
  const found = runChecks(join(VIOLATIONS_ROOT, "path-quarantine"));
  assert.deepEqual(
    found.map((v) => `${v.file}:${v.line}`),
    ["src/runtime/paths.ts:7"],
  );
});

test("no-egress finds a URL past JSX prose and a comment, not inside one", () => {
  // no-egress's planted tree exercises three ways comment/string stripping
  // has broken before: adapters/health.ts carries a protocol-relative literal
  // at the position health.ts occupies in src/ (the one file exempt from
  // path-quarantine, so this check is the only thing that can catch it) with
  // the same host repeated in a comment that must NOT be flagged; ui/apostrophe.tsx
  // carries an apostrophe in JSX text and a multi-line template literal ahead
  // of a real violation, proving neither desyncs comment/string classification
  // for what follows.
  const found = runChecks(join(VIOLATIONS_ROOT, "no-egress"));
  assert.deepEqual(
    found.map((v) => `${v.file}:${v.line}`).sort(),
    [
      "src/adapters/health.ts:2",
      "src/ui/apostrophe.tsx:10",
      "src/ui/fonts/fonts.ts:2",
      "src/ui/fonts/fonts.ts:5",
    ],
  );
});

test("a .ts file's generic arrow does not swallow a later comment as code", () => {
  // Parsing every file as TSX read `<T>(x: T): T => x` - ordinary in a plain
  // .ts file, which has no JSX grammar to compete with `<` - as an unclosed
  // JSX tag, collapsing everything after it into one JsxText leaf that
  // stripComments could not see into. The comment two lines later, which only
  // mentions a URL as prose, was then scanned as code and flagged. Parsing a
  // .ts file as ts.ScriptKind.TS keeps the generic a generic and the comment
  // a comment.
  const found = runChecks(join(VIOLATIONS_ROOT, "no-egress"), "no-egress");
  assert.deepEqual(
    found.filter((v) => v.file === "src/domain/generic-arrow.ts"),
    [],
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
