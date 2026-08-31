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
 * A merge order is the same shape of thing and rests on the same argument. It
 * is the argument list for `bin/fm-pr-merge.sh`, which owns every rule about
 * when a pull request may land and re-reads the forge live before it acts. This
 * file merges nothing, and could not: a panel that merged directly would be a
 * second authority beside that command, and every refusal that command enforces
 * would be void for the one channel that skipped it.
 *
 * See `docs/decisions/2026-08-30-answering-a-held-decision.md` and
 * `docs/decisions/2026-08-31-ordering-a-merge.md`.
 */

/**
 * What an operator can ask the fleet to do.
 *
 * Two kinds. The second arrived the way the first was shaped for: a member on
 * this union and a row in one table, with no field of an answer redefined and
 * no second file that writes. That matters more than it sounds - the safety
 * argument for this panel is that there is exactly one file that writes, and a
 * second intent kind arriving as a second file would end that argument quietly.
 */
type IntentKind = "answer-decision" | "merge-pull-request";

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
const MAX_ANSWER_BYTES = 4096;

/**
 * What every intent carries, whatever it is asking for.
 *
 * Only the identity, deliberately. A merge order has no answer, no label and no
 * close mode; an answer has no pull request. Hoisting anything past `requestId`
 * into here would make one kind's fields optional on the other, which is how a
 * record ends up written with a field its intake never reads.
 */
interface IntentBase {
  readonly kind: IntentKind;
  /**
   * Minted by the caller, unique per intended action.
   *
   * A retry, a double click, and a reconnecting client all resend the same
   * request. Carrying the identity on the request rather than inferring it from
   * timing is what makes acting twice impossible rather than unlikely.
   */
  readonly requestId: string;
}

