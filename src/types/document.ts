/**
 * The panel's own document: the single shape `src/ui/` renders.
 *
 * This file is the head of the layer order and imports nothing, deliberately.
 * Anything the UI needs to show has to arrive here first, which is what stops
 * a component from reaching back into the fleet to fetch one missing field.
 *
 * Version history lives in docs/contract.md.
 */

/** Bumped when this shape changes in a way a reader must notice. */
export const DOCUMENT_VERSION = 1;

/**
 * What a worker is doing, in the panel's vocabulary rather than upstream's.
 * The projection in `src/domain/` maps upstream states onto these; keeping the
 * two vocabularies separate is what lets upstream rename a state without the
 * UI changing.
 */
export type WorkerState =
  | "running"
  | "idle"
  | "held"
  | "queued"
  | "finished"
  | "failed";

/** What kind of work a worker was dispatched to do. */
export type WorkerKind = "implement" | "review" | "research" | "chore";

export interface Worker {
  /** Stable within a snapshot; the UI's React key. */
  readonly id: string;
  readonly project: string;
  readonly kind: WorkerKind;
  readonly state: WorkerState;
  /** ISO-8601 instant the worker entered `state`. */
  readonly since: string;
}

/**
 * Why the document in hand is not a faithful, current picture of the fleet.
 *
 * `null` means it is. Anything else means the panel is still showing something
 * useful — never a blank page, never an error page — and owes the operator an
 * explanation of what is wrong with it.
 */
export interface Degradation {
  readonly reason: DegradationReason;
  /** One line, written for the operator, naming the concrete problem. */
  readonly detail: string;
  /** ISO-8601 instant the panel noticed. */
  readonly observedAt: string;
}

export type DegradationReason =
  /** The snapshot parsed, but it was generated too long ago to trust. */
  | "stale-snapshot"
  /** A read failed; this is the last document that did parse. */
  | "read-failed";

export interface FleetDocument {
  readonly version: number;
  /** ISO-8601 instant the underlying snapshot was generated. */
  readonly generatedAt: string;
  readonly workers: readonly Worker[];
  readonly degraded: Degradation | null;
}
