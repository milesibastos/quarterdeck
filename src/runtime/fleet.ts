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
import {
  readFleetHomeHealth,
  readHealth,
  type HealthReading,
} from "../adapters/health.ts";
import {
  fixtureTerminalSource,
  fleetTerminalSource,
  type TerminalSource,
} from "../adapters/terminal.ts";
import type { Config, FleetRef } from "../config/index.ts";
import {
  projectDocument,
  withSnapshotUnreadable,
  type SnapshotFailure,
} from "../domain/project.ts";
import { fixedClock, systemClock, type Clock } from "../providers/clock.ts";
import { consoleLogger, type Logger } from "../providers/logger.ts";
import { childProcessRunner } from "../providers/process.ts";
import type { PanelDocument } from "../types/document.ts";
import { ForgeCache, FORGE_READ_TIMEOUT_MS } from "./forge.ts";

/** The document's lens-shaped fields, in the order they read best in a sentence. */
const LENS_NAMES = ["fleet", "deck", "landed", "health"] as const;

/** Which lenses a document is showing as unreadable, named rather than counted. */
function unreadableLenses(document: PanelDocument): readonly string[] {
  return LENS_NAMES.filter(
    (name) => document[name].status.state === "unreadable",
  );
}

/** "the fleet lens" / "the fleet and deck lenses" / "the fleet, deck and landed lenses". */
function describeLenses(names: readonly string[]): string {
  const noun = names.length === 1 ? "lens" : "lenses";
  const list =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `the ${list} ${noun}`;
}

/** A read that came back empty-handed, and the quiet it bought. */
interface Setback {
  readonly failure: SnapshotFailure;
  /** How many reads in a row have now failed. Reset by one that parses. */
  readonly attempt: number;
  /** Epoch milliseconds before which no render may start another read. */
  readonly retryAt: number;
}

/**
 * The shortest quiet a failure buys, however cheaply it failed.
 *
 * A command that is simply not there rejects in a millisecond, and without a
 * floor the hold-off it earned would be a millisecond too - which is no
 * hold-off, and leaves the render loop spinning on a missing file.
 */
const MIN_HOLD_OFF_MS = 1_000;

/**
 * How long the next read waits, after one came back empty-handed.
 *
 * Proportional to what the failure cost, because that is the number that
 * matters: a deadline abandons the wait and not the work, so a read that burned
 * twenty seconds has left twenty seconds of fleet work still running that this
 * panel can neither see nor stop. Retrying inside that window is asking a fleet
 * to do a second copy of the job it has not finished the first of. Waiting at
 * least as long as the last attempt took is the smallest rule that keeps the
 * panel from being more than half the load it is complaining about.
 *
 * Then doubled per consecutive failure, so a fleet that is down is asked about
 * less and less often rather than at a fixed drumbeat.
 *
 * The ceiling is the staleness window, and not a number of its own: past it the
 * panel would be calling its own last good picture stale anyway, so holding off
 * for longer buys quiet nobody is left to benefit from - the page is already
 * saying it does not know.
 */
function holdOffMs(
  elapsedMs: number,
  attempt: number,
  staleAfterMs: number,
): number {
  const base = Math.max(elapsedMs, MIN_HOLD_OFF_MS);
  // `attempt` is 1 for the first failure, which is one base with no doubling.
  const stepped = base * 2 ** (attempt - 1);
  return Math.min(stepped, staleAfterMs);
}

/**
 * What the operator is told when the budget ran out.
 *
 * Deliberately not "the read failed". Nothing failed: a fleet snapshot costs
 * about a second per live worker, serially, so a fleet large or busy enough
 * outgrows a budget a smaller one fits inside. That is a fact the operator can
 * do something with, and the two things they can do are named. See
 * `docs/decisions/2026-09-01-the-fleet-read-budget-and-what-a-timeout-means.md`.
 */
