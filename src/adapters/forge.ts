import type {
  SnapshotCheckOutcome,
  SnapshotChecks,
  SnapshotReview,
} from "./contract.ts";
import type { Clock } from "../providers/clock.ts";
import type { Runner } from "../providers/process.ts";

/**
 * Reading a pull request's checks and review comments from the forge.
 *
 * The fourth adapter, and the only one that reaches past this machine. It is
 * here rather than in `contract.ts` because it is a different upstream with a
 * different promise: the snapshot either parses or refuses, while the forge is
 * a network call that may simply not answer, and the document already carries
 * that distinction in `ChecksSignal` and `ReviewSignal`. Confining it to its
 * own file keeps "what does the panel talk to?" answerable by listing this
 * directory.
 *
 * Three rules this file exists to hold:
 *
 * - **It never throws.** Every failure - no `gh`, no credentials, a URL that is
 *   not a pull request, a forge that timed out - becomes an `unreadable`
 *   reading with a line an operator can act on. A read the panel offered to do
 *   must not be able to take a lens down.
 * - **It never invents "nobody asked".** Absence is the caller's word, not
 *   this file's: what comes back from here was always asked for. The
 *   `not-looked-up` reading is what a pull request nobody passed through here
 *   keeps, which is why `src/runtime/forge.ts` fills only what it has actually
 *   read.
 * - **It goes through the one spawn door.** `gh` already knows how to talk to
 *   the forge, how to authenticate, and how to resolve a pull request address;
 *   reimplementing any of that would put an HTTP client and a credential store
 *   in a panel whose whole security argument is that it has neither. The
 *   command is a bare name resolved through the child's `PATH`, so nothing here
 *   names a machine path either.
 *
 * Invariant 7 bans network egress *from the browser*; this runs on the server,
 * off the first paint, and only when the operator has opted in. See
 * `docs/decisions/2026-08-31-reading-the-forge.md`.
 */

/** What one look at a pull request came back with. Both halves, always. */
export interface ForgeReading {
  readonly checks: SnapshotChecks;
  readonly review: SnapshotReview;
}

/** Reads one pull request. Never rejects; a failure is an unreadable reading. */
export type ForgeRead = (
  url: string,
  signal: AbortSignal,
) => Promise<ForgeReading>;

/** The forge client. A bare name, resolved through the child's `PATH`. */
const FORGE_COMMAND = "gh";

/**
 * One question, asked once.
 *
 * Both facts the document wants come out of a single call, because two calls
 * would double the cost of a read that is already the most expensive thing the
 * panel does. `resource(url:)` is why the pull request's own address is enough
 * - nothing here parses a forge URL into an owner, a repository and a number,
 * which is the part that would break on the first address shaped differently.
 *
 * `__typename` on each author is the whole reason this is a query rather than
 * `gh pr view --json comments`: that surface reports an author as a bare login
 * and a continuous-integration bot's comment is then indistinguishable from a
 * person's. The document promises comments "a person left".
 *
 * The page bounds are the forge's own maximum. A pull request past them is
 * accounted for below rather than silently truncated.
 */
const FORGE_QUERY = [
  "query($url: URI!) {",
  "  resource(url: $url) {",
  "    __typename",
  "    ... on PullRequest {",
  "      comments(last: 100) { totalCount nodes { author { __typename } } }",
  "      reviews(last: 100) { totalCount nodes { author { __typename } body } }",
  "      commits(last: 1) { nodes { commit { statusCheckRollup {",
  "        state",
  "        contexts(first: 100) {",
  "          totalCount",
  "          nodes {",
  "            __typename",
  "            ... on CheckRun { status conclusion }",
  "            ... on StatusContext { state }",
  "          }",
  "        }",
  "      } } } }",
  "    }",
  "  }",
  "}",
].join("\n");

/**
 * The forge's rollup verdict, in the document's three words.
 *
 * This is only ever used for the outcome word, never for how many checks have
 * finished: the rollup can reach `FAILURE` the moment one context fails or
 * errors, while the rest are still `PENDING`, so "not pending" does not mean
 * "every check reported". See `checksOf`.
 */
const ROLLUP_OUTCOME: Readonly<Record<string, SnapshotCheckOutcome>> = {
  SUCCESS: "passing",
  FAILURE: "failing",
  ERROR: "failing",
  PENDING: "pending",
  EXPECTED: "pending",
};

/** A check that has reported. The two context shapes say it differently. */
function hasReported(context: Record<string, unknown>): boolean {
  if (context.__typename === "CheckRun") return context.status === "COMPLETED";
  return context.state !== "PENDING" && context.state !== "EXPECTED";
}

