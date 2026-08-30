/**
 * THE QUARANTINED MODULE.
 *
 * This is the only file permitted to name fleet-internal paths (invariant 4).
 * Those paths are an implementation detail of the fleet supervisor and carry no
 * compatibility promise: they get renamed, moved, and restructured without
 * notice. Confining them here means that when upstream moves, exactly one
 * file's tests fail and exactly one file needs editing.
 *
 * The rule that comes with that privilege: **this module degrades, it does not
 * throw.** A path that has moved must produce `unknown`, never an exception
 * that takes the panel down. The panel's job is to stay useful and say what it
 * does not know.
 *
 * In this skeleton nothing is read yet, so every field is `unknown` by
 * construction rather than by failure. The shape is here so the shipshape lens
 * has something to grow into.
 */

export type HealthState = "ok" | "degraded" | "down" | "unknown";

export interface FleetHealth {
  /** Is the supervisor process alive? */
  readonly supervisor: HealthState;
  /** Is the fleet's own state directory readable and current? */
  readonly stateStore: HealthState;
  /** Is the snapshot writer keeping up? */
  readonly snapshotWriter: HealthState;
  /** ISO-8601 instant this reading was taken, or null when nothing was read. */
  readonly checkedAt: string | null;
}

const UNKNOWN: FleetHealth = {
  supervisor: "unknown",
  stateStore: "unknown",
  snapshotWriter: "unknown",
  checkedAt: null,
};

/**
 * Returns `unknown` for every field. The shipshape lens is later work; until it
 * exists there is nothing here to read, and reporting `unknown` is the honest
 * answer rather than a placeholder that reads as healthy.
 */
export async function readHealth(): Promise<FleetHealth> {
  return UNKNOWN;
}
