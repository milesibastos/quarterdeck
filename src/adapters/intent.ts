import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";

/**
 * quarterdeck:permitted-writer
 *
 * THE ONLY FILE IN THIS REPOSITORY PERMITTED TO WRITE ANYTHING.
 *
 * That marker line above is not decoration: `npm test` reads it. Every other
 * file is checked for `fs` mutation, and the build fails if one appears.
 * `child_process`, `worker_threads` and `process.chdir` are banned everywhere,
 * this file included - the exemption here grants writing one record and
 * nothing more. The whole safety argument for a panel that will eventually act
 * on a live fleet reduces to reviewing this one file.
 *
 * So read what it does, and what it deliberately does not.
 *
 * IT WRITES ONE FILE AND EXECUTES NOTHING. There is no `child_process` import
 * here and there must never be one. An answer given on the page becomes a
 * record on disk and stops there. The fleet's registered process-event source
 * reads that record on its next check, re-verifies the decision is still open,
 * and feeds the fleet's one keyed-answer intake, which owns every rule about
 * what an answer means. A web request must never be the thing that spawns a
 * fleet command, and in this build it cannot be: nothing in this process can
 * spawn anything.
 *
 * That is also why a stale answer is harmless. The record carries no authority
 * of its own - it is a request that something be considered - and the intake
 * skips a key naming no task, a task not held for a person, and a task already
 * closed. The panel does not filter those out, because the panel's reading is
 * always older than the fleet's.
 *
 * See `docs/decisions/2026-08-30-answering-a-held-decision.md`.
 */

/** What an operator can ask the fleet to do. Only `answer` is planned so far. */
export type IntentKind = "answer-decision";

/**
 * How the fleet should close the call once it has recorded the answer.
 *
 * These are the intake's own two modes and this file invents neither. `done`
 * completes the held task; `release` lifts the hold so held work resumes. The
 * card in the deck presents both and the operator's press declares which -
 * a channel choosing a close mode for itself is exactly what the intake's
 * contract forbids.
 */
export type CloseMode = "done" | "release";

export const CLOSE_MODES: readonly CloseMode[] = ["done", "release"];

/**
 * The most an answer may be.
 *
 * The intake refuses a decision file over 8192 bytes. Staying well under it
 * means an answer this panel accepts is one the intake will still accept after
 * the record has been wrapped in the fleet's own prose.
 */
export const MAX_ANSWER_BYTES = 4096;

export interface Intent {
  readonly kind: IntentKind;
  /**
   * Minted by the caller, unique per intended action.
   *
   * A retry, a double click, and a reconnecting client all resend the same
   * request. Carrying the identity on the request rather than inferring it from
   * timing is what makes acting twice impossible rather than unlikely.
   */
  readonly requestId: string;
  /**
   * The held task the answer is for. This is the intake's key, verbatim: the
   * key IS the task id, so there is no mapping to do and none is done.
   */
  readonly taskId: string;
  /** The operator's answer, verbatim. */
  readonly answer: string;
  /**
   * The words the operator actually pressed, recorded so the fleet's durable
   * decision can say what was on screen rather than only what was typed.
   */
  readonly label: string;
  readonly mode: CloseMode;
}

export interface IntentResult {
  readonly requestId: string;
  readonly accepted: boolean;
  /**
   * This exact request had already been recorded, so nothing was written.
   *
   * Accepted and duplicate are both successes and the operator is told the
   * same true thing either way; they differ only in whether a byte moved.
   */
  readonly duplicate: boolean;
  /** One line naming what happened, for the operator. */
  readonly detail: string;
}

/**
 * The identity of a question-and-answer, as a name a filesystem can hold.
 *
 * Stable by construction: the same task, at the same point in its hold, given
 * the same answer and the same close mode, always names the same record. That
 * is what makes a double click a collision rather than a second answer, and it
 * is derived rather than minted so a client that lost its reply and retried
 * still arrives at the same identity.
 *
 * `since` is in the digest because a task re-held after an earlier answer is a
 * new question, and answering it must not collide with the old record.
 */
export function requestIdFor(parts: {
  readonly taskId: string;
  readonly since: string;
  readonly answer: string;
  readonly label: string;
  readonly mode: CloseMode;
}): string {
  const digest = createHash("sha256");
  // Length-prefixed, so no combination of field contents can be re-cut into a
  // different combination that digests the same.
  for (const field of [parts.taskId, parts.since, parts.answer, parts.label, parts.mode]) {
    digest.update(`${Buffer.byteLength(field)}:${field}`);
  }
  return digest.digest("hex").slice(0, 32);
}

