import type { ForgeRead, ForgeReading } from "../adapters/forge.ts";
import type { FleetSnapshot, SnapshotTask } from "../adapters/contract.ts";
import type { Clock } from "../providers/clock.ts";
import type { Logger } from "../providers/logger.ts";

/**
 * The cost rule for reading the forge.
 *
 * Everything else the panel reads is on this machine and costs a file open. The
 * forge is over the network, and a fleet of thirty workers is thirty calls a
 * render if nothing governs it - which is how a panel that refreshes on every
 * filesystem event turns into something that rate-limits its operator out of
 * their own forge. So three rules, and this file is all three:
 *
 * 1. **Opt-in.** Nothing here runs unless the operator asked for it; see
 *    `readForge` in `src/config/`.
 * 2. **Off the critical path.** `refresh` schedules and returns. A render is
 *    never waiting on a network call, so the first paint costs exactly what it
 *    cost before this existed. What has already been read is applied from the
 *    cache; what has not stays `not-looked-up`, which is a true statement about
 *    that pull request at that moment rather than a placeholder.
 * 3. **At most once a minute, per pull request, failures included.** The floor
 *    is stamped when a read is scheduled rather than when it finishes, so
 *    several renders in the same instant schedule one read between them, and a
 *    forge that is refusing is asked again in a minute rather than on every
 *    render.
 *
 * The three together are what make this safe to wire into a loop that publishes
 * on every change: a completed read publishes one change signal, that signal
 * causes one re-render, and the floor is what stops the re-render scheduling
 * another read.
 *
 * See `docs/decisions/2026-08-31-reading-the-forge.md`.
 */

/** No pull request is asked about more than this often. */
export const FORGE_MIN_INTERVAL_MS = 60_000;

/**
 * How long one call to the forge gets, and why it is not the fleet's budget.
 *
 * `QUARTERDECK_READ_TIMEOUT_MS` is sized against a cost that grows with the
 * fleet - roughly a second per live worker, plus upstream's own per-worker
 * bound - and it is twenty seconds because of that curve. A `gh` call has no
 * such curve: it is one request, and one that has not answered in five seconds
 * is not going to be worth waiting three times longer for. Letting it follow
 * the fleet's number would mean every future rise in that budget silently
 * bought a hung network call more time to hold up the rest of its batch, which
 * is a cost nobody chose. See
 * `docs/decisions/2026-09-01-the-fleet-read-budget-and-what-a-timeout-means.md`.
 */
export const FORGE_READ_TIMEOUT_MS = 5_000;

interface ForgeCacheDeps {
  readonly read: ForgeRead;
  readonly clock: Clock;
  readonly logger: Logger;
  /** A single read that outlives this is abandoned. The runtime's own bound. */
  readonly readTimeoutMs: number;
}

export class ForgeCache {
  readonly #deps: ForgeCacheDeps;
  /** What the forge last said, per pull request address. */
  readonly #readings = new Map<string, ForgeReading>();
  /** When a read was last *scheduled*, per address. The floor is measured here. */
  readonly #scheduledAtMs = new Map<string, number>();
  /**
   * Reads run one after another rather than all at once.
   *
   * Nothing is waiting on them, so the only thing concurrency would buy is a
   * burst of simultaneous calls to the same forge - which is the shape that
   * gets an operator rate-limited, and the shape this file exists to prevent.
   */
  #queue: Promise<void> = Promise.resolve();

  constructor(deps: ForgeCacheDeps) {
    this.#deps = deps;
  }

  /**
   * The snapshot with every pull request filled in from what has been read.
   *
   * Only where upstream left the field out. A fleet that has grown its own
   * forge reading is a better source than this one - it is closer to the work
   * and it costs the panel nothing - so a published block is never overwritten
   * by a cached one.
   */
  applyTo(snapshot: FleetSnapshot): FleetSnapshot {
    if (this.#readings.size === 0) return snapshot;
    return {
      ...snapshot,
      tasks: snapshot.tasks.map((task) => this.#fill(task)),
    };
  }

  #fill(task: SnapshotTask): SnapshotTask {
    const { url, checks, review } = task.pr;
    if (url === null || (checks !== null && review !== null)) return task;
    const reading = this.#readings.get(url);
    if (reading === undefined) return task;
    return {
      ...task,
      pr: {
        url,
        checks: checks ?? reading.checks,
        review: review ?? reading.review,
      },
    };
  }

  /**
   * Schedule a read for every pull request that is due one. Returns at once.
   *
   * `onRead` fires once per batch, after the last of them, and is how the panel
   * learns there is something new to draw. Once per batch rather than once per
   * pull request: thirty signals for one refresh would be thirty re-renders.
   */
  refresh(snapshot: FleetSnapshot, onRead: () => void): void {
    const { clock, logger, read, readTimeoutMs } = this.#deps;
    const nowMs = clock.nowMs();
    const due = this.#due(snapshot, nowMs);
    if (due.length === 0) return;

    for (const url of due) this.#scheduledAtMs.set(url, nowMs);
    this.#queue = this.#queue
      .then(async () => {
        for (const url of due) {
          this.#readings.set(
            url,
            await read(url, AbortSignal.timeout(readTimeoutMs)),
          );
        }
      })
      .then(onRead)
      // A rejected queue would swallow every read after it, so this catches
      // rather than trusting the reader's promise never to break its contract.
      .catch((error: unknown) => {
        logger.warn("the forge read did not complete", {
          detail: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /**
   * The addresses worth asking about: a pull request the document still has an
   * unfilled half for, whose floor has expired.
   *
   * Deduplicated, because two workers on one pull request is one call.
   */
  #due(snapshot: FleetSnapshot, nowMs: number): readonly string[] {
    const due = new Set<string>();
    for (const task of snapshot.tasks) {
      const { url, checks, review } = task.pr;
      if (url === null || (checks !== null && review !== null)) continue;
      const scheduledAt = this.#scheduledAtMs.get(url);
      if (
        scheduledAt !== undefined &&
        nowMs - scheduledAt < FORGE_MIN_INTERVAL_MS
      )
        continue;
      due.add(url);
    }
    return [...due];
  }
}
