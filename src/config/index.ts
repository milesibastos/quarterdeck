import { derivePort } from "./port.ts";
import { isIsoInstant } from "../providers/clock.ts";

/**
 * Everything the panel needs to know before it reads anything: which fleet,
 * which port, and the policy numbers the refresh loop runs on.
 *
 * Environment is a system boundary, so it is parsed here and nowhere else. A
 * value that fails to parse fails the start rather than silently reverting to a
 * default, because a typo in `QUARTERDECK_FIXTURE_SET` that quietly renders the
 * healthy fleet is worse than a panel that refuses to start.
 */
export interface Config {
  /**
   * The fleet home to read, or `null` to read the fixture set instead.
   *
   * Which source the panel reads is this one value, so pointing it at a real
   * fleet is a restart rather than a code change - and a machine with no fleet
   * on it, which is every test run and most development, needs no setting at
   * all. This is the only place a fleet home enters the panel outside the
   * quarantined health module.
   */
  readonly fleetHome: string | null;
  /** Directory under `fixtures/` to read the snapshot from, when `fleetHome` is null. */
  readonly fixtureSet: string;
  /** Absolute path of the fixtures root. */
  readonly fixtureRoot: string;
  /**
   * Where answered decisions are spooled, or `null` when the panel has nowhere
   * to write and so cannot accept an answer at all.
   *
   * The panel never acts on the fleet: it records an intent here and a
   * registered process-event source picks it up, re-verifies the decision is
   * still open, and feeds the fleet's one keyed-answer intake. Which directory
   * that source watches is the operator's arrangement, not knowledge this
   * panel is allowed to hold - so it arrives from the environment rather than
   * being composed from `fleetHome`, and unset means the write path is closed
   * rather than guessed at. See
   * `docs/decisions/2026-08-30-answering-a-held-decision.md`.
   */
  readonly intentDir: string | null;
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

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer, got: ${raw}`);
  }
  return value;
}

function instantFromEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (raw === undefined || raw === "") return null;
  if (!isIsoInstant(raw)) {
    throw new TypeError(`${name} must be an ISO-8601 instant, got: ${raw}`);
  }
  return raw;
}

/**
 * The fleet home, checked to be absolute.
 *
 * A relative home would resolve against whatever directory the panel happened
 * to be started from, which makes "the panel is reading the wrong fleet" a
 * question about a shell's history rather than about a setting.
 */
function fleetHomeFromEnv(env: NodeJS.ProcessEnv): string | null {
  const raw = env.QUARTERDECK_FLEET_HOME;
  if (raw === undefined || raw === "") return null;
  if (!raw.startsWith("/")) {
    throw new TypeError(
      `QUARTERDECK_FLEET_HOME must be an absolute path, got: ${raw}`,
    );
  }
  // A trailing separator would produce a doubled one in every path built from
  // it, which turns up later as a confusing message rather than a broken read.
  return raw.replace(/\/+$/, "");
}

/**
 * `rootDir` is the absolute worktree path. It is passed in rather than read
 * from `process.cwd()` so a test can derive a config for a directory it made up.
 */
export function loadConfig(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const fixtureSet = env.QUARTERDECK_FIXTURE_SET || DEFAULT_FIXTURE_SET;
  if (!/^[a-z0-9-]+$/.test(fixtureSet)) {
    throw new TypeError(
      `QUARTERDECK_FIXTURE_SET must be a lowercase fixture directory name, got: ${fixtureSet}`,
    );
  }
  const port = intFromEnv(env, "QUARTERDECK_PORT", derivePort(rootDir));
  return {
    fleetHome: fleetHomeFromEnv(env),
    fixtureSet,
    fixtureRoot: env.QUARTERDECK_FIXTURE_ROOT || `${rootDir}/fixtures`,
    intentDir: env.QUARTERDECK_INTENT_DIR || null,
    host: HOST,
    port,
    staleAfterMs: intFromEnv(env, "QUARTERDECK_STALE_AFTER_MS", 60_000),
    debounceMs: intFromEnv(env, "QUARTERDECK_DEBOUNCE_MS", 120),
    readTimeoutMs: intFromEnv(env, "QUARTERDECK_READ_TIMEOUT_MS", 5_000),
    now: instantFromEnv(env, "QUARTERDECK_NOW"),
  };
}
