import { cookies } from "next/headers";
import { ContractIdentifierError } from "@/adapters/contract.ts";
import { fleetById, loadConfig, type Config, type FleetRef } from "@/config/index.ts";
import {
  mergeRequestIdFor,
  requestIdFor,
  submitIntent,
  CLOSE_MODES,
  type CloseMode,
} from "@/adapters/intent.ts";
import { fleetRuntime } from "@/runtime/fleet.ts";
import { SESSION_HEADER, isValidSession } from "@/runtime/session.ts";
import type { Worker } from "@/types/document.ts";
import { FLEET_COOKIE } from "@/types/selection.ts";
import { isMergeReady } from "@/ui/needs-you/needs-you";

/**
 * The acting guard, and the one thing behind it.
 *
 * Everything under `/api/act` requires the session secret minted at start.
 * Reading requires none of this.
 *
 * What is behind the guard executes nothing. Both intents record a durable
 * record through `src/adapters/intent.ts` - the only file permitted to write -
 * and answer. Neither runs a fleet command, and neither could: no file in this
 * process may import `child_process`, which `npm test` checks. The fleet reads
 * the record on its next check and decides for itself whether to act. That
 * re-verification is what makes a stale click harmless, and it deliberately
 * lives there rather than here: this panel's reading is always older than the
 * fleet's own.
 *
 * `merge-pull-request` adds one thing on top of that, and it is not a second
 * authority: before recording, it re-reads the fleet and refuses an order whose
 * world has moved since the page was drawn. That is not the panel deciding a
 * merge is allowed - the fleet's guarded command still decides that, live, and
 * every refusal it makes is reported as it wrote it. It is the panel declining
 * to pass on an order it can already see is about a different world than the
 * one the operator was looking at. See
 * `docs/decisions/2026-08-31-ordering-a-merge.md`.
 */
export const dynamic = "force-dynamic";

/** Everything the answer route needs from the body, or why it is not usable. */
type ParsedAnswer =
  | {
      readonly ok: true;
      readonly taskId: string;
      readonly since: string;
      readonly answer: string;
      readonly label: string;
      readonly mode: CloseMode;
    }
  | { readonly ok: false; readonly error: string };

function field(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  return typeof value === "string" ? value : null;
}

function parseAnswer(body: unknown): ParsedAnswer {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "The request body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const taskId = field(record, "taskId");
  const since = field(record, "since");
  const answer = field(record, "answer");
  const label = field(record, "label");
  const mode = field(record, "mode");
  for (const [name, value] of [
    ["taskId", taskId],
    ["since", since],
    ["answer", answer],
    ["label", label],
    ["mode", mode],
  ] as const) {
    if (value === null) return { ok: false, error: `"${name}" must be a string.` };
  }
  // The close mode is checked against the fleet's own two and nothing else. A
  // channel may carry what its card declared; it may not invent a third mode.
  if (!CLOSE_MODES.includes(mode as CloseMode)) {
    return {
      ok: false,
      error: `"${mode}" is not a close mode; the fleet accepts ${CLOSE_MODES.join(" or ")}.`,
    };
  }
  return {
    ok: true,
    taskId: taskId as string,
    since: since as string,
    answer: answer as string,
    label: label as string,
    mode: mode as CloseMode,
  };
}

function refuse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/** The body as JSON, or the refusal. Both intents want exactly this. */
async function jsonBody(request: Request): Promise<{ body: unknown } | { error: Response }> {
  try {
    return { body: await request.json() };
  } catch {
    return { error: refuse("The request body is not JSON.", 400) };
  }
}

/**
 * Which fleet an order is about.
 *
 * Resolved the same way the page resolves it, so the destination follows the
 * operator's selection without a fleet field ever travelling in the request.
 * Because the selection lives in a cookie shared across a browser's tabs, an
 * operator who opens a control in one tab and switches fleets in another before
 * submitting would have this resolve against the newer selection - narrower
 * than the configured wrong-fleet bug this guards against, and a property of
 * per-viewer cookie selection generally rather than something a fleet field on
 * the request would fix.
 */
