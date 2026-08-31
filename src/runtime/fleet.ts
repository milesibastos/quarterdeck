import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import {
  ContractIdentifierError,
  fixtureSource,
  fleetSource,
  fleetWatchDirs,
  readSnapshot,
  type SnapshotSource,
} from "../adapters/contract.ts";
import { ghForge } from "../adapters/forge.ts";
import { readFleetHomeHealth, readHealth } from "../adapters/health.ts";
import {
  fixtureTerminalSource,
  fleetTerminalSource,
  type TerminalSource,
} from "../adapters/terminal.ts";
import type { Config, FleetRef } from "../config/index.ts";
import { projectDocument, withSnapshotUnreadable } from "../domain/project.ts";
import { fixedClock, systemClock, type Clock } from "../providers/clock.ts";
import { consoleLogger, type Logger } from "../providers/logger.ts";
import { childProcessRunner } from "../providers/process.ts";
import type { PanelDocument } from "../types/document.ts";
import { ForgeCache } from "./forge.ts";

/** The document's lens-shaped fields, in the order they read best in a sentence. */
const LENS_NAMES = ["fleet", "deck", "landed", "health"] as const;

/** Which lenses a document is showing as unreadable, named rather than counted. */
function unreadableLenses(document: PanelDocument): readonly string[] {
  return LENS_NAMES.filter((name) => document[name].status.state === "unreadable");
}

/** "the fleet lens" / "the fleet and deck lenses" / "the fleet, deck and landed lenses". */
function describeLenses(names: readonly string[]): string {
  const noun = names.length === 1 ? "lens" : "lenses";
  const list =
    names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `the ${list} ${noun}`;
}

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
  /**
   * Directories whose changes invalidate the cache. More than one because a
   * fleet keeps what the fleet lens draws and what the deck lens draws apart,
   * and they move independently.
   */
  readonly watchDirs: readonly string[];
  /**
   * Where the health signals are read from. Passed through to the quarantined
   * module, which is the only file allowed to know what is inside it.
   *
   * A real fleet's home wins: it is a fleet's own files, and the fixture health
   * file is the stand-in for when there is no fleet to read.
   */
  readonly healthDir: string;
  /**
   * Set when this runtime is reading a real fleet home, which is read for
   * health a different way from a fixture set's health file.
   *
   * Per runtime rather than per config, because the panel now holds one runtime
   * per fleet and an operator can have a real fleet and a fixture set in the
   * same list.
   */
  readonly fleetHome: string | null;
  /**
   * Where a pull request's checks and review comments come from, or `null` when
   * the operator has not asked the panel to read the forge.
   *
   * Off the read path by construction: `#read` applies what this has already
   * got and then schedules, so nothing here can ever be between an operator and
   * their first paint. See `src/runtime/forge.ts`.
   */
  readonly forge: ForgeCache | null;
}

