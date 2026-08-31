import { loadConfig } from "@/config/index.ts";
import {
  requestIdFor,
  submitIntent,
  CLOSE_MODES,
  type CloseMode,
} from "@/adapters/intent.ts";
import { SESSION_HEADER, isValidSession } from "@/runtime/session.ts";

/**
 * The acting guard, and the one thing behind it.
 *
 * Everything under `/api/act` requires the session secret minted at start.
 * Reading requires none of this.
 *
 * What is behind the guard executes nothing. `answer-decision` records a
 * durable intent through `src/adapters/intent.ts` - the only file permitted to
 * write - and answers. It does not run a fleet command, and it could not: no
 * file in this process may import `child_process`, which `npm test` checks. The
 * fleet reads the record on its next check, re-verifies the decision is still
 * open, and decides for itself whether to act. That re-verification is what
 * makes a stale click harmless, and it deliberately lives there rather than
 * here: this panel's reading is always older than the fleet's own.
 */
export const dynamic = "force-dynamic";

/** Everything the route needs from the body, or why the body is not usable. */
type Parsed =
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

function parse(body: unknown): Parsed {
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

async function answerDecision(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse("The request body is not JSON.", 400);
  }

  const parsed = parse(body);
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

  const result = await submitIntent(
    {
      kind: "answer-decision",
      requestId,
      taskId: parsed.taskId,
      answer: parsed.answer,
      label: parsed.label,
      mode: parsed.mode,
    },
    { intentDir: loadConfig(process.cwd()).intentDir },
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

async function handle(
  request: Request,
  context: { params: Promise<{ intent: string[] }> },
): Promise<Response> {
  if (!isValidSession(request.headers.get(SESSION_HEADER))) {
    return refuse(`Missing or invalid ${SESSION_HEADER}.`, 403);
  }

  const { intent } = await context.params;
  const name = intent.join("/");
  if (name === "answer-decision" && request.method === "POST") {
    return answerDecision(request);
  }
  return refuse(`No such intent: ${name}.`, 404);
}

export const GET = handle;
export const POST = handle;