async function selectedFleet(config: Config): Promise<FleetRef> {
  return fleetById(config, (await cookies()).get(FLEET_COOKIE)?.value);
}

async function answerDecision(request: Request): Promise<Response> {
  const read = await jsonBody(request);
  if ("error" in read) return read.error;

  const parsed = parseAnswer(read.body);
  if (!parsed.ok) return refuse(parsed.error, 400);

  /*
   * The request identity is derived here rather than accepted from the client.
   *
   * Two requests carrying the same task, the same point in its hold, the same
   * words and the same close mode ARE the same request - a double click, a
   * retry, a reconnect - and deriving the identity from exactly those makes
   * that true by construction instead of by the client remembering to resend a
   * token. A client cannot mint a fresh identity for the same answer, and
   * cannot claim an existing one for a different answer.
   */
  const requestId = requestIdFor({
    taskId: parsed.taskId,
    since: parsed.since,
    answer: parsed.answer,
    label: parsed.label,
    mode: parsed.mode,
  });

  const config = loadConfig(process.cwd());
  const fleet = await selectedFleet(config);

  const result = await submitIntent(
    {
      kind: "answer-decision",
      requestId,
      taskId: parsed.taskId,
      answer: parsed.answer,
      label: parsed.label,
      mode: parsed.mode,
    },
    { intentDir: fleet.intentDir },
  );

  if (!result.accepted) return refuse(result.detail, 409);
  // `detail` says the answer was recorded and nothing further. Whether the
  // decision is closed is not something this process has read, and the reply
  // must not let a caller believe otherwise.
  return Response.json(
    { requestId: result.requestId, duplicate: result.duplicate, detail: result.detail },
    { status: 200 },
  );
}

/* ------------------------------------------------------ ordering a merge */

/** What the merge route needs from the body, or why the body is not usable. */
type ParsedMerge =
  | { readonly ok: true; readonly taskId: string; readonly url: string }
  | { readonly ok: false; readonly error: string };

function parseMerge(body: unknown): ParsedMerge {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "The request body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const taskId = field(record, "taskId");
  const url = field(record, "url");
  for (const [name, value] of [
    ["taskId", taskId],
    ["url", url],
  ] as const) {
    if (value === null) return { ok: false, error: `"${name}" must be a string.` };
  }
  return { ok: true, taskId: taskId as string, url: url as string };
}

/**
 * What the checks say right now, in a sentence a refusal can end with.
 *
 * Reads the reading rather than summarising it: the three arms are three
 * different facts about the panel's own sight, and an operator told only "the
 * checks are not passing" cannot tell a red run from a run nobody looked at.
 */
function checksNow(worker: Worker): string {
  const checks = worker.pullRequest?.checks;
  if (checks === undefined) return "it no longer carries a pull request";
  if (checks.read === "not-looked-up") return "nothing has read its checks";
  if (checks.read === "unreadable") return `its checks could not be read - ${checks.detail}`;
  return `its checks now read ${checks.finished} of ${checks.total} ${checks.outcome}`;
}

/** The world at the moment of the press, or why the order is not passed on. */
type Recheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * Re-check the world the order was given about, at the moment it is acted on.
 *
 * The page an operator pressed may be seconds or minutes old - the panel
 * re-renders on a change signal, not on a clock - and in that time a pull
 * request can go red, close, land, or be replaced by a newer one on the same
 * work item. Passing an order on from a page that old would be this panel
 * carrying a statement about a world that no longer exists.
 *
 * So the fleet is read again, now, and the order is refused unless the reading
 * is fresh and still says exactly what the card said. A reading that is stale
 * or could not be taken is a refusal too: "I cannot confirm" is a changed world
 * as far as an order to merge is concerned, and the alternative is passing on
 * an order backed by a picture the panel has already stopped trusting.
 *
 * This is not the panel deciding a merge is allowed. Everything that decides
 * that - the merge queue, the conflicts, the reviews, the head commit - is read
 * live by `bin/fm-pr-merge.sh`, which refuses on its own terms and whose
 * refusals are reported as it wrote them. This only declines to carry an order
 * whose premise the panel can already see has expired.
 */
