import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { TEST_BAND_SIZE, TEST_BAND_START } from "./band.ts";

/**
 * Starting the built panel, for tests that drive it over HTTP.
 *
 * The suite exercises `.next/standalone`, not `src/`, so a stale build cannot
 * pass. Fixtures are copied to a temporary directory first: several tests need
 * to change a snapshot mid-run, and none of them may touch the committed ones.
 *
 * A panel is only ever driven on a port this suite owns. `tests/lib/ports.ts`
 * keeps the suite's own files off each other's ports, and its band keeps them
 * off every checkout's panel, but neither can say anything about a sibling
 * checkout running this same suite: that one derives into the same band and can
 * sit on one of this checkout's ports. Nothing about that looks like a port
 * clash - the foreign server answers, the assertions read as wrong content, and
 * the panel that failed to bind is never mentioned. So `startPanel` asks who is
 * on the port before it starts anything, and refuses; see
 * `docs/decisions/2026-09-01-a-suite-owns-its-ports.md`.
 */

export const REPO_ROOT = join(import.meta.dirname, "..", "..");
const STANDALONE = join(REPO_ROOT, ".next", "standalone");
export const SERVER_ENTRY = join(STANDALONE, "server.js");

const ASSETS_STAGED_MARKER = join(STANDALONE, ".assets-staged");
const STAGING_LOCK = join(STANDALONE, ".staging.lock");

/**
 * `next build --output standalone` emits a server that expects the static
 * assets beside it but does not copy them itself.
 *
 * Every test file that starts a panel calls this, and `node --test` runs test
 * files as separate processes: unguarded, concurrent copies into this one
 * shared directory race on the same destination files (one process's copy
 * unlinks a file another is still writing). `bin/quarterdeck`'s own
 * `stageAssets` takes this same lock before it copies, for the same reason -
 * the suite spawns that launcher too, in `tests/shutdown.test.ts`. The lock
 * serialises the copy: the marker, keyed to the build, then skips it once
 * another process has already staged this exact build, and re-stages if a
 * later build left it behind.
 */
async function stageAssets(): Promise<void> {
  await mkdir(STANDALONE, { recursive: true });
  await withStagingLock(async () => {
    const buildId = await readFile(
      join(REPO_ROOT, ".next", "BUILD_ID"),
      "utf8",
    ).catch(() => null);
    const staged = await readFile(ASSETS_STAGED_MARKER, "utf8").catch(
      () => null,
    );
    if (buildId !== null && staged === buildId) return;

    await mkdir(join(STANDALONE, ".next"), { recursive: true });
    await cp(
      join(REPO_ROOT, ".next", "static"),
      join(STANDALONE, ".next", "static"),
      {
        recursive: true,
      },
    );
    if (existsSync(join(REPO_ROOT, "public"))) {
      await cp(join(REPO_ROOT, "public"), join(STANDALONE, "public"), {
        recursive: true,
      });
    }
    if (buildId !== null) await writeFile(ASSETS_STAGED_MARKER, buildId);
  });
}

/**
 * A cross-process mutex: `mkdir` without `recursive` is atomic, so exactly
 * one caller creates the lock directory and the rest retry until it is gone.
 */
async function withStagingLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      await mkdir(STAGING_LOCK);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for the asset-staging lock at ${STAGING_LOCK}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(STAGING_LOCK, { recursive: true, force: true });
  }
}

/** A private copy of `fixtures/`, safe to edit. Returns its path. */
export async function copyFixtures(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "quarterdeck-fixtures-"));
  await cp(join(REPO_ROOT, "fixtures"), dir, { recursive: true });
  return dir;
}

/**
 * How long the occupancy probe gives a loopback port to answer.
 *
 * Nothing on 127.0.0.1 needs more. A server that cannot manage a syllable in a
 * second is reported as occupied and mute rather than waited on, because the
 * question being asked is whether the port is free, and it plainly is not.
 */
const PROBE_TIMEOUT_MS = 1_000;

/** How much of an occupant's answer a failure quotes. */
const EXCERPT = 160;

/** The band this suite's ports are derived into. */
const BAND_END = TEST_BAND_START + TEST_BAND_SIZE - 1;

/**
 * What already answers on `port`, in one line, or null when nothing does.
 *
 * This connects rather than binding, because the question is who answers and
 * not who could bind. They are different questions: Node's listeners set
 * SO_REUSEADDR, so binding 127.0.0.1 can succeed while a foreign process holds
 * 0.0.0.0 on the same port - a probe that passes while that server goes on
 * answering every request the suite makes. `bin/quarterdeck` binds because it
 * is about to bind; this asks what a test would be talking to.
 *
 * The answer is quoted back because that excerpt is the whole diagnosis. The
 * one thing that settled this defect, after three wrong ones, was curling the
 * port and reading a different checkout's panel come back. Putting that curl
 * inside the failure means nobody has to think of it again.
 */
