/**
 * What the panel says after a merge order is recorded.
 *
 * Its own module, and not because two files need it. It is here so that a test
 * can hold it: the sentences below are drawn by a client component, which means
 * they never appear in the server-rendered HTML and cannot be asserted by
 * reading a page. Five bugs in this project have been the panel asserting
 * something it had not established, and this is the easiest place left to make
 * that mistake - so the copy is pinned by a test rather than left to care. See
 * `tests/merging.test.ts`.
 *
 * The rule the sentences obey: the panel may say the order was recorded, and
 * nothing past that. It has not asked the fleet, it has not read the forge
 * since, and it will not know that anything merged until a later reading shows
 * it. "Merging", "merged" and "landed" are all claims about a world this
 * process has not looked at.
 */

/** Follows the writer's own line, which says the order was recorded. */
export const ORDER_RECORDED = "The fleet will act on it at its next check.";

/** The limit of what the panel knows, said rather than left to be assumed. */
export const ORDER_UNCONFIRMED =
  "This panel cannot say anything merged until a later reading shows it.";

/** Under the button: who performs the verb on it, since it is not this page. */
export const ORDER_EXPLAINER = "Records an order; the fleet merges it, and refuses if it may not.";
