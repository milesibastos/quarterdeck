import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import { REPO_ROOT, startPanel, until } from "./lib/server.ts";

/**
 * Stopping the panel.
 *
 * An operator stopped a panel that was watching a real fleet, got their prompt
 * back, and then watched an unhandled error print on top of it. Both halves of
 * that were one fault: the change signal is a response that never finishes on
 * its own, Next's shutdown waits for every open connection, and so a panel with
 * one open page never exited. The launcher above it did - instantly - so the
 * shell moved on while the server kept running, kept the port, and kept serving
 * the browser until something tore a render in half.
 *
 * These tests are that report, made repeatable. The first two drive the server
 * the way every other test file does. The third drives `bin/quarterdeck`,
 * because the ordering the operator saw - prompt first, panel second - is the
 * launcher's to get right and nothing else exercises it.
 *
 * See `docs/decisions/2026-09-01-stopping-the-panel.md`.
 */

const nextPort = portsFor(import.meta.filename);

/** How long a stop may take before it counts as not stopping. */
const STOP_BUDGET_MS = 10_000;

/**
 * What an unhandled failure looks like in a panel's output.
 *
 * Not "said nothing at all": a stop is allowed to say it is stopping, and a
 * read that fails while the fleet's own command is being torn down beside it is
 * a warning, not a defect. A stack trace or Next's error mark is neither.
 */
const CRASH = /(^|\n)(⨯|.*\bError:)/;

/**
 * Opens a change-signal stream and holds it, the way a page open in a browser
 * does. Resolves once the server has answered, so the stream is provably on the
 * server's books before anything asks the panel to stop.
 */
async function holdChangeSignal(url: string): Promise<{ release: () => void }> {
  const controller = new AbortController();
  const response = await fetch(`${url}/api/events`, {
    signal: controller.signal,
  });
  assert.equal(
    response.headers.get("content-type"),
    "text/event-stream; charset=utf-8",
  );
  const reader = response.body!.getReader();
  // Read the frame that names the stream open, then leave it open and idle.
  await reader.read();
  void (async () => {
    try {
      for (;;) if ((await reader.read()).done) return;
    } catch {
      // The stop closing this stream is the point of these tests, not a fault.
    }
  })();
  return { release: () => controller.abort() };
}

describe("stopping the panel", () => {
  test("a panel with a page watching it still stops", async () => {
    const panel = await startPanel({ port: nextPort() });
    const stream = await holdChangeSignal(panel.url);

    try {
      // Before the fix this threw: the child sat in Next's graceful close,
      // waiting on the stream above, and was SIGKILLed ten seconds later.
      await panel.stop();
    } finally {
      stream.release();
    }

    assert.doesNotMatch(
      panel.stderr(),
      CRASH,
      "a panel that was asked to stop does not fail on the way out",
    );
  });

  test("a stopped panel lets go of its port", async () => {
    const panel = await startPanel({ port: nextPort() });
    const stream = await holdChangeSignal(panel.url);

    await panel.stop();
    stream.release();

    // The port is the operator-visible half: a panel that has been stopped but
    // is still listening is one that cannot be started again.
    await assert.rejects(
      fetch(panel.url),
      "something still answers on a stopped panel's port",
    );
  });
});

/** Whether a process is still there, without signalling it. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The child processes of a pid, which for the launcher is its one server. */
function childrenOf(pid: number): Promise<number[]> {
  return new Promise((resolve) => {
    const ps = spawn("/usr/bin/pgrep", ["-P", String(pid)]);
    let out = "";
    ps.stdout.setEncoding("utf8");
    ps.stdout.on("data", (chunk: string) => (out += chunk));
    ps.on("close", () =>
      resolve(out.trim().split("\n").filter(Boolean).map(Number)),
    );
    ps.on("error", () => resolve([]));
  });
}

describe("stopping the panel from the shell", () => {
  test("the launcher outlives the panel it started", async () => {
    const port = nextPort();
    const url = `http://127.0.0.1:${port}`;
    let output = "";

    // Detached, so it leads its own process group: a shell signals the job,
    // which is every process in it at once, and that simultaneity is exactly
    // what the launcher has to survive.
    const launcher: ChildProcess = spawn(
      process.execPath,
      [join(REPO_ROOT, "bin", "quarterdeck")],
      {
        cwd: REPO_ROOT,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, QUARTERDECK_PORT: String(port) },
      },
    );
    for (const pipe of [launcher.stdout!, launcher.stderr!]) {
      pipe.setEncoding("utf8");
      pipe.on("data", (chunk: string) => (output += chunk));
    }

    let server: number[] = [];
    try {
      await until(
        async () => output,
        (said) => said.includes(`quarterdeck listening on ${url}`),
        60_000,
      );
      server = await childrenOf(launcher.pid!);
      assert.equal(
        server.length,
        1,
        `the launcher should run exactly one server; it has ${server.length}`,
      );

      const stream = await holdChangeSignal(url);
      process.kill(-launcher.pid!, "SIGTERM");

      // The launcher is the shell's job, so the prompt comes back the moment it
      // goes. What it must never do is go first: the panel's parting words
      // would land on a prompt the operator has already been given, reading as
      // a crash after the job ended - which is exactly what was reported.
      await until(
        async () => alive(launcher.pid!),
        (still) => !still,
        STOP_BUDGET_MS,
      );
      assert.ok(
        !alive(server[0]),
        `the launcher exited while the panel on ${url} was still running, so the ` +
          `shell would take its prompt back with the panel still on its port`,
      );
      stream.release();

      assert.doesNotMatch(
        output,
        CRASH,
        `stopping the panel on ${url} failed. It said: ${output}`,
      );
    } finally {
      for (const pid of [...server, launcher.pid!]) {
        if (alive(pid)) process.kill(pid, "SIGKILL");
      }
    }
  });
});
