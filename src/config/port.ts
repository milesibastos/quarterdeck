import { createHash } from "node:crypto";

/**
 * Two worktrees of this repository must be able to run their panels at the same
 * time. Asking the operator to pass a port, or scanning for a free one, both
 * mean the URL changes between runs; deriving it from the worktree's absolute
 * path means each checkout always answers on the same port, and two distinct
 * paths land on the same one only by a roughly 1-in-1000 hash collision - at
 * which point `bin/quarterdeck`'s port-taken check refuses to start rather
 * than colliding silently.
 *
 * The range sits below macOS's ephemeral floor (49152+), so the kernel never
 * hands our port to something else first there. Linux's default floor is
 * lower (32768+) and does reach into this range - a smaller, unfixed risk
 * than the one that moved this suite's own test ports into a band of their
 * own; see
 * `docs/decisions/2026-09-01-the-band-still-sat-in-the-kernels-range.md`.
 */
export const PORT_RANGE_START = 45000;
export const PORT_RANGE_SIZE = 1000;

export function derivePort(absolutePath: string): number {
  const digest = createHash("sha256").update(absolutePath).digest();
  return PORT_RANGE_START + (digest.readUInt32BE(0) % PORT_RANGE_SIZE);
}
