import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { REPO_ROOT } from "./lib/server.ts";
import { formatViolation } from "./lib/violation.ts";

/**
 * This repository is public and the tool it holds reads a private fleet.
 *
 * No real project name, machine path, home directory or task identifier may
 * ever land in it. That is a promise nobody can keep by remembering, so it is
 * checked on every run instead - over the tracked files, which is exactly the
 * set that would be published.
 */

/** Every pattern here would identify a real machine, operator or task. */
const LEAKS: [RegExp, string][] = [
  [/\/Users\/[A-Za-z0-9._-]+/, "a macOS home directory"],
  [/\/home\/[A-Za-z0-9._-]+/, "a Linux home directory"],
  [/\/(?:private\/)?(?:var|tmp)\/folders\//, "a machine-local temporary path"],
  [/~\/[A-Za-z0-9._-]+\//, "a path under someone's home directory"],
  [/\btreehouse\b/, "a worktree pool path"],
  [/\bqd-[a-z]+-s\d+\b/, "a fleet task identifier"],
];

/**
 * Files whose content is not prose we control. `package-lock.json` records
 * registry URLs, which are neither private nor machine-specific.
 */
const EXEMPT = new Set(["package-lock.json", "skills-lock.json"]);

/**
 * Vendored third-party content, refreshed wholesale by `npx skills add` and
 * never authored here. It documents where other tools keep their own config,
 * under home-relative paths that name nobody's machine - and rewriting
 * upstream's docs to satisfy our guard would only fail again on the next
 * refresh. Note that this file is scanned too: keep example paths out of it.
 */
const EXEMPT_TREES = [".agents/skills/"];

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

test("no tracked file names a real machine, operator or task", () => {
  const files = trackedFiles();
  assert.ok(files.length > 20, "git ls-files found nothing to check");

  for (const file of files) {
    if (EXEMPT.has(file)) continue;
    if (EXEMPT_TREES.some((tree) => file.startsWith(tree))) continue;

    let text: string;
    try {
      text = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      continue; // Unreadable as text, and so not prose that could carry a path.
    }

    for (const [pattern, what] of LEAKS) {
      const match = pattern.exec(text);
      if (!match) continue;
      assert.fail(
        `\n\n${formatViolation({
          slug: "private-data-leak",
          file,
          line: text.slice(0, match.index).split("\n").length,
          what: `"${match[0]}" is ${what}. Nothing that identifies a real machine, operator, project or task belongs in this repository.`,
          why: "The repository is public and the tool reads a private fleet. All test material is synthetic from the first commit so nobody has to judge, later and in a hurry, whether a particular sample is safe to publish.",
          fix: "Replace it with an invented equivalent - fixtures/README.md shows the naming the fixture fleets use - or take the value from configuration at runtime.",
          doc: "docs/principles.md - nothing real in the repository",
        })}\n`,
      );
    }
  }
});
