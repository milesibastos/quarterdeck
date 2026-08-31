import type { DeckItem, Lens, Worker } from "@/types/document.ts";
import type { AnsweringSession } from "@/ui/lib/answering";
import { LensFrame } from "@/ui/lens-frame";
import { ago } from "@/ui/lib/age";
import { DecisionCard } from "@/ui/needs-you/decision-card";
import { MergeCard, type MergeSession } from "@/ui/needs-you/merge-card";
import { needsYou } from "@/ui/needs-you/needs-you";

/**
 * The band that owns the first screen: everything waiting on the operator
 * personally.
 *
 * ## Why it is the biggest thing on the page
 *
 * Not taste. A prior board undercounted open decisions - ten shown against
 * sixteen real - and nobody noticed, because the zone was sized to look
 * balanced rather than to make an omission obvious. A band whose height is
 * decided by its content cannot fail visibly: four cards in a zone sized for
 * four look exactly as complete as sixteen cards in a zone sized for sixteen.
 * So the band's height is a rule and not a measurement - see
 * `src/ui/shell.tsx` - and an under-filled one shows the space it is not
 * using. That empty space is the feature.
 *
 * It is also why the band never bounds what it draws. Sixteen decisions
 * overflowing the first screen is the correct render: the operator scrolls, and
 * the count in the header says how far. A cap would reintroduce exactly the
 * silence this band exists to break.
 *
 * ## Where the count comes from
 *
 * From the deck the document carries, folded once in
 * `src/ui/needs-you/needs-you.ts` - never from prose, and never from counting
 * the cards that happen to have been rendered. A count taken from the render is
 * a count that agrees with the render by construction, which is another way of
 * saying it cannot detect the bug above.
 *
 * And the band never reports a count it did not count: `sizeOf` returns null
 * whenever the count is zero, whatever the deck's status, so a read that never
 * happened can never surface as the number zero - the one number that tells an
 * operator to stop looking. That does not mean the band goes blank the moment a
 * read fails: a deck that could not be read but still carries decisions from
 * the last clean read draws those decisions and their count, under a caveat
 * naming when the read failed and that the count may be short - the same
 * last-known-good rule the deck and fleet lenses already follow. Only a deck
 * that could not be read and carries nothing behind it draws "Unknown, not
 * nothing".
 */

/**
 * How much is waiting on the operator, for the pinned header. A count, never a
 * verdict.
 *
 * Both groups, in one line, from the one fold - so the header can never report
 * a band the operator is not looking at. A group holding nothing contributes no
 * clause rather than the word zero: the band's emptiness is what carries the
 * information here, and "0 to merge" beside two decisions reads as a reassurance
 * nobody counted.
 */
