import type { DeckItem, Worker } from "@/types/document.ts";
import { groupDeck, isAnswerable, type DeckGroups, type DeckRow } from "@/ui/deck/deck-groups";

/**
 * What needs the operator personally, split from what the fleet is handling on
 * its own.
 *
 * This is the fold the whole layout is built around, so it lives in one
 * function rather than in the two components that draw its halves. A prior
 * board undercounted open decisions - ten shown against sixteen real - and the
 * shape of that bug is a row that belongs to one list, is drawn by neither, and
 * is missed because the page still looks complete. A single fold that returns
 * both halves is what makes "drawn by neither" impossible to write: there is no
 * second predicate to disagree with the first.
 *
 * Nothing here recomputes `actionable`. That is upstream's own fold, carried by
 * the document precisely so a second implementation of the rule cannot drift
 * from it, and the band reports it rather than deciding it.
 *
 * ## What is in the band, and what is not
 *
 * A decision held for a person is. A row blocked by other work is not - it is
 * waiting on the fleet, not on the reader, and putting it here would dilute the
 * one band whose emptiness has to mean something. A hold that waits on a queue,
 * a date or anything else that is not a person is not, for the same reason:
 * `isAnswerable` is the panel's existing test for that and this reuses it
 * rather than restating it.
 *
 * Work that is ready to merge belongs here too and is not built yet; it is a
 * task of its own. When it lands it becomes a second field beside `decisions`
 * and a second group in the band, and the count below becomes the sum. See
 * `src/ui/needs-you/needs-you-band.tsx` for the place kept for it.
 */
export interface NeedsYou {
  /**
   * Decisions held for a person. The ones the fleet says can be answered right
   * now lead, because a decision that is available today must not be buried
   * under ones deferred to a date.
   */
  readonly decisions: readonly DeckRow[];
  /** How many of `decisions` the fleet says can be answered right now. */
  readonly actionable: number;
  /**
   * The four piles the fleet is handling by itself, with everything in
   * `decisions` removed from the held one.
   *
   * Returned from the same call rather than recomputed downstream: the two
   * halves are defined against each other, and a deck that filtered
   * independently would be one predicate change away from dropping a row.
   */
  readonly rest: DeckGroups;
}

export function needsYou(items: readonly DeckItem[], fleet: readonly Worker[]): NeedsYou {
  const groups = groupDeck(items, fleet);
  const decisions = groups.held.filter((row) => isAnswerable(row.item));

  return {
    decisions,
    actionable: decisions.filter((row) => row.item.actionable).length,
    rest: {
      ...groups,
      held: groups.held.filter((row) => !isAnswerable(row.item)),
    },
  };
}