export function whatAnswersOn(port: number): Promise<string | null> {
  return new Promise((settle) => {
    const socket = connect({ host: "127.0.0.1", port });
    let connected = false;
    let heard = "";
    let done = false;

    const describe = () =>
      heard.trim() === ""
        ? "a server that took the connection and said nothing"
        : heard.replace(/\s+/g, " ").trim().slice(0, EXCERPT);
    const finish = (answer: string | null) => {
      if (done) return;
      done = true;
      socket.destroy();
      settle(answer);
    };
    // Only a refusal before the connection is up means the port is free; every
    // other ending happened because something was there to end it.
    const stopped = () => finish(connected ? describe() : null);

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.on("connect", () => {
      connected = true;
      socket.write("GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
    });
    socket.on("data", (chunk: Buffer) => {
      heard += chunk.toString("utf8");
      if (heard.length >= EXCERPT * 4) finish(describe());
    });
    socket.on("end", () => finish(describe()));
    socket.on("timeout", stopped);
    socket.on("error", stopped);
  });
}

/** How to find whoever holds a port, worth repeating in every such failure. */
const findIt = (port: number) => `  lsof -nP -iTCP:${port} -sTCP:LISTEN`;

/** The refusal: a port this suite does not own is not a port it may test on. */
function occupiedPortError(port: number, occupant: string): Error {
  return new Error(
    `port ${port} is already answering, and this suite did not start what is on it.\n` +
      `It said: ${occupant}\n\n` +
      `This panel would not have bound, and nothing would have said so: every request ` +
      `this file made would have been answered by that server, and the assertions would ` +
      `have failed as wrong content rather than as a port clash.\n\n` +
      `Test ports are derived from this worktree's absolute path, inside ` +
      `${TEST_BAND_START}-${BAND_END}, so a suite running in a sibling checkout can ` +
      `land on one of this checkout's. A panel cannot: those derive into a band of ` +
      `their own. Find it with:\n${findIt(port)}\n` +
      `then stop it, or stop the checkout it belongs to, and run this suite again.`,
  );
}

/** A panel found dead: what it left behind, and what is on its port now. */
interface EarlyDeath {
  readonly port: number;
  readonly url: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  /** What answers on the port now, if anything. */
  readonly occupant: string | null;
}

/**
 * Why a panel died without being asked to, as the message to fail with.
 *
 * The occupancy check before the start leaves one window: a foreign server can
 * take the port between the check and the panel's bind. This is where that
 * window closes. A panel that is dead cannot be what answered, so if anything
 * still answers on its port, everything the file asserted was answered by that
 * - and the two pieces of evidence which say so, the child's own EADDRINUSE and
 * whatever is on the port now, are both read here rather than left for a person
 * to go looking for.
 */
export function explainEarlyDeath(death: EarlyDeath): string {
  const { port, url, exitCode, stderr, occupant } = death;
  const words =
    stderr.trim() === "" ? "" : `\nIts last words:\n${stderr.trim()}`;

  if (stderr.includes("EADDRINUSE")) {
    return (
      `the panel for ${url} never bound: port ${port} was taken between the check and ` +
      `the start. Everything this file asked for was answered by a server this suite ` +
      `did not start, so its assertions read as wrong content, not as a port clash.\n` +
      `The port now says: ${occupant ?? "nothing"}\n${findIt(port)}${words}`
    );
  }
  if (occupant !== null) {
    return (
      `the panel for ${url} exited with ${exitCode} without being stopped, and something ` +
      `is still answering on port ${port} - a server this suite did not start. A dead ` +
      `panel cannot be what answered this file, so its assertions read as wrong content, ` +
      `not as a port clash.\nThe port says: ${occupant}\n${findIt(port)}${words}`
    );
  }
  return (
    `the panel for ${url} exited with ${exitCode} without being stopped. Nothing answers ` +
    `on port ${port} now, so this is the panel's own failure and not a port clash.${words}`
  );
}

/** Each of the child's streams, kept to a tail: enough for an error and its stack. */
const OUTPUT_KEPT = 4_000;

/** Whether a child has exited or been killed by a signal, either way gone. */
function dead(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Drains one of the child's streams, and hands back a reader for what it said. */
function collect(stream: Readable | null): () => string {
  let text = "";
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk: string) => {
    text = (text + chunk).slice(-OUTPUT_KEPT);
  });
  return () => text;
}

export interface Panel {
  readonly url: string;
  readonly fixtureRoot: string;
  stop(): Promise<void>;
  /**
   * Everything the panel has said on standard error.
   *
   * Kept for the failure messages above, and readable here because a stop that
   * leaves an unhandled error behind it is a real fault the suite would
   * otherwise never see: a panel that exits is a panel that passed, however
   * loudly it went. See `tests/shutdown.test.ts`.
   */
  stderr(): string;
  /**
   * Everything the panel has said on standard output.
   *
   * Drained rather than ignored for two reasons. A child whose stdout nobody
   * reads eventually stops on a full pipe, and the panel's own log lines go
   * there - which is where a test reads what the panel said about something it
   * chose not to treat as an error. See `tests/refresh.test.ts`.
   */
  stdout(): string;
}

