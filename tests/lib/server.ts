import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derivePort, PORT_RANGE_START } from "../../src/config/port.ts";

/**
 * Starting the built panel, for tests that drive it over HTTP.
 *
 * The suite exercises `.next/standalone`, not `src/`, so a stale build cannot
 * pass. Fixtures are copied to a temporary directory first: several tests need
 * to change a snapshot mid-run, and none of them may touch the committed ones.
 */

export const REPO_ROOT = join(import.meta.dirname, "..", "..");
const STANDALONE = join(REPO_ROOT, ".next", "standalone");
export const SERVER_ENTRY = join(STANDALONE, "server.js");

/**
 * `next build --output standalone` emits a server that expects the static
 * assets beside it but does not copy them itself.
 */
export async function stageAssets(): Promise<void> {
  await mkdir(join(STANDALONE, ".next"), { recursive: true });
  await cp(join(REPO_ROOT, ".next", "static"), join(STANDALONE, ".next", "static"), {
    recursive: true,
  });
  if (existsSync(join(REPO_ROOT, "public"))) {
    await cp(join(REPO_ROOT, "public"), join(STANDALONE, "public"), { recursive: true });
  }
}

/** A private copy of `fixtures/`, safe to edit. Returns its path. */
export async function copyFixtures(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "quarterdeck-fixtures-"));
  await cp(join(REPO_ROOT, "fixtures"), dir, { recursive: true });
  return dir;
}

/**
 * A port for this test file.
 *
 * Derived from the worktree like the panel's own, then offset per test file so
 * two suites - or a suite and a panel the author left running - never collide.
 */
export function testPort(offset: number): number {
  return ((derivePort(REPO_ROOT) - PORT_RANGE_START + offset + 100) % 900) + PORT_RANGE_START + 50;
}

export interface Panel {
  readonly url: string;
  readonly fixtureRoot: string;
  stop(): Promise<void>;
}

export interface StartOptions {
  readonly port: number;
  readonly fixtureSet?: string;
  /** Pins "now", making staleness deterministic instead of a race with the clock. */
  readonly now?: string;
  readonly staleAfterMs?: number;
  readonly fixtureRoot?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export async function startPanel(options: StartOptions): Promise<Panel> {
  const fixtureRoot = options.fixtureRoot ?? (await copyFixtures());
  const url = `http://127.0.0.1:${options.port}`;

  const child: ChildProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(options.port),
      QUARTERDECK_PORT: String(options.port),
      QUARTERDECK_FIXTURE_ROOT: fixtureRoot,
      QUARTERDECK_FIXTURE_SET: options.fixtureSet ?? "healthy",
      ...(options.now ? { QUARTERDECK_NOW: options.now } : {}),
      ...(options.staleAfterMs
        ? { QUARTERDECK_STALE_AFTER_MS: String(options.staleAfterMs) }
        : {}),
      ...options.env,
    },
  });

  const stop = async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    if (!options.fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  };

  try {
    await waitForReady(url, child);
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, fixtureRoot, stop };
}

async function waitForReady(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`panel exited with ${child.exitCode} before answering`);
    }
    try {
      await fetch(url, { headers: { host: "127.0.0.1" } });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`panel did not answer on ${url} within 20s`);
}

/** Resolves when `predicate` holds, or rejects at the deadline. */
export async function until<T>(
  attempt: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await attempt();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`condition not met within ${timeoutMs}ms; last value: ${String(last)}`);
}

export interface RawResponse {
  readonly status: number;
  readonly headers: NodeJS.Dict<string | string[]>;
  readonly body: string;
}

/**
 * A request with headers `fetch` will not send.
 *
 * `Host` is on the forbidden-header list, so undici silently replaces whatever
 * a test sets with the real one - which would make the host guard look broken
 * when it is working. This goes through `node:http`, which sends what it is told.
 */
export function rawRequest(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, path, method, headers },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}