/** An answer to a decision the fleet is holding for a person. */
interface AnswerDecisionIntent extends IntentBase {
  readonly kind: "answer-decision";
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

/**
 * An order to merge a pull request the fleet opened.
 *
 * Two fields, and they are exactly the two arguments the fleet's guarded merge
 * command takes. That is deliberate: this record is not a description of a
 * merge, it is the argument list for the one command that owns every rule about
 * whether a merge may happen. Nothing about the checks, the review, the branch
 * or the operator's confidence travels with it, because none of that is
 * something the command would be entitled to trust from here.
 */
interface MergeIntent extends IntentBase {
  readonly kind: "merge-pull-request";
  /** The work item whose pull request this is. Upstream's id, verbatim. */
  readonly taskId: string;
  /**
   * The full address of the pull request. Never a bare number.
   *
   * A number would have to be resolved against a repository this panel would
   * have to guess at, and guessing which repository to merge in is the single
   * worst mistake available on this page. The address the document carries is
   * the whole of what is passed on.
   */
  readonly url: string;
}

/**
 * Everything an operator can ask for.
 *
 * `kind` is the discriminant and every member carries it, so a kind added here
 * makes every `switch` over it a compile error until it is handled - which is
 * the point. A single interface with optional fields would let a new kind be
 * added and silently written with the old kind's format.
 */
type Intent = AnswerDecisionIntent | MergeIntent;

/**
 * How one kind of intent becomes a file: its extension, and the bytes inside.
 *
 * One entry per kind, and the whole of what a second kind has to supply. The
 * extension is part of the format rather than a constant beside it because the
 * fleet's sources watch for the shapes they can read - a merge order landing
 * with `.keyed-answer-v1` on it would be handed to the answer intake, which
 * would find a line it cannot parse.
 */
interface RecordFormat<T extends Intent> {
  readonly suffix: string;
  /** The bytes, or why they cannot be written. Format only. */
  readonly line: (intent: T) => Refusal & { readonly line?: string };
  /**
   * What this record is called when the writer speaks to the operator, with and
   * without its article.
   *
   * Both spelled out rather than derived, because a rule that puts "an" in
   * front of a word beginning with a vowel is wrong often enough that it would
   * eventually put it in front of a kind added later. The writer below composes
   * every line it says out of these, so a kind cannot arrive and be reported as
   * the other one's noun.
   */
  readonly noun: string;
  readonly aNoun: string;
}

interface IntentResult {
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
 * new question, and answering it must not collide with the old record. It is
 * the empty string for a record that carries no start date - a stable name for
 * "no point in its hold was recorded", which is what makes the same answer to
 * such a record collide rather than pile up a record per read.
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
  for (const field of [
    parts.taskId,
    parts.since,
    parts.answer,
    parts.label,
    parts.mode,
  ]) {
    digest.update(`${Buffer.byteLength(field)}:${field}`);
  }
  return digest.digest("hex").slice(0, 32);
}

/**
 * The identity of a merge order, as a name a filesystem can hold.
 *
 * The task and the address, and deliberately nothing else. Everything else a
 * merge order could be digested against moves: the checks' `asOf` moves every
 * minute the forge is read, and a head commit is not something this document
 * carries at all. Any of them in the digest would mint a fresh identity for the
 * same order and quietly cost it the replay protection that is the whole reason
 * the identity is derived rather than minted.
 *
 * The cost is stated rather than hidden: a second press after the fleet has
 * already taken this order is a duplicate, and the panel says so instead of
 * ordering the merge again. Re-ordering after a refusal is the fleet's to
 * offer, not this panel's to force by minting a new name - see
 * `docs/decisions/2026-08-31-ordering-a-merge.md`.
 */
export function mergeRequestIdFor(parts: {
  readonly taskId: string;
  readonly url: string;
}): string {
  const digest = createHash("sha256");
  for (const field of [parts.taskId, parts.url]) {
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

/**
 * The file extension a merge order carries, and the shape it promises.
 *
 * `<task-id>\t<pr-url>`, newline-terminated: exactly the two arguments the
 * fleet's guarded merge command takes, in that order. A distinct extension
 * rather than a field inside the answer format, because the fleet's sources
 * watch for the shapes they can read - an order arriving as a keyed answer
 * would be handed to the answer intake, which would read the address as an
 * answer to a decision nobody asked.
 */
export const MERGE_RECORD_SUFFIX = ".merge-order-v1";

/**
 * The format each kind of intent is written in.
 *
 * The one table a second kind of intent extends. Nothing below reads a kind's
 * format any other way, so the writer itself does not know what an answer is -
 * it looks the format up, checks it, and links the bytes into place.
 */
const FORMATS: {
  readonly [K in IntentKind]: RecordFormat<Extract<Intent, { kind: K }>>;
} = {
  "answer-decision": {
    suffix: RECORD_SUFFIX,
    line: (intent) => keyedAnswerLine(intent),
    noun: "answer",
    aNoun: "an answer",
  },
  "merge-pull-request": {
    suffix: MERGE_RECORD_SUFFIX,
    line: (intent) => mergeOrderLine(intent),
    noun: "merge order",
    aNoun: "a merge order",
  },
};

/** Everything a record is refused for. Format only; never "is this still open". */
type Refusal =
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
function keyedAnswerLine(
  intent: AnswerDecisionIntent,
): Refusal & { readonly line?: string } {
  const fields: readonly [string, string][] = [
    ["task id", intent.taskId],
    ["answer", intent.answer],
    ["label", intent.label],
  ];
  for (const [name, value] of fields) {
    if (/[\t\n\r]/.test(value)) {
      return {
        ok: false,
        detail: `The ${name} may not contain a tab or a line break.`,
      };
    }
  }
  if (intent.taskId.trim() === "")
    return { ok: false, detail: "The task id is empty." };
  if (intent.answer.trim() === "")
    return { ok: false, detail: "The answer is empty." };
  if (!CLOSE_MODES.includes(intent.mode)) {
    return {
      ok: false,
      detail: `"${intent.mode}" is not a close mode the fleet accepts.`,
    };
  }
  if (Buffer.byteLength(intent.answer) > MAX_ANSWER_BYTES) {
    return {
      ok: false,
      detail: `The answer is longer than the ${MAX_ANSWER_BYTES} bytes the fleet will record.`,
    };
  }
  return {
    ok: true,
    line: `${intent.taskId}\t${intent.answer}\t${intent.label}\t${intent.mode}\n`,
  };
}

/**
 * The one line a merge order holds, or why it cannot be written.
 *
 * Format only, and a deliberately short list, because almost nothing about a
 * merge is this file's to judge. Whether the checks are green, whether the
 * pull request is still open, whether the branch has moved, whether a review is
 * outstanding - every one of those belongs to the fleet's guarded merge
 * command, which re-reads them live at merge time. Restating any of them here
 * would make this panel a second authority on when a merge is allowed, and a
 * second authority is one that can disagree.
 *
 * What is checked is that the line will parse and that the address is an
 * address. A bare number, a relative path or anything that is not an absolute
 * http(s) URL is refused rather than passed on: the command resolves the owner
 * and repository out of the address it is given, so an address that is not one
 * is a merge aimed at a repository nobody named.
 */
export function mergeOrderLine(
  intent: MergeIntent,
): Refusal & { readonly line?: string } {
  for (const [name, value] of [
    ["task id", intent.taskId],
    ["pull request address", intent.url],
  ] as const) {
    if (/[\t\n\r]/.test(value)) {
      return {
        ok: false,
        detail: `The ${name} may not contain a tab or a line break.`,
      };
    }
    if (value.trim() === "")
      return { ok: false, detail: `The ${name} is empty.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(intent.url);
  } catch {
    return {
      ok: false,
      detail:
        "The pull request address is not a full address, and this panel will not guess one.",
    };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      detail: `"${parsed.protocol}" is not a scheme a pull request is addressed by.`,
    };
  }
  return { ok: true, line: `${intent.taskId}\t${intent.url}\n` };
}

interface SpoolOptions {
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
  const format = FORMATS[intent.kind] as RecordFormat<Intent>;

  if (options.intentDir === null) {
    return refused(
      intent.requestId,
      `Nothing is configured for this panel to record ${format.aNoun} in.`,
    );
  }

  // Checked here rather than in each format, so that a kind added to the table
  // above cannot be the one that forgets it. The identity becomes a filename,
  // and a filename is the one field where a stray character is a path.
  if (!/^[A-Za-z0-9._-]+$/.test(intent.requestId)) {
    return refused(
      intent.requestId,
      "The request identity is not a name this panel will write.",
    );
  }

  const check = format.line(intent);
  if (!check.ok) return refused(intent.requestId, check.detail);
  const line = check.line as string;

  const dir = options.intentDir;
  const final = `${dir}/${intent.requestId}${format.suffix}`;
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
        detail: `This ${format.noun} was already recorded; nothing was written again.`,
      };
    } finally {
      await rm(staged, { force: true });
    }
  } catch (error) {
    return refused(
      intent.requestId,
      `The ${format.noun} could not be recorded: ${(error as Error).message}`,
    );
  }

  return {
    requestId: intent.requestId,
    accepted: true,
    duplicate: false,
    detail: `The ${format.noun} was recorded.`,
  };
}
