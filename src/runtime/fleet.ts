import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import {
  ContractIdentifierError,
  fixtureSource,
  readSnapshot,
  type SnapshotSource,
} from "../adapters/contract.ts";
import type { Config } from "../config/index.ts";
import { markReadFailed, projectDocument } from "../domain/project.ts";
import { fixedClock, systemClock, type Clock } from "../providers/clock.ts";
import { consoleLogger, type Logger } from "../providers/logger.ts";
import type { FleetDocument } from "../types/document.ts";

/**
 * The refresh loop.
 *
 * Watch the source, debounce and coalesce what comes back, and publish a signal
 * that carries no data. Subscribers respond by asking the server to re-render,
 * which lands here again as a `document()` call. Keeping the data out of the
 * signal is the whole point: the server re-renders and React reconciles in
 * place, so an expanded card stays expanded and the scroll does not jump.
 */

export interface RuntimeDeps {
  readonly config: Config;
  readonly source: SnapshotSource;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Directory whose changes invalidate the cache. */
  readonly watchDir: string;
}

export class FleetRuntime {
  readonly #deps: RuntimeDeps;
  /** The last document that parsed. Never discarded because a later read failed. */
  #lastKnownGood: FleetDocument | null = null;
  /** Set when the watcher fires; cleared once a read has answered for it. */
  #stale = true;
  /** At most one read is ever in flight; concurrent callers share it. */
  #inFlight: Promise<FleetDocument> | null = null;
  #listeners = new Set<() => void>();
  #watcher: FSWatcher | null = null;
  #debounce: NodeJS.Timeout | null = null;

  constructor(deps: RuntimeDeps) {
    this.#deps = deps;
  }

  /**
   * The current document.
   *
   * Returns the cache when the watcher has seen nothing since the last read.
   * Otherwise reads once, however many callers ask at the same time.
   */
  async document(): Promise<FleetDocument> {
    if (!this.#stale && this.#lastKnownGood) return this.#lastKnownGood;
    this.#inFlight ??= this.#read().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #read(): Promise<FleetDocument> {
    const { config, source, clock, logger } = this.#deps;
    try {
      const snapshot = await readSnapshot(
        source,
        AbortSignal.timeout(config.readTimeoutMs),
      );
      const document = projectDocument(snapshot, {
        clock,
        staleAfterMs: config.staleAfterMs,
      });
      this.#lastKnownGood = document;
      this.#stale = false;
      return document;
    } catch (error) {
      // A schema the panel does not understand is never survivable: rendering
      // an older document beside a fleet that has moved on is exactly the
      // "plausible and wrong" outcome the pinned identifier exists to prevent.
      if (error instanceof ContractIdentifierError) throw error;

      const detail = error instanceof Error ? error.message : String(error);
      if (!this.#lastKnownGood) {
        logger.error("fleet read failed with nothing to fall back to", { detail });
        throw error;
      }
      logger.warn("fleet read failed; showing last known good", { detail });
      // Deliberately leaves `#stale` set, so the next render tries again.
      return markReadFailed(this.#lastKnownGood, detail, clock);
    }
  }

  /** Called on every published signal. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** For tests and for the watcher: mark the cache stale and tell subscribers. */
  publishChange(): void {
    this.#stale = true;
    for (const listener of this.#listeners) listener();
  }

  start(): void {
    if (this.#watcher) return;
    const { watchDir, config, logger } = this.#deps;
    try {
      this.#watcher = watch(watchDir, { persistent: false }, () => {
        // Coalesce: an editor saving a file emits several events, and a burst
        // of them is still one change as far as the panel is concerned.
        if (this.#debounce) clearTimeout(this.#debounce);
        this.#debounce = setTimeout(() => {
          this.#debounce = null;
          this.publishChange();
        }, config.debounceMs);
      });
      logger.info("watching for fleet changes", { watchDir });
    } catch (error) {
      // A missing directory must not take the panel down; reads will report it.
      logger.warn("could not watch for fleet changes", {
        watchDir,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  stop(): void {
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = null;
    this.#watcher?.close();
    this.#watcher = null;
    this.#listeners.clear();
  }
}

/**
 * The clock the whole request runs on.
 *
 * The projection and the rendered ages have to agree, so both take their "now"
 * from here rather than each reaching for the wall clock.
 */
export function clockFor(config: Config): Clock {
  return config.now ? fixedClock(config.now) : systemClock;
}

/**
 * One runtime per process.
 *
 * Route modules can be evaluated more than once in the same process, which
 * would otherwise leave two watchers on the same directory publishing every
 * change twice. Hanging the instance off `globalThis` is the only place a
 * module-scope value survives that.
 */
const SINGLETON = Symbol.for("quarterdeck.fleetRuntime");

type Host = typeof globalThis & { [SINGLETON]?: FleetRuntime };

export function fleetRuntime(config: Config): FleetRuntime {
  const host = globalThis as Host;
  if (!host[SINGLETON]) {
    const watchDir = join(config.fixtureRoot, config.fixtureSet);
    const runtime = new FleetRuntime({
      config,
      source: fixtureSource(config.fixtureRoot, config.fixtureSet),
      clock: clockFor(config),
      logger: consoleLogger,
      watchDir,
    });
    runtime.start();
    host[SINGLETON] = runtime;
  }
  return host[SINGLETON];
}
