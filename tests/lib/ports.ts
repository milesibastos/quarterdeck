import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { derivePort, PORT_RANGE_START } from "../../src/config/port.ts";
import { REPO_ROOT } from "./server.ts";

/**
 * Which panel ports each test file may use.
 *
 * `node --test` runs test files in parallel processes, and every file that
 * drives the panel starts a real server on a real port. Two files on the same
 * port do not fail cleanly: the loser's panel never binds, its requests are
 * answered by the winner's, and its stop waits on a child that is not the one
 * holding the port. So no test file picks a number. A file claims a block by
 * naming itself - `portsFor(import.meta.filename)` - and the block comes from
 * where the file sorts among the test files, which no two files can share.
 *
 * The claim is checked rather than assumed: `allocate` refuses a claim list in
 * which two files land on the same block, and names both. Nothing here can
 * produce such a list; the check is there for whatever replaces `claims()`.
 */

/**
 * Ports per test file. The hungriest file uses eleven; this leaves room to add
 * a panel to it, and the window still holds fifty-six files at this size.
 */
export const BLOCK_SIZE = 16;

/** The offsets the panel's own derived port is spread over. */
const WINDOW = 900;

const TESTS_DIR = join(REPO_ROOT, "tests");

/** One test file's reserved block, as offsets into the window. */
export interface Block {
  readonly file: string;
  readonly firstOffset: number;
  readonly size: number;
}

/** A test file's claim on one block, before it has been checked. */
export interface Claim {
  readonly file: string;
  readonly slot: number;
}

/** Every test file, as a path relative to `tests/`, in a stable order. */
export function testFiles(dir: string = TESTS_DIR): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".test.ts"))
    .map((entry) => entry.split(sep).join("/"))
    .sort();
}

/**
 * The claims the suite makes: one slot per test file, in sorted order.
 *
 * Sorted position is the whole policy. It is a pure function of the file's own
 * path, every process computes the same answer from the same directory, and two
 * distinct paths cannot occupy one position.
 */
export function claims(files: readonly string[] = testFiles()): Claim[] {
  return files.map((file, slot) => ({ file, slot }));
}

/**
 * Turns claims into blocks, refusing any two that overlap.
 *
 * This is the loud failure the old hand-picked offsets never had: a collision
 * stops the run at once, naming both files, instead of becoming a race that one
 * of them loses on a machine nobody is watching.
 */
export function allocate(claimed: readonly Claim[] = claims()): Map<string, Block> {
  const bySlot = new Map<number, string>();
  const blocks = new Map<string, Block>();

  for (const { file, slot } of claimed) {
    const held = bySlot.get(slot);
    if (held !== undefined) {
      throw new Error(
        `${held} and ${file} both claim panel port slot ${slot}. Two test files cannot ` +
          `use the same ports: they run in parallel and would race for the same panel. ` +
          `Give each file a slot of its own - tests/lib/ports.ts derives one from where ` +
          `the file sorts, so this should be unreachable.`,
      );
    }
    if (blocks.has(file)) {
      throw new Error(`${file} claims two port slots; a test file gets exactly one.`);
    }
    bySlot.set(slot, file);
    blocks.set(file, { file, firstOffset: slot * BLOCK_SIZE, size: BLOCK_SIZE });
  }

  const needed = bySlot.size * BLOCK_SIZE;
  if (needed > WINDOW) {
    throw new Error(
      `${bySlot.size} test files at ${BLOCK_SIZE} ports each need ${needed} of the ` +
        `${WINDOW} the range offers. Lower BLOCK_SIZE in tests/lib/ports.ts.`,
    );
  }
  return blocks;
}

/**
 * The port at one offset.
 *
 * Derived from the worktree like the panel's own, so two checkouts can run the
 * suite at once, then shifted clear of the port the panel itself would bind -
 * an author may well have one running while the suite runs.
 */
export function portAt(offset: number): number {
  return ((derivePort(REPO_ROOT) - PORT_RANGE_START + offset + 100) % WINDOW) + PORT_RANGE_START + 50;
}

const claimedHere = new Set<string>();

/**
 * This file's ports. Call once per test file, with `import.meta.filename`, and
 * call the result for each panel the file starts.
 */
export function portsFor(filename: string): () => number {
  const file = relative(TESTS_DIR, filename).split(sep).join("/");
  const block = allocate().get(file);
  if (!block) {
    throw new Error(
      `${file} is not one of the test files under tests/, so it has no port block. ` +
        `Pass import.meta.filename from a *.test.ts file.`,
    );
  }
  if (claimedHere.has(file)) {
    throw new Error(`${file} already claimed its ports; call portsFor once per test file.`);
  }
  claimedHere.add(file);

  let used = 0;
  return () => {
    if (used >= block.size) {
      throw new Error(
        `${file} wants more than the ${block.size} ports its block holds. Raise ` +
          `BLOCK_SIZE in tests/lib/ports.ts, or start fewer panels.`,
      );
    }
    const offset = block.firstOffset + used;
    used += 1;
    return portAt(offset);
  };
}
