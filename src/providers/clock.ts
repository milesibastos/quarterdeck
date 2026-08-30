/**
 * The clock, as a dependency.
 *
 * Nothing outside this file calls `Date.now()` or `new Date()`. The projection
 * decides whether a document is stale by comparing its `generatedAt` to "now",
 * so "now" has to be something a test can pin, or staleness is untestable
 * without waiting for real time to pass.
 */
export interface Clock {
  /** The current instant, as ISO-8601. */
  now(): string;
  /** The current instant, in epoch milliseconds. */
  nowMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  nowMs: () => Date.now(),
};

/** A clock pinned to a fixed instant. For tests, and for fixture rendering. */
export function fixedClock(instant: string): Clock {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) {
    throw new TypeError(`fixedClock: not an ISO-8601 instant: ${instant}`);
  }
  return { now: () => new Date(ms).toISOString(), nowMs: () => ms };
}
