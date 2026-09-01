import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { portsFor } from "./lib/ports.ts";
import {
  copyFixtures,
  REPO_ROOT,
  startPanel,
  until,
  type Panel,
} from "./lib/server.ts";

/**
 * The refresh loop, over the wire.
 *
 * What a test can prove here is that a change to the source produces exactly
 * one signal carrying no data, and that the next render reflects the change.
 * That the browser then reconciles in place - keeping scroll and expanded
 * cards - is React's contract, demonstrated in a browser rather than asserted
 * here; see docs/plans/done/.
 */

const nextPort = portsFor(import.meta.filename);

/** Reads SSE frames until `wanted` arrives, or the deadline passes. */
async function nextEvent(
  url: string,
  wanted: string,
  timeoutMs = 10_000,
): Promise<{ event: string; data: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/events`, {
      signal: controller.signal,
    });
    assert.equal(
      response.headers.get("content-type"),
      "text/event-stream; charset=utf-8",
    );

    let buffer = "";
    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("the channel closed before the signal arrived");
      buffer += value;
      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const event = /^event:\s*(.*)$/m.exec(frame)?.[1] ?? "";
        if (event !== wanted) continue;
        return { event, data: /^data:\s*(.*)$/m.exec(frame)?.[1] ?? "" };
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

describe("the refresh loop", () => {
  let panel: Panel;
  let snapshot: string;

  before(async () => {
    const fixtureRoot = await copyFixtures();
    panel = await startPanel({
      port: nextPort(),
      fixtureSet: "healthy",
      fixtureRoot,
    });
    snapshot = join(fixtureRoot, "healthy", "snapshot.json");
  });
  after(() => panel.stop());

  async function addWorker(id: string) {
    const document = JSON.parse(await readFile(snapshot, "utf8"));
    document.tasks.push({
      id,
      project: "northreach",
      kind: "ship",
      paths: {
        meta: { path: `/anchorage/briefs/${id}.md`, present: true },
        worktree: { path: `/anchorage/worktrees/${id}`, present: true },
      },
      current_state: {
        state: "working",
        detail: "editing the projection",
        observed_at: "2099-01-01T09:15:00.000Z",
      },
      pr: { url: null, source: "absent" },
    });
    await writeFile(snapshot, JSON.stringify(document, null, 2));
  }

  test("a change to the source publishes a signal carrying no data", async () => {
    const signal = nextEvent(panel.url, "fleet-changed");
    // Give the stream a moment to subscribe before changing anything.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await addWorker("wi-northreach-501");

    const { event, data } = await signal;
    assert.equal(event, "fleet-changed");
    assert.equal(
      data,
      "",
      "the signal carries no data; the page re-renders to get it",
    );
  });

  test("the next render reflects the change", async () => {
    // The worker added above is drawn by the fleet lens on the next render.
    const html = await until(
      async () => (await fetch(panel.url)).text(),
      (text) => text.includes('data-worker="wi-northreach-501"'),
    );
    assert.ok(html.includes('data-lens="fleet"'));
  });

  test("the channel survives the client hanging up", async () => {
    // A disconnected reader must not take the runtime's subscriber list with it.
    await nextEvent(panel.url, "never-sent", 300).catch(() => {});
    const signal = nextEvent(panel.url, "fleet-changed");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await addWorker("wi-northreach-502");
    assert.equal((await signal).event, "fleet-changed");
  });
});

/**
 * A fleet home whose snapshot command takes its time.
 *
 * The whole subject below is what happens *during* a refresh, so the refresh
 * has to be long enough to be interrupted on purpose rather than by luck. The
 * command sleeps and then prints the fixture snapshot beside it, which is the
 * same shape `tests/real-fleet.test.ts` uses, plus the pause.
 */
async function slowFleetHome(seconds: number): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "quarterdeck-slow-fleet-"));
  await mkdir(join(home, "bin"), { recursive: true });
  await mkdir(join(home, "state"), { recursive: true });
  await mkdir(join(home, "data"), { recursive: true });
  await copyFile(
    join(REPO_ROOT, "fixtures", "upstream-shape", "snapshot.json"),
    join(home, "snapshot.json"),
  );
  const command = join(home, "bin", "fm-fleet-snapshot.sh");
  await writeFile(
    command,
    [
      "#!/bin/sh",
      `sleep ${seconds}`,
      'exec cat "$FM_HOME/snapshot.json"',
      "",
    ].join("\n"),
  );
  await chmod(command, 0o755);
  return home;
}

/** One request on a socket of our own, so the test can decide when it dies. */
function rawRequest(
  url: string,
  path: string,
  destroyAfterMs: number | null,
): Promise<string> {
  const { hostname, port } = new URL(url);
  return new Promise((done) => {
    const socket = connect(Number(port), hostname, () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: ${hostname}:${port}`,
          // What a browser sends for `router.refresh()`: the flight payload
          // for the page it is already on, refetched. The state tree is
          // required - without it Next answers the request as a navigation.
          "RSC: 1",
          `Next-Router-State-Tree: ${REFETCH_TREE}`,
          "Accept: */*",
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
      if (destroyAfterMs !== null)
        setTimeout(() => socket.destroy(), destroyAfterMs);
    });
    let text = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (text += chunk));
    socket.on("close", () => done(text));
    socket.on("error", () => done(text));
  });
}

