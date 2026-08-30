import { derivePort } from "./port.ts";
import { isIsoInstant } from "../providers/clock.ts";

/**
 * Everything the panel needs to know before it reads anything: which fixture
 * set, which port, and the policy numbers the refresh loop runs on.
 *
 * Environment is a system boundary, so it is parsed here and nowhere else. A
 * value that fails to parse fails the start rather than silently reverting to a
 * default, because a typo in `QUARTERDECK_FIXTURE_SET` that quietly renders the
 * healthy fleet is worse than a panel that refuses to start.
 */
export interface Config {
  /** Directory under `fixtures/` to read the snapshot from. */
  readonly fixtureSet: string;
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
    fixtureSet,
    fixtureRoot: env.QUARTERDECK_FIXTURE_ROOT || `${rootDir}/fixtures`,
    host: HOST,
    port,
    staleAfterMs: intFromEnv(env, "QUARTERDECK_STALE_AFTER_MS", 60_000),
    debounceMs: intFromEnv(env, "QUARTERDECK_DEBOUNCE_MS", 120),
    readTimeoutMs: intFromEnv(env, "QUARTERDECK_READ_TIMEOUT_MS", 5_000),
    now: instantFromEnv(env, "QUARTERDECK_NOW"),
  };
}
