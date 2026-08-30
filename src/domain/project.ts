import type { FleetSnapshot, SnapshotWorkerState } from "../adapters/contract.ts";
import type { Clock } from "../providers/clock.ts";
import {
  DOCUMENT_VERSION,
  type Degradation,
  type FleetDocument,
  type Worker,
  type WorkerState,
} from "../types/document.ts";

/**
 * The projection: a parsed snapshot becomes the document the UI renders.
 *
 * Pure by construction. The only import from `adapters` is a type-only one, so
 * nothing in this file can reach a filesystem or a process even by accident,
 * and the whole projection can be exercised against fixtures with no fleet
 * anywhere near the test.
 */

/**
 * Upstream's state vocabulary is not ours. Mapping here rather than in the UI
 * means upstream can rename `done` without a component changing.
 */
const STATE: Readonly<Record<SnapshotWorkerState, WorkerState>> = {
  working: "running",
  idle: "idle",
  held: "held",
  queued: "queued",
  done: "finished",
  failed: "failed",
};

export interface ProjectOptions {
  readonly clock: Clock;
  /** A snapshot older than this is still shown, but marked stale. */
  readonly staleAfterMs: number;
}

function staleness(
  snapshot: FleetSnapshot,
  { clock, staleAfterMs }: ProjectOptions,
): Degradation | null {
  const ageMs = clock.nowMs() - Date.parse(snapshot.generatedAt);
  if (ageMs <= staleAfterMs) return null;
  // States the policy that was breached, not the age. How old the snapshot is
  // is already in `generatedAt`, and phrasing it for a reader is the UI's job.
  return {
    reason: "stale-snapshot",
    detail: `Snapshot is older than the ${Math.round(staleAfterMs / 1000)}s freshness window; the fleet may have moved on.`,
    observedAt: clock.now(),
  };
}

export function projectDocument(
  snapshot: FleetSnapshot,
  options: ProjectOptions,
): FleetDocument {
  const workers: Worker[] = snapshot.workers.map((w) => ({
    id: w.id,
    project: w.project,
    kind: w.kind,
    state: STATE[w.state],
    since: w.since,
  }));

  return {
    version: DOCUMENT_VERSION,
    generatedAt: snapshot.generatedAt,
    workers,
    degraded: staleness(snapshot, options),
  };
}

/**
 * Re-label a document the panel is still showing after a read failed.
 *
 * The alternative - replacing it with an error - throws away the only useful
 * thing on screen at the moment the operator most wants to look at it.
 */
export function markReadFailed(
  document: FleetDocument,
  detail: string,
  clock: Clock,
): FleetDocument {
  return {
    ...document,
    degraded: { reason: "read-failed", detail, observedAt: clock.now() },
  };
}