function timedOutDetail(readTimeoutMs: number): string {
  // Not rounded to whole seconds: an operator who set 1500 and reads "2s" has
  // been told their own setting back wrong, which is a poor start to a line
  // whose whole job is to tell them the setting is theirs to change.
  const seconds = Number((readTimeoutMs / 1000).toFixed(1));
  return (
    `The fleet did not answer within ${seconds}s. ` +
    `A snapshot costs roughly a second per live worker, so a large or busy ` +
    `fleet can outrun the budget - this is slowness, not a fault. It will be ` +
    `asked again shortly; QUARTERDECK_READ_TIMEOUT_MS raises the budget.`
  );
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

interface RuntimeDeps {
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
  /**
   * What the last read that came back empty-handed knows, and until when the
   * next attempt is held off. Cleared by any read that parses.
   */
  #setback: Setback | null = null;
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
   * Otherwise reads once, however many callers ask at the same time - and,
   * while a read that failed is still being held off, does not read at all.
   */
  async document(): Promise<PanelDocument> {
    if (!this.#stale && this.#lastKnownGood) return this.#lastKnownGood;
    if (this.#holdingOff()) return this.#fromSetback();
    return this.#startRead();
  }

  /** One read, however many callers arrive while it is running. */
  #startRead(): Promise<PanelDocument> {
    this.#inFlight ??= this.#read().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  /**
   * Whether the last failure's quiet period is still running.
   *
   * ## Why a failed read must not be retried by the next render
   *
   * `#inFlight` collapses callers that arrive *together*. It does nothing for
   * callers that arrive one behind the other, and a watched fleet produces
   * exactly those: the watcher fires, every open page re-renders, and each
   * render is a fresh `document()` after the last one has settled. A read that
   * failed leaves `#stale` set on purpose, so before this every one of those
   * renders started another read of a source that had just demonstrated it
   * could not answer.
   *
   * Against a slow fleet that is a storm the panel feeds itself. Measured on a
   * real home: six renders produced seven reads, and because a deadline here
   * abandons the *wait* and not the work - upstream runs its own readers in
   * process groups of their own, which nothing this panel is allowed to signal
   * can reach - four full-cost snapshot commands ended up running at once,
   * every one already thrown away. The panel was making the fleet slower by
   * asking it whether it was slow. See
   * `docs/decisions/2026-09-01-the-fleet-read-budget-and-what-a-timeout-means.md`.
   *
   * So a failure buys quiet, in proportion to what it cost: see `holdOffMs`.
   */
  #holdingOff(): boolean {
    const setback = this.#setback;
    return setback !== null && this.#deps.clock.nowMs() < setback.retryAt;
  }

  /**
   * The document to hand back while a failure is held off, without reading.
   *
   * The health signals are read again each time even so. They come from a
   * different reader with a different cost - files, no command - and they are
   * the one thing still legible when the snapshot is not, so letting the
   * shipshape lens go dark for the length of a backoff would be the panel
   * withholding what it can see. Nothing is restamped: the failure's own
   * instant and detail are carried, because no read has happened since.
   */
  async #fromSetback(): Promise<PanelDocument> {
    const { config, clock, healthDir, fleetHome } = this.#deps;
    const setback = this.#setback!;
    const health = await this.#readHealth(
      AbortSignal.timeout(config.readTimeoutMs),
      { clock, healthDir, fleetHome },
    );
    return withSnapshotUnreadable(
      this.#lastKnownGood,
      setback.failure,
      health,
      {
        clock,
        staleAfterMs: config.staleAfterMs,
      },
    );
  }

  /** Health, from wherever this runtime's signals live. Never throws. */
  #readHealth(
    deadline: AbortSignal,
    {
      clock,
      healthDir,
      fleetHome,
    }: Pick<RuntimeDeps, "clock" | "healthDir" | "fleetHome">,
  ): Promise<HealthReading> {
    return fleetHome
      ? readFleetHomeHealth(fleetHome, clock, deadline)
      : readHealth(healthDir, deadline);
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
   *
   * A backoff is stepped over here, and only here. The hold-off exists to stop
   * renders the operator did not ask for from hammering a source that cannot
   * answer; this call is an operator with their finger on a button, and telling
   * them to come back in half a minute because a render failed earlier would be
   * spending their patience to save the fleet's. One attempt per press is not a
   * storm - and the attempt count is stepped over rather than cleared, so a
   * press that fails again leaves the renders behind it backing off further,
   * not starting over.
   */
  async reread(): Promise<PanelDocument> {
    if (this.#inFlight) await this.#inFlight.catch(() => undefined);
    this.#stale = true;
    return this.#startRead();
  }

  async #read(): Promise<PanelDocument> {
    const { config, source, clock, logger, healthDir, fleetHome, forge } =
      this.#deps;
    const options = { clock, staleAfterMs: config.staleAfterMs };

    // One deadline across both reads, not one each. They run in sequence, so a
    // deadline apiece is a budget of twice the number an operator configured -
    // and the number they configured is the one they will read back off the
    // page when the panel says how long it waited.
    const deadline = AbortSignal.timeout(config.readTimeoutMs);
    const startedAt = clock.nowMs();

    // Read first and unconditionally: health never throws, and it is the one
    // lens that stays useful when the snapshot does not parse.
    const health = await this.#readHealth(deadline, {
      clock,
      healthDir,
      fleetHome,
    });

    try {
      const snapshot = await readSnapshot(source, deadline);
      // Whatever the forge has already said, folded in before the projection so
      // that the document - and with it the omissions list - is built once from
      // one snapshot. A pull request nothing has read yet keeps upstream's
      // absent block and reads as `not-looked-up`, which is what it is.
      const document = projectDocument(
        forge?.applyTo(snapshot) ?? snapshot,
        health,
        options,
      );
      this.#lastKnownGood = document;
      this.#stale = false;
      // One clean read ends the backoff outright rather than stepping it down.
      // The thing being backed off is a source that could not answer, and this
      // one just did.
      this.#setback = null;
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

      // The deadline having fired is a different fact from the fleet answering
      // badly, and only this side of the read can tell them apart: by the time
      // an abort reaches the runner it is an ordinary rejection with an
      // ordinary message. See `UnreadableReason`.
      const timedOut = deadline.aborted;
      const failure = {
        reason: timedOut ? ("timed-out" as const) : ("failed" as const),
        detail: timedOut
          ? timedOutDetail(config.readTimeoutMs)
          : error instanceof Error
            ? error.message
            : String(error),
        observedAt: clock.now(),
      };
      const document = withSnapshotUnreadable(
        this.#lastKnownGood,
        failure,
        health,
        options,
      );

      const elapsedMs = clock.nowMs() - startedAt;
      const attempt = (this.#setback?.attempt ?? 0) + 1;
      const holdOff = holdOffMs(elapsedMs, attempt, config.staleAfterMs);
      // `#stale` stays set, deliberately: the picture is still owed a read.
      // What has changed is that the next one waits for `retryAt` instead of
      // starting on the very next render.
      this.#setback = {
        failure,
        attempt,
        retryAt: clock.nowMs() + holdOff,
      };

      logger.warn(
        `fleet read ${timedOut ? "timed out" : "failed"}; showing ${describeLenses(unreadableLenses(document))} as unreadable`,
        {
          detail: failure.detail,
          elapsedMs,
          attempt,
          retryInMs: holdOff,
        },
      );
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
 * Stop watching, for every fleet this process has looked at.
 *
 * The watchers are not persistent, so they do not by themselves keep the
 * process alive - but a stopping panel that is still publishing changes tells
 * pages to ask a server that is on its way out, and the debounce timer it holds
 * would fire into a closed stream. See `src/runtime/shutdown.ts`.
 */
export function stopFleetRuntimes(): void {
  const runtimes = (globalThis as Host)[RUNTIMES];
  if (!runtimes) return;
  for (const runtime of runtimes.values()) runtime.stop();
  runtimes.clear();
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
export function terminalSourceFor(
  config: Config,
  fleet: FleetRef,
): TerminalSource {
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
    readTimeoutMs: FORGE_READ_TIMEOUT_MS,
  });
}

/** How one fleet's source, watchers and health reading are wired. */
function depsFor(config: Config, fleet: FleetRef): RuntimeDeps {
  const clock = clockFor(config);
  const common = {
    config,
    clock,
    logger: consoleLogger,
    forge: forgeFor(config, clock),
  };

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
