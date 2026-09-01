import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { REPO_ROOT, SERVER_ENTRY } from "./lib/server.ts";
import { formatViolation } from "./lib/violation.ts";

/**
 * The suite drives the built server, so a stale build would let the tests pass
 * against code nobody is running. This is the check that makes acceptance
 * "tests run against the built output" mean something.
 */

function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  if (!statSync(path).isDirectory()) return statSync(path).mtimeMs;
  let latest = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    latest = Math.max(latest, newestMtime(join(path, entry.name)));
  }
  return latest;
}

const BUILD_INPUTS = [
  "src",
  "package.json",
  "next.config.ts",
  "tsconfig.json",
  "components.json",
  "postcss.config.mjs",
];

test("the build is newer than the source it was built from", () => {
  const builtAt = existsSync(SERVER_ENTRY) ? statSync(SERVER_ENTRY).mtimeMs : 0;
  const sourceAt = Math.max(
    ...BUILD_INPUTS.map((p) => newestMtime(join(REPO_ROOT, p))),
  );

  assert.ok(
    builtAt > sourceAt,
    formatViolation({
      slug: "stale-build",
      file: ".next/standalone/server.js",
      line: 1,
      what:
        builtAt === 0
          ? "There is no built output. The suite drives the built server, not src/."
          : "The build is older than the source. The suite drives the built server, not src/.",
      why: "Tests that read src/ would pass against code nobody is running, which is exactly the failure a test suite exists to prevent.",
      fix: "Run npm run build, then npm test again.",
      doc: "docs/ARCHITECTURE.md - tests",
    }),
  );
});