function sizeOf(
  count: number,
  actionable: number,
  merges: number,
): string | null {
  const parts: string[] = [];
  if (count > 0) {
    parts.push(count === 1 ? "1 decision" : `${count} decisions`);
    if (actionable > 0) parts.push(`${actionable} to answer`);
  }
  if (merges > 0) parts.push(`${merges} to merge`);
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * Nothing is waiting - and which kind of nothing it is.
 *
 * A deck that read cleanly and holds no decision, and a deck nobody could read,
 * look identical unless the band says which it is. The whole point of the band
 * is that its emptiness carries information, so an emptiness that might be
 * ignorance has to be labelled as ignorance.
 */
function NothingNeedsYou({
  status,
  deckSize,
  nowMs,
}: {
  status: Lens<unknown>["status"];
  /** How many rows the deck carried, so the zero can be shown to be derived. */
  deckSize: number;
  nowMs: number;
}) {
  if (status.state === "unreadable") {
    return (
      <div
        data-needs-you-empty="unknown"
        className="border-l-2 border-term-danger py-6 pl-3 font-mono text-[13px] leading-[1.55]"
      >
        <p className="font-display text-xl tracking-wide text-term-fg-bright">
          Unknown, not nothing
        </p>
        <p className="mt-2 max-w-prose wrap-anywhere text-term-muted">
          {`The deck could not be read ${ago(status.observedAt, nowMs)}, so how much is waiting on you is not zero - it is unknown. Nothing on this page counted it.`}
        </p>
      </div>
    );
  }

  return (
    <div
      data-needs-you-empty="none"
      className="border-l-2 border-term-rule py-6 pl-3 font-mono text-[13px] leading-[1.55]"
    >
      <p className="font-display text-xl tracking-wide text-term-fg-bright">
        Nothing needs you
      </p>
      {/* Says where the zero came from, and claims nothing about how fresh
          the deck was while doing it - the trust word in the header above is
          the only thing on this page entitled to make that claim. */}
      <p className="mt-2 max-w-prose text-term-muted">
        {deckSize === 0
          ? "The deck carried nothing at all, so nothing in it is held for a person."
          : `The deck carried ${deckSize} ${deckSize === 1 ? "item" : "items"} and none of them is held for a person.`}
      </p>
      {/* Said separately because it is a different read: the decisions come
          from the deck and the merges from the fleet, and one sentence covering
          both would attribute a fleet's silence to the deck. */}
      <p className="mt-1 max-w-prose text-term-muted">
        No pull request in the fleet is ready to merge.
      </p>
    </div>
  );
}

export function NeedsYouBand({
  lens,
  fleet,
  nowMs,
  session = null,
  merging = null,
  className,
}: {
  /** The deck, with its own status: the band's count is only as good as this. */
  lens: Lens<readonly DeckItem[]>;
  /**
   * The fleet's work items. Read to name and settle the deck's blockers, and
   * for the pull requests that are ready to land.
   */
  fleet: readonly Worker[];
  /** Chosen by the composition point, so every age on the page agrees. */
  nowMs: number;
  /** How an answer reaches the server. `null` when it has nowhere to go. */
  session?: AnsweringSession | null;
  /** How a merge order reaches the server. `null` when it has nowhere to go. */
  merging?: MergeSession | null;
  /** The share of the first screen the shell reserves for it. */
  className?: string;
}) {
  const { decisions, actionable, merges } = needsYou(lens.content, fleet);

  return (
    <LensFrame
      lens={lens}
      name="needs-you"
      title="Needs you"
      prominence="primary"
      summary={sizeOf(decisions.length, actionable, merges.length)}
      className={className}
    >
      {/* How old the picture is, which the frame's one line deliberately does
          not say - it names the policy that was breached instead. A count off a
          stale deck is still a count, and it is still worth showing; what it is
          not is current, and that has to be on screen beside it. */}
      {lens.status.state === "stale" && (
        <p className="font-mono text-[12px] text-term-faint">
          {`Counted from a deck current as of ${ago(lens.status.asOf, nowMs)}; anything raised since is not here.`}
        </p>
      )}
      {lens.status.state === "unreadable" && decisions.length > 0 && (
        <p
          data-needs-you-caveat="unreadable"
          className="border-l-2 border-term-danger py-1 pl-3 font-mono text-[13px] leading-[1.55] wrap-anywhere text-term-fg"
        >
          {`The read failed ${ago(lens.status.observedAt, nowMs)}. What follows is the last deck that read cleanly, and the count above may be short.`}
        </p>
      )}

      {decisions.length === 0 && merges.length === 0 ? (
        <NothingNeedsYou
          status={lens.status}
          deckSize={lens.content.length}
          nowMs={nowMs}
        />
      ) : (
        <>
          {decisions.length > 0 && (
            <ul
              data-needs-group="decisions"
              className="card-grid [--qd-card-min:24rem]"
            >
              {decisions.map((row) => (
                <DecisionCard
                  key={row.item.id}
                  row={row}
                  nowMs={nowMs}
                  session={session ?? null}
                />
              ))}
            </ul>
          )}
          {/*
            The second group: work whose pull request is ready to land. A
            separate list rather than a mixed one, because the two are answered
            with different gestures - one is typed, one is a single press - and
            the count above is the fold's, not this render's. Below the
            decisions, deliberately: a question nobody has answered is holding
            work up, and a green pull request is not.
          */}
          {merges.length > 0 && (
            <ul
              data-needs-group="merges"
              className="card-grid [--qd-card-min:24rem]"
            >
              {merges.map((worker) => (
                <MergeCard
                  key={worker.id}
                  worker={worker}
                  nowMs={nowMs}
                  session={merging}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </LensFrame>
  );
}