async function recheck(
  config: Config,
  fleet: FleetRef,
  parsed: { readonly taskId: string; readonly url: string },
): Promise<Recheck> {
  let document;
  try {
    document = await fleetRuntime(config, fleet).reread();
  } catch (error) {
    if (error instanceof ContractIdentifierError) {
      return {
        ok: false,
        error: `The fleet's snapshot is in a shape this panel does not understand (${error.source}), so nothing here can confirm the pull request is still ready. Nothing was recorded.`,
      };
    }
    throw error;
  }

  const status = document.fleet.status;
  if (status.state !== "fresh") {
    return {
      ok: false,
      error: `The fleet could not be read freshly just now - ${status.detail} - so this panel cannot confirm the pull request is still ready. Nothing was recorded.`,
    };
  }

  const worker = document.fleet.content.find((candidate) => candidate.id === parsed.taskId);
  if (worker === undefined) {
    return {
      ok: false,
      error: `The fleet no longer carries ${parsed.taskId}, so there is nothing here to merge. Nothing was recorded.`,
    };
  }

  const url = worker.pullRequest?.url ?? null;
  if (url !== parsed.url) {
    return {
      ok: false,
      error:
        url === null
          ? `${parsed.taskId} no longer carries a pull request, so ${parsed.url} is not this panel's to order a merge on. Nothing was recorded.`
          : `${parsed.taskId} now carries ${url}, not ${parsed.url}. The page was ordering a merge on a different pull request. Nothing was recorded.`,
    };
  }

  if (!isMergeReady(worker)) {
    return {
      ok: false,
      error: `${parsed.url} is no longer ready to merge: ${checksNow(worker)}. Nothing was recorded.`,
    };
  }

  return { ok: true };
}

async function mergePullRequest(request: Request): Promise<Response> {
  const read = await jsonBody(request);
  if ("error" in read) return read.error;

  const parsed = parseMerge(read.body);
  if (!parsed.ok) return refuse(parsed.error, 400);

  const config = loadConfig(process.cwd());
  const fleet = await selectedFleet(config);

  const world = await recheck(config, fleet, parsed);
  if (!world.ok) return refuse(world.error, 409);

  /*
   * The request identity is derived here rather than accepted from the client,
   * for the reason the answer route derives its own: two presses naming the
   * same work item and the same pull request ARE the same order, whether they
   * came from a double click, a retry or a second tab, and deriving the name
   * from exactly those makes acting twice impossible rather than unlikely.
   */
  const result = await submitIntent(
    {
      kind: "merge-pull-request",
      requestId: mergeRequestIdFor({ taskId: parsed.taskId, url: parsed.url }),
      taskId: parsed.taskId,
      url: parsed.url,
    },
    { intentDir: fleet.intentDir },
  );

  if (!result.accepted) return refuse(result.detail, 409);
  // `detail` says the order was recorded and nothing further. Whether anything
  // merged is not something this process has read - it will not be until a
  // later reading of the forge shows it - and the reply must not let a caller
  // believe otherwise.
  return Response.json(
    { requestId: result.requestId, duplicate: result.duplicate, detail: result.detail },
    { status: 200 },
  );
}

async function handle(
  request: Request,
  context: { params: Promise<{ intent: string[] }> },
): Promise<Response> {
  if (!isValidSession(request.headers.get(SESSION_HEADER))) {
    return refuse(`Missing or invalid ${SESSION_HEADER}.`, 403);
  }

  const { intent } = await context.params;
  const name = intent.join("/");
  if (request.method === "POST") {
    if (name === "answer-decision") return answerDecision(request);
    if (name === "merge-pull-request") return mergePullRequest(request);
  }
  return refuse(`No such intent: ${name}.`, 404);
}

export const GET = handle;
export const POST = handle;
