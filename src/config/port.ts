import { createHash } from "node:crypto";

/**
 * Two worktrees of this repository must be able to run their panels at the same
 * time. Asking the operator to pass a port, or scanning for a free one, both
 * mean the URL changes between runs; deriving it from the worktree's absolute
 * path means each checkout always answers on the same port and no two
 * checkouts collide unless their paths do.
 *
 * The range sits below the ephemeral range (49152+ on macOS and Linux) so the
 * kernel never hands our port to something else first.
 */
export const PORT_RANGE_START = 45000;
export const PORT_RANGE_SIZE = 1000;

export function derivePort(absolutePath: string): number {
  const digest = createHash("sha256").update(absolutePath).digest();
  return PORT_RANGE_START + (digest.readUInt32BE(0) % PORT_RANGE_SIZE);
}
