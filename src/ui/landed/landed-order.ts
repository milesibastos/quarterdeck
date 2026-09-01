import type { LandedItem } from "@/types/document.ts";

/**
 * The order landed work is read in, and the one number its header states.
 *
 * A pure fold in its own file for the same reason the deck's is: the lens
 * renders what this returns, so a test can pin the order without going through
 * a server, and a later reader changing the order changes it in one place
 * rather than in a `.sort()` buried in JSX.
 */

/**
 * Most recently landed first, and everything undated after everything dated.
 *
 * The date is `YYYY-MM-DD` or nothing - `landedOn` carries no other shape, by
 * the projection's own rule - so string order is date order and no parsing is
 * needed to compare two of them.
 *
 * Undated work goes last rather than first. It is the only defensible place for
 * it: an item whose record named no day has not thereby claimed to be the most
 * recent thing on the page, and putting it at the top would let a record that
 * said nothing outrank one that said yesterday. It is still drawn, and it still
 * says its date is missing rather than borrowing one.
 *
 * Ties keep the order upstream sent, which is what `sort` promises here: two
 * items landing on the same day carry nothing finer to separate them, and
 * inventing a tiebreak - by title, by id - would order them by something that
 * is not about when they landed.
 */
export function inLandingOrder(
  items: readonly LandedItem[],
): readonly LandedItem[] {
  return [...items].sort((a, b) => {
    if (a.landedOn === b.landedOn) return 0;
    if (a.landedOn === null) return 1;
    if (b.landedOn === null) return -1;
    return a.landedOn < b.landedOn ? 1 : -1;
  });
}

/**
 * How many pieces of work, and how many of them a second mate landed.
 *
 * The second number is the one this band exists for. Prior boards lost a
 * mate's work entirely, and a header reading "7 landed" cannot tell an operator
 * whether any of it came from a home other than the one on screen - so the
 * count says it out loud rather than leaving it to be discovered by reading
 * every row.
 */
export function sizeOf(items: readonly LandedItem[]): string | null {
  if (items.length === 0) return null;
  const landed = items.length === 1 ? "1 landed" : `${items.length} landed`;
  const elsewhere = items.filter((item) => item.where === "second-mate").length;
  return elsewhere === 0 ? landed : `${landed} · ${elsewhere} by a mate`;
}
