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
 * Work that is ready to merge belongs here too, and is the second field below.
 * A pull request nobody presses sits green for days, which is the same silence
 * a held decision is, so it needs the operator exactly as personally.
 */

/**
 * Work whose pull request is ready to land.
 *
 * The whole rule, and deliberately three clauses rather than a judgement: there
 * is a pull request, it is open, and somebody has read its checks and they
 * passed.
 *
 * Nothing about the lifecycle stage, the delivery contract or the review is in
 * here. Those are the fleet's semantics, and the guarded merge command reads
 * every one of them live before it acts - restating any of them here would make
 * the panel a second opinion on when a merge is allowed, which is the failure
 * `docs/decisions/2026-08-30-answering-a-held-decision.md` names for answers and
 * that applies unchanged to this.
 *
 * What IS here is the promise that the panel never offers what cannot be done.
 * `not-looked-up` and `unreadable` checks are not "probably fine": nobody has
 * looked, and a button offered over a reading nobody took is the panel implying
 * a fact it has not established. Failing checks are not merge-ready either, and
 * neither is a pull request already landed.
 */
export function isMergeReady(worker: Worker): boolean {
  const pr = worker.pullRequest;
  return (
    pr !== null &&
    pr.state === "open" &&
    pr.checks.read === "ok" &&
    pr.checks.outcome === "passing"
  );
}

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
   * Work whose pull request is ready to land, in the fleet's own order.
   *
   * Folded here beside the decisions rather than counted in the component, for
   * the reason the whole file exists: one fold, so the band's count and the
   * band's cards cannot come from two different rules.
   */
  readonly merges: readonly Worker[];
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
    merges: fleet.filter(isMergeReady),
    rest: {
      ...groups,
      held: groups.held.filter((row) => !isAnswerable(row.item)),
    },
  };
}