/**
 * The file extension every record carries, and the shape it promises.
 *
 * A record is one intake line and nothing else: `<task-id>\t<answer>\t<label>
 * \t<mode>`, newline-terminated. No header, no provenance block, no timestamp -
 * anything else in the file would reach the intake as a second, bogus key. What
 * the record is about lives in its name; what it says lives in its one line.
 */
export const RECORD_SUFFIX = ".keyed-answer-v1";

/** Everything a record is refused for. Format only; never "is this still open". */
export type Refusal =
  | { readonly ok: true }
  | { readonly ok: false; readonly detail: string };

/**
 * The one line a record holds, or why it cannot be written.
 *
 * A tab or a newline inside a field would cut the line into fields it does not
 * have, so both are refused rather than stripped: silently editing an
 * operator's answer and then recording it as their exact words is the kind of
 * quiet lie this panel exists not to tell.
 *
 * This is format validation and nothing more. It never asks whether the
 * decision is still open - the fleet re-verifies that, and it is the only
 * reader whose answer to that question is current.
 */
export function keyedAnswerLine(intent: Intent): Refusal & { readonly line?: string } {
  const fields: readonly [string, string][] = [
    ["task id", intent.taskId],
    ["answer", intent.answer],
    ["label", intent.label],
  ];
  for (const [name, value] of fields) {
    if (/[\t\n\r]/.test(value)) {
      return { ok: false, detail: `The ${name} may not contain a tab or a line break.` };
    }
  }
  if (intent.taskId.trim() === "") return { ok: false, detail: "The task id is empty." };
  if (intent.answer.trim() === "") return { ok: false, detail: "The answer is empty." };
  if (!CLOSE_MODES.includes(intent.mode)) {
    return { ok: false, detail: `"${intent.mode}" is not a close mode the fleet accepts.` };
  }
  if (Buffer.byteLength(intent.answer) > MAX_ANSWER_BYTES) {
    return {
      ok: false,
      detail: `The answer is longer than the ${MAX_ANSWER_BYTES} bytes the fleet will record.`,
    };
  }
  if (!/^[A-Za-z0-9._-]+$/.test(intent.requestId)) {
    return { ok: false, detail: "The request identity is not a name this panel will write." };
  }
  return {
    ok: true,
    line: `${intent.taskId}\t${intent.answer}\t${intent.label}\t${intent.mode}\n`,
  };
}

export interface SpoolOptions {
  /** The directory the fleet's source watches, or `null` when none is configured. */
  readonly intentDir: string | null;
}

function refused(requestId: string, detail: string): IntentResult {
  return { requestId, accepted: false, duplicate: false, detail };
}

/**
 * Record an answer, or say honestly why it was not recorded.
 *
 * Published by writing the whole line to a private temporary name and then
 * linking it into place. `link` fails with EEXIST when the name is taken, and
 * that failure is the duplicate check: it is atomic, it survives a restart
 * because it is the filesystem's own, and it cannot be defeated by two requests
 * arriving at once. Writing straight to the final name under `wx` would give
 * the same refusal but could leave a half-written line behind a crash, and
 * every honest retry after that would collide with the wreckage.
 */
export async function submitIntent(
  intent: Intent,
  options: SpoolOptions,
): Promise<IntentResult> {
  if (options.intentDir === null) {
    return refused(
      intent.requestId,
      "This panel has nowhere to record an answer; no answer spool is configured.",
    );
  }

  const check = keyedAnswerLine(intent);
  if (!check.ok) return refused(intent.requestId, check.detail);
  const line = check.line as string;

  const dir = options.intentDir;
  const final = `${dir}/${intent.requestId}${RECORD_SUFFIX}`;
  // Distinct per attempt - random, not derived - so two identical requests in
  // flight at once stage to two different names and race only at the link,
  // where the filesystem settles it. Deriving this from the content would give
  // concurrent duplicates one shared staging file, and each would delete the
  // other's out from under it.
  const staged = `${dir}/.${intent.requestId}.${randomUUID()}.staging`;

  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(staged, line, { encoding: "utf8", mode: 0o600 });
    try {
      await link(staged, final);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return {
        requestId: intent.requestId,
        accepted: true,
        duplicate: true,
        // Says what is true and no more. Whether the fleet has acted on the
        // earlier record is not something this panel has read.
        detail: "This answer was already recorded; nothing was written again.",
      };
    } finally {
      await rm(staged, { force: true });
    }
  } catch (error) {
    return refused(
      intent.requestId,
      `The answer could not be recorded: ${(error as Error).message}`,
    );
  }

  return {
    requestId: intent.requestId,
    accepted: true,
    duplicate: false,
    detail: "The answer was recorded.",
  };
}
