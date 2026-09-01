import type { LensStatus } from "@/types/document.ts";

/**
 * What a read did, as the verb a sentence about it needs.
 *
 * Every band writes its own line about an absent reading - the disclosure bar
 * accounts for what it cannot account for, the fleet lens dates its last good
 * picture, the deck says the count above may be short - and each of them has to
 * name what happened in its own grammar. What none of them may do is disagree
 * with the frame above them: a header reading `Timed out` over a body reading
 * "the read failed" tells an operator both that their fleet is fine and that it
 * is broken, and the second is the one they will act on.
 *
 * So the verb is derived here rather than written seven times. See
 * `UnreadableReason` for why the two are a different fact about the fleet, and
 * `docs/decisions/2026-09-01-the-fleet-read-budget-and-what-a-timeout-means.md`
 * for what it cost to call the second one the first.
 */
export function readVerb(status: LensStatus): string {
  return status.state === "unreadable" && status.reason === "timed-out"
    ? "timed out"
    : "failed";
}
