import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SESSION_HEADER } from "../src/runtime/session.ts";
import { rawRequest, startPanel, testPort, type Panel } from "./lib/server.ts";

/**
 * The security baseline, exercised against the built server.
 *
 * The panel only reads today, so some of the baseline is not yet reachable -
 * but the mechanisms are in place from the first commit, because retrofitting a
 * guard means shipping a build where an acting endpoint exists and the guard
 * does not.
 */
describe("the server's front door", () => {
  let panel: Panel;
  const port = testPort(8);
  before(async () => {
    panel = await startPanel({ port, fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  test("answers loopback requests", async () => {
    assert.equal((await fetch(panel.url)).status, 200);
  });

  test("refuses a request claiming a host that is not loopback", async () => {
    const response = await rawRequest(port, "/", { Host: "evil.example" });
    assert.equal(response.status, 403);
    assert.match(response.body, /not a loopback address/);
  });

  test("accepts the loopback hosts the operator's browser actually sends", async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, "[::1]"]) {
      const response = await rawRequest(port, "/", { Host: host });
      assert.equal(response.status, 200, `${host} should be accepted`);
    }
  });

  test("refuses a request from a non-loopback origin", async () => {
    const response = await fetch(panel.url, {
      headers: { origin: "https://evil.example" },
    });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /not a loopback origin/);
  });

  test("refuses a loopback origin bound to a different port", async () => {
    const response = await fetch(panel.url, {
      headers: { origin: `http://127.0.0.1:${port + 1}` },
    });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /not this panel's own origin/);
  });

  test("accepts this panel's own origin", async () => {
    const response = await fetch(panel.url, {
      headers: { origin: `http://127.0.0.1:${port}` },
    });
    assert.equal(response.status, 200);
  });

  test("sets no cross-origin sharing headers", async () => {
    const response = await fetch(panel.url);
    for (const [name] of response.headers) {
      assert.ok(
        !name.toLowerCase().startsWith("access-control-"),
        `${name} would let another page read this response`,
      );
    }
  });

  test("tells the browser it may not load anything from the network", async () => {
    const policy = (await fetch(panel.url)).headers.get("content-security-policy");
    assert.ok(policy, "every response carries a Content-Security-Policy");

    const remote = policy
      .split(";")
      .map((directive) => directive.trim())
      .filter((directive) => /\bhttps?:|\*|\bdata:(?!\s*$)/.test(directive))
      .filter((directive) => !directive.startsWith("img-src"));
    assert.deepEqual(remote, [], "no directive may name a remote source");
    assert.match(policy, /default-src 'self'/);
    assert.match(policy, /connect-src 'self'/);
    assert.match(policy, /font-src 'self'/);
  });

  test("carries its fonts rather than fetching them", async () => {
    const html = await (await fetch(panel.url)).text();
    assert.ok(!html.includes("fonts.googleapis.com"));
    assert.ok(!html.includes("fonts.gstatic.com"));
    assert.match(html, /\/_next\/static\/media\/[^"]*\.woff2/);
  });
});

describe("the acting guard", () => {
  let panel: Panel;
  before(async () => {
    panel = await startPanel({ port: testPort(9), fixtureSet: "healthy" });
  });
  after(() => panel.stop());

  test("reading needs no session secret", async () => {
    assert.equal((await fetch(panel.url)).status, 200);

    // The signal channel stays open by design, so hang up once it has answered.
    const controller = new AbortController();
    try {
      const stream = await fetch(`${panel.url}/api/events`, { signal: controller.signal });
      assert.equal(stream.status, 200);
    } finally {
      controller.abort();
    }
  });

  test("acting without the session secret is refused", async () => {
    const response = await fetch(`${panel.url}/api/act/answer-decision`, {
      method: "POST",
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, new RegExp(SESSION_HEADER));
  });

  test("acting with the wrong session secret is refused", async () => {
    const response = await fetch(`${panel.url}/api/act/answer-decision`, {
      method: "POST",
      headers: { [SESSION_HEADER]: "not-the-secret" },
    });
    assert.equal(response.status, 403);
  });

  test("the secret is not handed out when there is nothing to act on", async () => {
    // No answer spool is configured for this panel, so no card can offer a
    // control and the page has no reason to carry the credential at all.
    const html = await (await fetch(panel.url)).text();
    assert.ok(!html.includes(SESSION_HEADER));
  });
});
