import { derivePort } from "./port.ts";
import { isIsoInstant } from "../providers/clock.ts";

/**
 * Everything the panel needs to know before it reads anything: which fleets,
 * which port, and the policy numbers the refresh loop runs on.
 *
 * Environment is a system boundary, so it is parsed here and nowhere else. A
 * value that fails to parse fails the start rather than silently reverting to a
 * default, because a typo in `QUARTERDECK_FIXTURE_SET` that quietly renders the
 * healthy fleet is worse than a panel that refuses to start.
 */

/**
 * Where one fleet's snapshot comes from.
 *
 * The two shapes are the two the reader already has - a fleet home whose
 * snapshot command is run, and a committed synthetic fixture set - and this
 * carries nothing beyond what `src/adapters/contract.ts` needs to build a
 * source from. Which one an operator is looking at is a selection made in the
 * browser; see `src/ui/fleet-picker.tsx`.
 */
export type FleetSource =
  | { readonly kind: "home"; readonly home: string }
  | { readonly kind: "fixture"; readonly set: string };

/**
 * One fleet the panel can be pointed at.
 *
 * `source` is the identity - a home path or a fixture set name, exactly what
 * the reader has always keyed a fleet by. `id` is a handle safe to put in a URL
 * and a cookie, and `label` is what an operator reads. Neither invents a second
 * notion of which fleet this is: both are derived from `source`, and a full
 * home path stays out of the markup because an operator recognises a fleet by
 * its name rather than by its path.
 */
export interface FleetRef {
  /** Stable while the configured list is, which is what lets a cookie name one. */
  readonly id: string;
  readonly label: string;
  readonly source: FleetSource;
  /**
   * Where this fleet's intents - answered decisions and merge orders alike -
   * are spooled, or `null` when it has nowhere to write and so cannot accept
   * either at all.
   *
   * Declared per fleet, not once for the panel: once more than one fleet is
   * selectable in one process, a single global spool would send an intent to
   * whichever fleet's registered process-event source happens to be watching
   * that directory, regardless of which fleet the operator was looking at. The
   * panel still holds no knowledge of the operator's arrangement - it arrives
   * from the environment, positionally aligned with the configured fleet list,
   * rather than being composed from a fleet's own home. See
   * `docs/decisions/2026-08-30-answering-a-held-decision.md` and
   * `docs/decisions/2026-08-31-ordering-a-merge.md`.
   */
  readonly intentDir: string | null;
}

export interface Config {
  /**
   * Every fleet the panel can show, in the order they were configured. Never
   * empty: with nothing set at all it holds the default fixture set, which is
   * what every test run and most development reads.
   *
   * Which fleets exist is configuration, so adding one is a restart rather than
   * a code change; which of them is on screen is the operator's, and is not
   * configuration at all.
   */
  readonly fleets: readonly FleetRef[];
  /** Absolute path of the fixtures root. */
  readonly fixtureRoot: string;
  /** Loopback only. Never an address reachable from the network. */
  readonly host: string;
  readonly port: number;
  /** A snapshot older than this is shown, but marked stale. */
  readonly staleAfterMs: number;
  /** Filesystem events inside this window collapse into one read. */
  readonly debounceMs: number;
  /** A read that outlives this is abandoned; last-known-good is kept. */
  readonly readTimeoutMs: number;
  /**
   * Whether the panel may ask the forge about a pull request's checks and its
   * review comments.
   *
   * Off by default, and the one setting here that governs a network call. It is
   * a choice rather than a default because it is the only thing the panel does
   * that leaves this machine, it needs a working `gh` with credentials, and a
   * panel that quietly started calling a forge on every refresh would be
   * spending an operator's rate limit without having been asked. When it is
   * off, every pull request reads `not-looked-up` - which is the honest
   * statement of exactly what happened. See `src/runtime/forge.ts` for the
   * cost rule that governs it once it is on.
   */
  readonly readForge: boolean;
  /**
   * Pin "now" to a fixed instant, or `null` to use the wall clock.
   *
   * Staleness is a comparison against the current time, so with a real clock
   * the only way to test it is to wait. Pinning the instant makes every
   * fixture render deterministic, which is what lets the test suite assert on
   * the built server's actual output instead of on approximations.
   */
  readonly now: string | null;
}

export const DEFAULT_FIXTURE_SET = "healthy";

const HOST = "127.0.0.1";

/**
 * How several fleets are written into one environment variable.
 *
 * A colon, because that is what an operator already types between paths in
 * `PATH`, and because a fixture set name cannot contain one.
 */
