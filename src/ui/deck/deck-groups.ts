import type { DeckItem, Priority, Worker } from "@/types/document.ts";

/**
 * The deck's reading of the document: which pile an item belongs in, and what
 * its blockers actually are.
 *
 * Kept apart from the components so the fold can be read - and argued with - on
 * its own. Nothing here recomputes `actionable`: that is upstream's fold,
 * carried by the document precisely so a second implementation of the rule
 * cannot drift from the first.
 */

/**
 * One work item another one waits on, named as far as the document can name it.
 *
 * A blocker is an identity, and identities live in two places: the deck, for
 * work that has not started, and the fleet, for work that has. Resolving one
 * needs both, which is why the lens is handed the fleet's work items as a
 * directory. It reads nothing else from them.
 */
export interface Blocker {
  readonly id: string;
  /** The blocker's own words for itself, or `null` when only its id is known. */
  readonly label: string | null;
  /** Where it is - a deck state or a lifecycle stage - or `null` when unknown. */
  readonly where: string | null;
  /**
   * Finished, and so no longer blocking anything.
   *
   * `landed` is the one stage that means done. A failed or held blocker is
   * still in the way, and saying otherwise would clear a row that is stuck.
   */
  readonly cleared: boolean;
}

const DECK_STATE_WORDS: Readonly<Record<DeckItem["state"], string>> = {
  queued: "queued",
  "in-flight": "in flight",
};

function resolve(id: string, deck: ReadonlyMap<string, DeckItem>, fleet: ReadonlyMap<string, Worker>): Blocker {
  const queued = deck.get(id);
  if (queued !== undefined) {
    return { id, label: queued.title, where: DECK_STATE_WORDS[queued.state], cleared: false };
  }

  const running = fleet.get(id);
  if (running !== undefined) {
    return {
      id,
      label: null,
      where: `${running.project} · ${running.lifecycle.stage}`,
      cleared: running.lifecycle.stage === "landed",
    };
  }

  // Neither pile names it. The honest answer is the identity upstream gave and
  // no claim about it - an unknown blocker is not a cleared one.
  return { id, label: null, where: null, cleared: false };
}

/** A deck item with its blockers resolved, which is what a row draws. */
export interface DeckRow {
  readonly item: DeckItem;
  /** Blockers still in the way. Empty means nothing is holding it. */
  readonly blocking: readonly Blocker[];
  /** Blockers that have landed since. Shown as history, not as a blockage. */
  readonly cleared: readonly Blocker[];
}

/**
 * The four piles, in the order the lens draws them.
 *
 * A held item can also be blocked, and it goes here rather than under
 * `blocked`: the question "what is waiting on me" is the one that costs days
 * when it is invisible, so being held wins the placement and the row still
 * names the blocker.
 */
export interface DeckGroups {
  readonly held: readonly DeckRow[];
  readonly blocked: readonly DeckRow[];
  readonly queued: readonly DeckRow[];
  readonly inFlight: readonly DeckRow[];
}

/** The order work will be taken in. Within a tier, upstream's order stands. */
const PRIORITY_ORDER: Readonly<Record<Priority, number>> = { now: 0, next: 1, later: 2 };

export function groupDeck(items: readonly DeckItem[], fleet: readonly Worker[]): DeckGroups {
  const deckById = new Map(items.map((item) => [item.id, item]));
  const fleetById = new Map(fleet.map((worker) => [worker.id, worker]));

  const rows = items.map((item): DeckRow => {
    const blockers = (item.blocked?.ids ?? []).map((id) => resolve(id, deckById, fleetById));
    return {
      item,
      blocking: blockers.filter((blocker) => !blocker.cleared),
      cleared: blockers.filter((blocker) => blocker.cleared),
    };
  });

  const byPriority = (pile: readonly DeckRow[]): readonly DeckRow[] =>
    [...pile].sort((a, b) => PRIORITY_ORDER[a.item.priority] - PRIORITY_ORDER[b.item.priority]);

  return {
    // Actionable first: a decision that can be taken now must not be buried
    // under ones deferred to a date.
    held: rows
      .filter((row) => row.item.hold !== null)
      .sort((a, b) => Number(b.item.actionable) - Number(a.item.actionable)),
    blocked: rows.filter((row) => row.item.hold === null && row.blocking.length > 0),
    queued: byPriority(
      rows.filter(
        (row) =>
          row.item.hold === null && row.blocking.length === 0 && row.item.state === "queued",
      ),
    ),
    inFlight: rows.filter(
      (row) =>
        row.item.hold === null && row.blocking.length === 0 && row.item.state === "in-flight",
    ),
  };
}