/** A comment left by a person. The forge's own word for the other kind is `Bot`. */
function byAPerson(author: unknown): boolean {
  return (author as { __typename?: string } | null)?.__typename !== "Bot";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nodesOf(connection: unknown): Record<string, unknown>[] {
  if (!isRecord(connection) || !Array.isArray(connection.nodes)) return [];
  return connection.nodes.filter(isRecord);
}

function countOf(connection: unknown, fallback: number): number {
  if (!isRecord(connection) || typeof connection.totalCount !== "number")
    return fallback;
  return connection.totalCount;
}

/**
 * What the checks say, from the rollup on the pull request's newest commit.
 *
 * A pull request with no checks at all comes back as `0 of 0` rather than as a
 * failure to read: the forge answered, and "there is nothing to run here" is
 * its answer. The outcome word is `passing` for that case because nothing is
 * outstanding and nothing failed, and the card branches on the count before it
 * ever reads the word - see `Checks` in `src/ui/fleet/worker-card.tsx`.
 *
 * `finished` is counted from the individual checks, never from the rollup
 * verdict: the verdict can reach `FAILURE` while other checks are still
 * running (see `ROLLUP_OUTCOME`), and taking that as "every check reported"
 * would overstate progress rather than understate it, which is the one
 * direction this field must never be wrong in. When the forge reports more
 * checks exist than the page it listed (`contexts(first: 100)`), there is no
 * way to tell how many of the unlisted ones have finished, so the reading is
 * `unreadable` rather than a guessed count.
 */
function checksOf(
  pullRequest: Record<string, unknown>,
  asOf: string,
): SnapshotChecks {
  const commit = nodesOf(pullRequest.commits)[0]?.commit;
  const rollup = isRecord(commit) ? commit.statusCheckRollup : null;
  if (!isRecord(rollup)) {
    return {
      read: "ok",
      outcome: "passing",
      finished: 0,
      total: 0,
      as_of: asOf,
    };
  }

  const contexts = nodesOf(rollup.contexts);
  const total = countOf(rollup.contexts, contexts.length);
  if (total > contexts.length) {
    return {
      read: "unreadable",
      detail: `the forge lists ${total} checks on this pull request but reported on only ${contexts.length}, so how many have finished cannot be established.`,
    };
  }

  const outcome = ROLLUP_OUTCOME[String(rollup.state)] ?? "pending";
  const finished = contexts.filter(hasReported).length;
  return { read: "ok", outcome, finished, total, as_of: asOf };
}

/**
 * How many comments a person left.
 *
 * A review counts only when it carries words. An approval with an empty body is
 * a person having read the pull request, which is a different fact from their
 * having said something about it, and the field the document offers is the
 * second one. A review left with only inline comments carries no body either
 * and is not counted; see `docs/quality.md`.
 */
function reviewOf(
  pullRequest: Record<string, unknown>,
  asOf: string,
): SnapshotReview {
  const comments = nodesOf(pullRequest.comments).filter((c) =>
    byAPerson(c.author),
  ).length;
  const reviews = nodesOf(pullRequest.reviews).filter(
    (review) =>
      byAPerson(review.author) && String(review.body ?? "").trim() !== "",
  ).length;
  return { read: "ok", comments: comments + reviews, as_of: asOf };
}

/** The same one line on both halves: one call answered for both, or neither did. */
function unreadable(detail: string): ForgeReading {
  return {
    checks: { read: "unreadable", detail },
    review: { read: "unreadable", detail },
  };
}

/**
 * A reader that asks the forge through `gh`.
 *
 * The child gets this process's environment, the way the snapshot command does:
 * it needs a `PATH` to be found at all, and whatever `gh` keeps its credentials
 * under. Nothing about the operator's arrangement is assembled here.
 */
export function ghForge(
  runner: Runner,
  clock: Clock,
  env: Readonly<Record<string, string | undefined>>,
): ForgeRead {
  const childEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[name] = value;
  }

  return async (url, signal) => {
    let output: string;
    try {
      output = await runner.run(
        FORGE_COMMAND,
        ["api", "graphql", "-f", `query=${FORGE_QUERY}`, "-f", `url=${url}`],
        { env: childEnv, signal },
      );
    } catch (error) {
      return unreadable(error instanceof Error ? error.message : String(error));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return unreadable(
        `${FORGE_COMMAND} answered with something that is not JSON.`,
      );
    }

    const data = isRecord(parsed) ? parsed.data : null;
    const resource = isRecord(data) ? data.resource : null;
    // A resolved address that is not a pull request, one the credentials in use
    // cannot see, or one that resolved to something else entirely - an issue, a
    // discussion, a commit, all of which share `resource(url:)`'s type and would
    // otherwise come back as a non-null object with none of the fragment's
    // fields on it. All are things the operator can correct, and none is a
    // reason to claim nobody asked.
    if (!isRecord(resource) || resource.__typename !== "PullRequest") {
      return unreadable(
        `The forge did not answer for ${url} with a pull request.`,
      );
    }

    const asOf = clock.now();
    return {
      checks: checksOf(resource, asOf),
      review: reviewOf(resource, asOf),
    };
  };
}