/** The router state a page sends when it is asking for itself again. */
const REFETCH_TREE =
  "%5B%22%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C4096%5D%7D%2Cnull%2C%22refetch%22%2C4112%5D";

/**
 * Asks for the refresh the way a page does, and leaves before it arrives.
 *
 * Next answers an RSC request whose `_rsc` hash it did not mint with a 307 to
 * the one it did, so the redirect is followed rather than guessed: the hash is
 * a property of the route and the build, and a test that hard-coded one would
 * pass until the next build changed it.
 */
async function leaveDuringRefresh(panel: Panel): Promise<void> {
  const redirect = await rawRequest(panel.url, "/?_rsc=asking", null);
  const location = /^location: (.+)$/im.exec(redirect)?.[1]?.trim();
  assert.ok(location, `expected a canonical RSC path, got:\n${redirect}`);
  await rawRequest(panel.url, location, 500);
}

describe("a page that leaves while its refresh is still rendering", () => {
  let home: string;
  let panel: Panel;

  before(async () => {
    home = await slowFleetHome(4);
    panel = await startPanel({
      port: nextPort(),
      env: {
        QUARTERDECK_FLEET_HOME: home,
        // Longer than the command sleeps, so the read this test interrupts is
        // a read that would otherwise have succeeded.
        QUARTERDECK_READ_TIMEOUT_MS: "30000",
      },
    });
  });

  after(async () => {
    await panel.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("is reported as what it is, not as an error", async () => {
    // The fleet moves, so the refresh below is a real read rather than the
    // cache answering at once. Waited for rather than assumed: the signal is
    // what says the runtime has noticed, and a request sent before it would be
    // answered from the cache and never reach a render to interrupt.
    const signal = nextEvent(panel.url, "fleet-changed");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await writeFile(join(home, "state", "wi-moved.status"), "busy\n");
    await signal;

    await leaveDuringRefresh(panel);

    // React's Flight serializer notices the response went away mid-render and
    // says `The destination stream closed early.`; Next prints that as a red
    // `⨯ Error` with a digest, on a panel where nothing has gone wrong. The
    // panel claims that one message and says what it means instead. See
    // `docs/decisions/2026-09-01-the-error-that-is-a-page-leaving.md`.
    await until(
      async () => panel.stdout(),
      (out) =>
        out.includes(
          "a page stopped listening while the panel was still rendering its refresh",
        ),
      15_000,
    );
    assert.ok(
      !panel.stderr().includes("The destination stream closed early"),
      `the panel printed React's sentence as an error:\n${panel.stderr()}`,
    );
  });
});