const FLEET_SEPARATOR = ":";

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer, got: ${raw}`);
  }
  return value;
}

/**
 * A setting that is on or off, refused rather than defaulted when it is
 * neither.
 *
 * The same rule every other value in this file gets: a typo that quietly leaves
 * a feature off is worse than a panel that will not start, because the operator
 * who set it has no way to tell the difference from the page.
 */
const ON = new Set(["1", "true", "on", "yes"]);
const OFF = new Set(["0", "false", "off", "no"]);

function flagFromEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return false;
  const value = raw.trim().toLowerCase();
  if (ON.has(value)) return true;
  if (OFF.has(value)) return false;
  throw new TypeError(`${name} must be on or off, got: ${raw}`);
}

function instantFromEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (raw === undefined || raw === "") return null;
  if (!isIsoInstant(raw)) {
    throw new TypeError(`${name} must be an ISO-8601 instant, got: ${raw}`);
  }
  return raw;
}

/** The non-empty entries of a colon-separated setting, in the order written. */
function entriesOf(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(FLEET_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The colon-separated entries of a setting that names one fleet each, kept
 * positional rather than filtered.
 *
 * `QUARTERDECK_INTENT_DIR` lines up against the configured fleet list by
 * index, so an empty slot between two real ones has to stay a slot - dropping
 * it the way `entriesOf` does would shift every entry after it onto the wrong
 * fleet.
 */
function positionalEntriesOf(raw: string | undefined): string[] {
  if (raw === undefined || raw === "") return [];
  return raw.split(FLEET_SEPARATOR).map((entry) => entry.trim());
}

/**
 * The configured fleet homes, each checked to be absolute.
 *
 * A relative home would resolve against whatever directory the panel happened
 * to be started from, which makes "the panel is reading the wrong fleet" a
 * question about a shell's history rather than about a setting.
 */
function fleetHomesFromEnv(env: NodeJS.ProcessEnv): string[] {
  return entriesOf(env.QUARTERDECK_FLEET_HOME).map((home) => {
    if (!home.startsWith("/")) {
      throw new TypeError(
        `QUARTERDECK_FLEET_HOME must be an absolute path, got: ${home}`,
      );
    }
    // A trailing separator would produce a doubled one in every path built from
    // it, which turns up later as a confusing message rather than a broken read.
    return home.replace(/\/+$/, "");
  });
}

function fixtureSetsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const sets = entriesOf(env.QUARTERDECK_FIXTURE_SET);
  for (const set of sets) {
    if (!/^[a-z0-9-]+$/.test(set)) {
      throw new TypeError(
        `QUARTERDECK_FIXTURE_SET must be a lowercase fixture directory name, got: ${set}`,
      );
    }
  }
  return sets.length > 0 ? sets : [DEFAULT_FIXTURE_SET];
}

/** The last segment of a home, which is what an operator calls that fleet. */
function homeLabel(home: string): string {
  return home.slice(home.lastIndexOf("/") + 1) || home;
}

/** A label reduced to something that survives a URL and a cookie unescaped. */
function slug(label: string): string {
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "fleet";
}

/**
 * The fleets, built from whichever setting names them.
 *
 * A configured fleet home wins over the fixture sets, exactly as it did when
 * there was one of each: the fixtures are the stand-in for having no fleet to
 * read, so a panel that has one never falls back to them.
 *
 * Two homes can share a last segment, so an id that collides is suffixed until
 * it is actually unused - not merely bumped by one, since a bumped suffix can
 * itself collide with another entry's own name. Order comes from the
 * environment and does not change between restarts, which is what makes a
 * remembered id still name the same fleet.
 *
 * `QUARTERDECK_INTENT_DIR` lines up with this same order, one slot per fleet:
 * a single value with several fleets configured names only the first one's
 * spool, never all of them, because broadcasting one directory across every
 * fleet is exactly what would let an answer meant for one land in another's.
 */
function fleetsFromEnv(env: NodeJS.ProcessEnv): readonly FleetRef[] {
  const homes = fleetHomesFromEnv(env);
  const sources: FleetSource[] =
    homes.length > 0
      ? homes.map((home) => ({ kind: "home", home }))
      : fixtureSetsFromEnv(env).map((set) => ({ kind: "fixture", set }));
  const intentDirs = positionalEntriesOf(env.QUARTERDECK_INTENT_DIR);

  const taken = new Set<string>();
  return sources.map((source, index) => {
    const label = source.kind === "home" ? homeLabel(source.home) : source.set;
    const base = slug(label);
    let id = base;
    for (let suffix = 2; taken.has(id); suffix++) {
      id = `${base}-${suffix}`;
    }
    taken.add(id);
    return { id, label, source, intentDir: intentDirs[index] || null };
  });
}

/**
 * The fleet an operator's remembered choice names, or the first one.
 *
 * Falling back rather than refusing: a selection is remembered in a browser and
 * the list of fleets is a setting, so a panel restarted with a different list
 * will be asked for a fleet it no longer has. Showing the first one - and
 * saying so, which is the picker's job - beats an error page.
 */
export function fleetById(config: Config, id: string | null | undefined): FleetRef {
  return config.fleets.find((fleet) => fleet.id === id) ?? config.fleets[0];
}

/**
 * `rootDir` is the absolute worktree path. It is passed in rather than read
 * from `process.cwd()` so a test can derive a config for a directory it made up.
 */
export function loadConfig(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const port = intFromEnv(env, "QUARTERDECK_PORT", derivePort(rootDir));
  return {
    fleets: fleetsFromEnv(env),
    fixtureRoot: env.QUARTERDECK_FIXTURE_ROOT || `${rootDir}/fixtures`,
    host: HOST,
    port,
    staleAfterMs: intFromEnv(env, "QUARTERDECK_STALE_AFTER_MS", 60_000),
    debounceMs: intFromEnv(env, "QUARTERDECK_DEBOUNCE_MS", 120),
    readTimeoutMs: intFromEnv(env, "QUARTERDECK_READ_TIMEOUT_MS", 5_000),
    readForge: flagFromEnv(env, "QUARTERDECK_READ_FORGE"),
    now: instantFromEnv(env, "QUARTERDECK_NOW"),
  };
}
