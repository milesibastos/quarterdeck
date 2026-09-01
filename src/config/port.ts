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
 * The band is 28000-28999, and every one of its four boundaries is somebody
 * else's floor rather than a taste:
 *
 * - 32768, where Linux starts handing out ephemeral source ports
 *   (`/proc/sys/net/ipv4/ip_local_port_range`, observed 32768-60999);
 * - 30000, where Kubernetes starts allocating NodePort services;
 * - 29000, where this suite's own test ports begin (`tests/lib/band.ts`);
 * - 49152, the IANA dynamic range and macOS's and Windows' ephemeral floor.
 *
 * Under all four, 28000-28999 is the only whole thousand left. The previous
 * band, 45000-45999, cleared only the last of them: it sat below macOS's
 * ephemeral floor, which is why this fleet never saw the kernel take a panel's
 * port first, and inside Linux's, which is where it would have. See
 * `docs/decisions/2026-09-01-the-panel-band-clears-every-kernel.md`.
 */
export const PORT_RANGE_START = 28000;
export const PORT_RANGE_SIZE = 1000;

export function derivePort(absolutePath: string): number {
  const digest = createHash("sha256").update(absolutePath).digest();
  return PORT_RANGE_START + (digest.readUInt32BE(0) % PORT_RANGE_SIZE);
}
