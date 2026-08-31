import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { SESSION_HEADER } from "../src/runtime/session.ts";
import { FLEET_COOKIE } from "../src/types/selection.ts";
import { portsFor } from "./lib/ports.ts";
import { startPanel, type Panel } from "./lib/server.ts";

/**
 * The answer control follows the selected fleet's own spool, driven against
 * the built server.
 *
 * `QUARTERDECK_INTENT_DIR` is declared per fleet, positionally aligned with
 * the configured fleet list - see `src/config/index.ts`. This file exists
 * because a single global spool shared by every configured fleet would let an
 * answer given while looking at one fleet land in the directory another
 * fleet's pickup watches, indistinguishable from an answer meant for it. What
 * is asserted here is that the destination follows the selection, that a
 * fleet with no spool configured refuses to record rather than guessing, and
 * that a single fleet's existing behaviour (`tests/answering.test.ts`) is
 * unchanged.
 */

const nextPort = portsFor(import.meta.filename);

const ANSWERABLE = { id: "wi-tidewater-126", since: "2099-01-01T07:20:05.000Z" };

/**
 * Two fleets reading the same fixture set, so both have the same deck item to
 * answer without needing a second fixture set with its own held work. The id
 * collision suffix (`src/config/index.ts`) is what gives them distinct
 * handles: `healthy` and `healthy-2`.
 */
const FLEET_A = "healthy";
const FLEET_B = "healthy-2";

async function spoolDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "quarterdeck-intents-"));
}

async function spool(dir: string): Promise<[string, string][]> {
  const names = (await readdir(dir)).sort();
  return Promise.all(
    names.map(async (name): Promise<[string, string]> => [
      name,
      await readFile(join(dir, name), "utf8"),
    ]),
  );
}

interface RawResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * A request carrying both a cookie and a body, which neither `fetch` (`Cookie`
 * is a forbidden header) nor `rawRequest` in `tests/lib/server.ts` (no body
 * parameter) can send.
 */
function rawFleetRequest(
  port: number,
  path: string,
  fleet: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: body === undefined ? "GET" : "POST",
        headers: { cookie: `${FLEET_COOKIE}=${fleet}`, ...headers },
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: data }));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function pageAs(port: number, fleet: string): Promise<string> {
  return (await rawFleetRequest(port, "/", fleet)).body;
}

/** `null` when the page carries no secret - a fleet with no spool configured. */
function secretFrom(page: string): string | null {
  const match = /\\?"secret\\?":\\?"([A-Za-z0-9_-]{20,})\\?"/.exec(page);
  return match ? match[1] : null;
}

async function answerAs(
  port: number,
  fleet: string,
  secret: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await rawFleetRequest(
    port,
    "/api/act/answer-decision",
    fleet,
    { "content-type": "application/json", [SESSION_HEADER]: secret },
    JSON.stringify(body),
  );
  return { status: response.status, body: JSON.parse(response.body) as Record<string, unknown> };
}

describe("two fleets, each with their own spool", () => {
  const port = nextPort();
  let panel: Panel;
  let dirA: string;
  let dirB: string;

  before(async () => {
    dirA = await spoolDir();
    dirB = await spoolDir();
    panel = await startPanel({
      port,
      env: {
        QUARTERDECK_FIXTURE_SET: `${FLEET_A}:${FLEET_A}`,
        QUARTERDECK_INTENT_DIR: `${dirA}:${dirB}`,
      },
    });
  });
  after(async () => {
    await panel.stop();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  });

  test("an answer given while fleet A is selected lands only in A's spool", async () => {
    const secret = secretFrom(await pageAs(port, FLEET_A));
    assert.ok(secret, "fleet A has a spool configured, so the control carries a secret");
    const result = await answerAs(port, FLEET_A, secret!, {
      taskId: ANSWERABLE.id,
      since: ANSWERABLE.since,
      answer: "Recorded while looking at fleet A.",
      label: "Answer and close",
      mode: "done",
    });
    assert.equal(result.status, 200);
    assert.equal((await spool(dirA)).length, 1, "the record is in A's spool");
    assert.equal((await spool(dirB)).length, 0, "and nowhere in B's");
  });

  test("an answer given while fleet B is selected lands only in B's spool", async () => {
    const secret = secretFrom(await pageAs(port, FLEET_B));
    assert.ok(secret, "fleet B has its own spool configured too");
    const result = await answerAs(port, FLEET_B, secret!, {
      taskId: ANSWERABLE.id,
      since: ANSWERABLE.since,
      answer: "Recorded while looking at fleet B.",
      label: "Answer and close",
      mode: "done",
    });
    assert.equal(result.status, 200);
    assert.equal((await spool(dirB)).length, 1, "the record is in B's spool");
    assert.equal(
      (await spool(dirA)).length,
      1,
      "unchanged from the earlier test - B's answer added nothing to A's spool",
    );
  });
});

describe("a fleet with no spool configured, alongside one that has", () => {
  const port = nextPort();
  let panel: Panel;
  let dirA: string;

  before(async () => {
    dirA = await spoolDir();
    panel = await startPanel({
      port,
      env: {
        QUARTERDECK_FIXTURE_SET: `${FLEET_A}:${FLEET_A}`,
        // Positional: only the first fleet gets a spool. A trailing separator
        // is not needed - an entry simply absent past the list's end is null,
        // same as an empty slot would be.
        QUARTERDECK_INTENT_DIR: dirA,
      },
    });
  });
  after(async () => {
    await panel.stop();
    await rm(dirA, { recursive: true, force: true });
  });

  test("shows the control closed on the fleet with no spool", async () => {
    const page = await pageAs(port, FLEET_B);
    assert.ok(page.includes(`data-answer-unavailable="${ANSWERABLE.id}"`));
    assert.ok(!page.includes(`data-answer-control="${ANSWERABLE.id}"`));
    assert.equal(secretFrom(page), null, "no secret is handed out for a fleet that cannot act");
  });

  test("refuses an answer posted while that fleet is selected, even with a valid session secret", async () => {
    // The secret is one per process, not per fleet - taken from the fleet that
    // does have a spool, to prove the refusal comes from the selected fleet's
    // own configuration and not from an invalid or missing secret.
    const secret = secretFrom(await pageAs(port, FLEET_A));
    assert.ok(secret);
    const result = await answerAs(port, FLEET_B, secret!, {
      taskId: ANSWERABLE.id,
      since: ANSWERABLE.since,
      answer: "Should not be recorded.",
      label: "Answer and close",
      mode: "done",
    });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /no answer spool is configured/i);
  });

  test("still records normally on the fleet that does have a spool", async () => {
    const secret = secretFrom(await pageAs(port, FLEET_A));
    assert.ok(secret);
    const result = await answerAs(port, FLEET_A, secret!, {
      taskId: ANSWERABLE.id,
      since: ANSWERABLE.since,
      answer: "Recorded normally.",
      label: "Answer and close",
      mode: "done",
    });
    assert.equal(result.status, 200);
    assert.equal((await spool(dirA)).length, 1);
  });
});