interface StartOptions {
  readonly port: number;
  readonly fixtureSet?: string;
  /** Pins "now", making staleness deterministic instead of a race with the clock. */
  readonly now?: string;
  readonly staleAfterMs?: number;
  readonly fixtureRoot?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export async function startPanel(options: StartOptions): Promise<Panel> {
  // Before anything is built, copied or spawned: whose port is this?
  const squatter = await whatAnswersOn(options.port);
  if (squatter !== null) throw occupiedPortError(options.port, squatter);

  await stageAssets();
  const fixtureRoot = options.fixtureRoot ?? (await copyFixtures());
  const url = `http://127.0.0.1:${options.port}`;

  const child: ChildProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    // Both are kept rather than discarded: a panel that fails to bind says so
    // on stderr, and that sentence is the difference between a named cause and
    // a day of looking for a defect in the panel - while everything the panel
    // itself logs goes to stdout.
    stdio: ["ignore", "pipe", "pipe"],
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

  const stderr = collect(child.stderr);
  const stdout = collect(child.stdout);

  /**
   * A panel already dead is a finding, not a stop: it did not serve this file,
   * and something else did. Stopping is idempotent so that a second `stop()`
   * cannot mistake the first one's corpse for that finding.
   */
  const stopOnce = async () => {
    const diedUnbidden = dead(child);
    try {
      if (diedUnbidden) {
        throw new Error(
          explainEarlyDeath({
            port: options.port,
            url,
            exitCode: child.exitCode,
            stderr: stderr(),
            occupant: await whatAnswersOn(options.port),
          }),
        );
      }
      await stopChild(child, url);
    } finally {
      if (!options.fixtureRoot)
        await rm(fixtureRoot, { recursive: true, force: true });
    }
  };
  let stopping: Promise<void> | undefined;
  const stop = () => (stopping ??= stopOnce());

  try {
    await waitForReady(url, options.port, child, stderr);
  } catch (error) {
    // The startup failure is the finding; a stop that also times out is
    // downstream of it, and the child is killed either way.
    await stop().catch(() => {});
    throw error;
  }
  return { url, fixtureRoot, stop, stderr, stdout };
}

/**
 * How long a stop may wait for the child.
 *
 * A healthy stop is under three and a half seconds: Next's production shutdown
 * finishes pending requests and then waits for idle keep-alive sockets, which
 * the client lets go of after about three. Ten seconds is threefold headroom
 * over that, and short enough that a child which will not exit fails its test
 * instead of wedging the run - which is what an unbounded wait did, once, for
 * fifty minutes.
 */
const STOP_TIMEOUT_MS = 10_000;

/** How long to wait for the corpse after SIGKILL, which nothing can catch. */
const KILL_TIMEOUT_MS = 2_000;

/**
 * Ends a panel child, or says so.
 *
 * SIGTERM, then a bounded wait, then SIGKILL and a thrown error. The error is
 * the point: a child that ignores SIGTERM is a bug in the panel's stop path,
 * and killing it quietly would hide it for as long as the suite stayed green.
 */
export async function stopChild(
  child: ChildProcess,
  url: string,
  timeoutMs: number = STOP_TIMEOUT_MS,
): Promise<void> {
  if (dead(child)) return;

  child.kill("SIGTERM");
  if (await exits(child, timeoutMs)) return;

  child.kill("SIGKILL");
  await exits(child, KILL_TIMEOUT_MS);
  throw new Error(
    `the panel at ${url} (pid ${child.pid}) did not exit within ${timeoutMs}ms of ` +
      `SIGTERM, and was killed. Its shutdown is hanging: the server did not stop ` +
      `accepting connections, or is waiting on one that never closed.`,
  );
}

/** Whether the child exited before the deadline. Leaves nothing running. */
function exits(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }
    child.once("exit", onExit);
  });
}

/** Whether anything answered `url`, without caring what it said. */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { headers: { host: "127.0.0.1" } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits for the panel to answer - and refuses to call a dead panel ready.
 *
 * The liveness check is made again after the answer, not only before it: a
 * child that lost the port dies while the first request is in flight, and
 * whatever replied in that moment was by definition not it.
 */
async function waitForReady(
  url: string,
  port: number,
  child: ChildProcess,
  stderr: () => string,
): Promise<void> {
  const died = async () =>
    new Error(
      explainEarlyDeath({
        port,
        url,
        exitCode: child.exitCode,
        stderr: stderr(),
        occupant: await whatAnswersOn(port),
      }),
    );

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (dead(child)) throw await died();
    if (await answers(url)) {
      if (dead(child)) throw await died();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
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
  throw new Error(
    `condition not met within ${timeoutMs}ms; last value: ${String(last)}`,
  );
}

interface RawResponse {
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
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}
