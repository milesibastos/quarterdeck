import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { copyFixtures, startPanel, testPort, until, type Panel } from "./lib/server.ts";

/**
 * The refresh loop, over the wire.
 *
 * What a test can prove here is that a change to the source produces exactly
 * one signal carrying no data, and that the next render reflects the change.
 * That the browser then reconciles in place - keeping scroll and expanded
 * cards - is React's contract, demonstrated in a browser rather than asserted
 * here; see docs/plans/done/.
 */

/** Reads SSE frames until `wanted` arrives, or the deadline passes. */
async function nextEvent(
  url: string,
  wanted: string,
  timeoutMs = 10_000,
): Promise<{ event: string; data: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/events`, { signal: controller.signal });
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");

    let buffer = "";
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
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
    panel = await startPanel({ port: testPort(7), fixtureSet: "healthy", fixtureRoot });
    snapshot = join(fixtureRoot, "healthy", "snapshot.json");
  });
  after(() => panel.stop());

  async function addWorker(id: string) {
    const document = JSON.parse(await readFile(snapshot, "utf8"));
    document.workers.push({
      id,
      project: "northreach",
      kind: "review",
      state: "working",
      since: "2099-01-01T09:15:00.000Z",
    });
    await writeFile(snapshot, JSON.stringify(document, null, 2));
  }

  test("a change to the source publishes a signal carrying no data", async () => {
    const signal = nextEvent(panel.url, "fleet-changed");
    // Give the stream a moment to subscribe before changing anything.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await addWorker("wk-northreach-01");

    const { event, data } = await signal;
    assert.equal(event, "fleet-changed");
    assert.equal(data, "", "the signal carries no data; the page re-renders to get it");
  });

  test("the next render reflects the change", async () => {
    const html = await until(
      async () => (await fetch(panel.url)).text(),
      (text) => text.includes("wk-northreach-01"),
    );
    assert.ok(html.includes("northreach"));
  });

  test("the channel survives the client hanging up", async () => {
    // A disconnected reader must not take the runtime's subscriber list with it.
    await nextEvent(panel.url, "never-sent", 300).catch(() => {});
    const signal = nextEvent(panel.url, "fleet-changed");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await addWorker("wk-northreach-02");
    assert.equal((await signal).event, "fleet-changed");
  });
});