export class FleetRuntime {
  readonly #deps: RuntimeDeps;
  /** The last document that parsed. Never discarded because a later read failed. */
  #lastKnownGood: PanelDocument | null = null;
  /** Set when the watcher fires; cleared once a read has answered for it. */
  #stale = true;
  /** At most one read is ever in flight; concurrent callers share it. */
  #inFlight: Promise<PanelDocument> | null = null;
  #listeners = new Set<() => void>();
  #watchers: FSWatcher[] = [];
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
  async document(): Promise<PanelDocument> {
    if (!this.#stale && this.#lastKnownGood) return this.#lastKnownGood;
    this.#inFlight ??= this.#read().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  /**
   * A reading taken now, never the cache. For the acting path only.
   *
   * Everything that renders wants the cache: the panel re-renders on every
   * filesystem event, and a lens is allowed - required, even - to draw the last
   * picture that read cleanly. Acting is the one place where that is not good
   * enough. An operator presses a button against a page that may be seconds or
   * minutes old, and the question at that moment is not "what did the panel
   * last see" but "is this still true", so the acting route asks again rather
   * than believing the render.
   *
   * A read already in flight is waited out first: it may have started before
   * the change this call exists to notice, and returning it would be the cache
   * problem wearing a different coat. Nothing is published - a re-read is not a
   * change, and telling every open page to re-render because somebody pressed a
   * button would be this panel inventing traffic.
   */
  async reread(): Promise<PanelDocument> {
    if (this.#inFlight) await this.#inFlight.catch(() => undefined);
    this.#stale = true;
    return this.document();
  }

  async #read(): Promise<PanelDocument> {
    const { config, source, clock, logger, healthDir, fleetHome, forge } = this.#deps;
    const options = { clock, staleAfterMs: config.staleAfterMs };

    // Read first and unconditionally: health never throws, and it is the one
    // lens that stays useful when the snapshot does not parse.
    const deadline = AbortSignal.timeout(config.readTimeoutMs);
    const health = fleetHome
      ? await readFleetHomeHealth(fleetHome, clock, deadline)
      : await readHealth(healthDir, deadline);

    try {
      const snapshot = await readSnapshot(
        source,
        AbortSignal.timeout(config.readTimeoutMs),
      );
      // Whatever the forge has already said, folded in before the projection so
      // that the document - and with it the omissions list - is built once from
      // one snapshot. A pull request nothing has read yet keeps upstream's
      // absent block and reads as `not-looked-up`, which is what it is.
      const document = projectDocument(forge?.applyTo(snapshot) ?? snapshot, health, options);
      this.#lastKnownGood = document;
      this.#stale = false;
      // Last, and deliberately: this schedules network calls and returns, so
      // the document above is already built and about to be handed back. A read
      // that finds something new publishes a change, and the panel re-renders
      // the way it does for any other change.
      forge?.refresh(snapshot, () => this.publishChange());
      return document;
    } catch (error) {
      // A schema the panel does not understand is never survivable: rendering
      // an older document beside a fleet that has moved on is exactly the
      // "plausible and wrong" outcome the pinned identifier exists to prevent.
      if (error instanceof ContractIdentifierError) throw error;

      const detail = error instanceof Error ? error.message : String(error);
      const document = withSnapshotUnreadable(this.#lastKnownGood, detail, health, options);
      logger.warn(`fleet read failed; showing ${describeLenses(unreadableLenses(document))} as unreadable`, {
        detail,
      });
      // Deliberately leaves `#stale` set, so the next render tries again.
      return document;
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
    if (this.#watchers.length > 0) return;
    const { watchDirs, config, logger } = this.#deps;
    for (const watchDir of watchDirs) {
      try {
        this.#watchers.push(
          watch(watchDir, { persistent: false }, () => {
            // Coalesce: an editor saving a file emits several events, a burst
            // of them is still one change as far as the panel is concerned,
            // and one debounce shared across the watchers means a change
            // touching two of these directories is still one read.
            if (this.#debounce) clearTimeout(this.#debounce);
            this.#debounce = setTimeout(() => {
              this.#debounce = null;
              this.publishChange();
            }, config.debounceMs);
          }),
        );
        logger.info("watching for fleet changes", { watchDir });
      } catch (error) {
        // A missing directory must not take the panel down, and must not stop
        // the others being watched; reads report what is actually wrong.
        logger.warn("could not watch for fleet changes", {
          watchDir,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  stop(): void {
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = null;
    for (const watcher of this.#watchers) watcher.close();
    this.#watchers = [];
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
 * One runtime per fleet, one set of them per process.
 *
 * Per fleet, because an operator switching between fleets must never be handed
 * the other one's cached document - and a single runtime with a swappable
 * source would do exactly that for as long as its cache stayed warm. Each fleet
 * gets its own cache, its own last-known-good and its own watchers, so nothing
 * one fleet read can be attributed to another.
 *
 * Per process, because route modules can be evaluated more than once in the
 * same process, which would otherwise leave two watchers on the same directory
 * publishing every change twice. Hanging the map off `globalThis` is the only
 * place a module-scope value survives that.
 */
const RUNTIMES = Symbol.for("quarterdeck.fleetRuntimes");

type Host = typeof globalThis & { [RUNTIMES]?: Map<string, FleetRuntime> };

/**
 * The runtime reading one fleet, started on first use.
 *
 * Lazily, so a panel configured with several fleets does not watch every one of
 * them before anybody has looked at it.
 */
export function fleetRuntime(config: Config, fleet: FleetRef): FleetRuntime {
  const host = globalThis as Host;
  const runtimes = (host[RUNTIMES] ??= new Map<string, FleetRuntime>());

  const existing = runtimes.get(fleet.id);
  if (existing) return existing;

  const runtime = new FleetRuntime(depsFor(config, fleet));
  runtime.start();
  runtimes.set(fleet.id, runtime);
  return runtime;
}

/**
 * Where one fleet's worker terminals are read from.
 *
 * A factory rather than a part of `FleetRuntime`, deliberately. The runtime is
 * the refresh loop: it watches, coalesces, caches and holds a last-known-good,
 * and none of that applies here. A terminal is read once, when somebody opens a
 * card, and is never read again until they open another - so it has no cache to
 * invalidate and nothing to watch. Hanging it off the runtime would suggest
 * otherwise, and would put an on-demand read inside the thing the first paint
 * waits on.
 *
 * It lives here rather than in the route because this is where the two source
 * kinds are already told apart, and one file deciding "home or fixture" is what
 * keeps a fixture fleet behaving exactly as a real one does.
 */
export function terminalSourceFor(config: Config, fleet: FleetRef): TerminalSource {
  return fleet.source.kind === "home"
    ? fleetTerminalSource(fleet.source.home, childProcessRunner, process.env)
    : fixtureTerminalSource(config.fixtureRoot, fleet.source.set);
}

/**
 * The forge reader, when the operator has asked for one.
 *
 * Per runtime rather than shared, so a fleet's cached readings are that fleet's
 * - the same argument that gives each fleet its own last-known-good. The
 * environment is passed through the way the snapshot command's is: `gh` needs a
 * `PATH` to be found and its own credentials to answer.
 */
function forgeFor(config: Config, clock: Clock): ForgeCache | null {
  if (!config.readForge) return null;
  return new ForgeCache({
    read: ghForge(childProcessRunner, clock, process.env),
    clock,
    logger: consoleLogger,
    readTimeoutMs: config.readTimeoutMs,
  });
}

/** How one fleet's source, watchers and health reading are wired. */
function depsFor(config: Config, fleet: FleetRef): RuntimeDeps {
  const clock = clockFor(config);
  const common = { config, clock, logger: consoleLogger, forge: forgeFor(config, clock) };

  if (fleet.source.kind === "home") {
    const { home } = fleet.source;
    return {
      ...common,
      source: fleetSource(home, childProcessRunner, process.env),
      watchDirs: fleetWatchDirs(home),
      // Health is read by the quarantined module from wherever its signals are
      // kept - inside the fleet home for a real fleet, and beside the fixture
      // set when the panel is running on one.
      healthDir: home,
      fleetHome: home,
    };
  }

  const fixtureDir = join(config.fixtureRoot, fleet.source.set);
  return {
    ...common,
    source: fixtureSource(config.fixtureRoot, fleet.source.set),
    watchDirs: [fixtureDir],
    healthDir: fixtureDir,
    fleetHome: null,
  };
}
