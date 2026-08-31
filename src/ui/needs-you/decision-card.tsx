import type { Blocker, DeckRow } from "@/ui/deck/deck-groups";
import type { AnsweringSession } from "@/ui/lib/answering";
import { AnswerControl } from "@/ui/needs-you/answer-control";
import { ItemIdentity } from "@/ui/lib/item-identity";
import { cn } from "@/ui/lib/utils";

/**
 * One decision held for a person, drawn as the terminal grammar's gutter card.
 *
 * The band's own card rather than the deck's row on a card surface. The two
 * lists are answered with different gestures and are now drawn by the two
 * directories that own them; what they still share is the fold in
 * `src/ui/needs-you/needs-you.ts`, which is the thing that makes "drawn by
 * neither" impossible to write - and the identity line, which is the deck's
 * own `ItemIdentity` rather than a second copy of the same sentence, so a
 * decision an operator answers here and the same work seen in the deck cannot
 * drift into reading as two different jobs.
 *
 * The grammar's box is a `┃` gutter over the page's own ground: `--term-bg` is
 * `--background`, so a card and the page it sits on are the same colour and the
 * rule down its edge is what separates them. That is the whole of the skin
 * change here - the grid, the card width and the band's share of the first
 * screen are the wireframe's and did not move.
 */

/**
 * The accent down the gutter, in the panel's state vocabulary.
 *
 * A decision that can be taken now is the only thing that gets the accent
 * colour. One deferred to a date is still waiting on a person, but it is not
 * urgent, and colouring it as though it were is the lie this band exists to
 * avoid - so it gets the ordinary rule.
 */
function accentOf({ item }: DeckRow): string {
  return item.actionable && item.hold?.deferredTo == null
    ? "border-term-accent"
    : "border-term-rule";
}

/** A blocker, named as far as the document names it: a title, or bare identity. */
function BlockerLine({ blocker }: { blocker: Blocker }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="min-w-0 wrap-anywhere text-[13px] text-term-fg">
        {blocker.label ?? blocker.id}
      </span>
      {blocker.where !== null && (
        <span className="text-[12px] text-term-faint">{blocker.where}</span>
      )}
    </li>
  );
}

export function DecisionCard({
  row,
  nowMs,
  session,
}: {
  /** Held for a person and answerable: the fold admits nothing else here. */
  row: DeckRow;
  nowMs: number;
  /**
   * How an answer reaches the server. `null` when nothing is configured to
   * carry one, which the control says on the card rather than hiding.
   */
  session: AnsweringSession | null;
}) {
  const { item, blocking, cleared } = row;
  const hold = item.hold;

  return (
    <li
      data-deck-item={item.id}
      data-actionable={item.actionable}
      className={cn(
        "min-w-0 border-l-2 pl-3 font-mono text-[13px] leading-[1.55]",
        accentOf(row),
      )}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <h3 className="min-w-0 wrap-anywhere text-[13px] font-semibold text-term-fg-bright">
          {item.title}
        </h3>
        {/* The rank the deck gave it, in the grammar's bracketed-meta form -
            the same shape a tool card's `[hooks: 3]` takes. A chip with a fill
            of its own would be a second visual language on this card. */}
        <span
          className={cn(
            "shrink-0 text-[12px]",
            item.priority === "now" ? "text-term-accent" : "text-term-faint",
          )}
        >
          [{item.priority}]
        </span>
      </div>

      {/* Enough identity to recognise a piece of work by, and the first thing
          under the title so it is never pushed below anything. The same
          sentence the deck's rows carry - see `ItemIdentity`. */}
      <ItemIdentity item={item} nowMs={nowMs} emphasis="text-term-dim" />

      {hold !== null && (
        <div className="mt-1.5 space-y-0.5">
          <p className="text-[13px] text-term-fg">
            Waiting on{" "}
            <span className="font-semibold text-term-fg-bright">
              {hold.waitingOn}
            </span>
          </p>
          {/* Upstream's own words, unedited: a paraphrase of a reason is a
              second-hand account of why someone stopped. */}
          {hold.reason !== null && (
            <p className="text-[13px] wrap-anywhere text-term-muted">
              {hold.reason}
            </p>
          )}
          {hold.deferredTo !== null && (
            <p className="text-[12px] text-term-faint">
              deferred until{" "}
              <time dateTime={hold.deferredTo}>{hold.deferredTo}</time>
            </p>
          )}
          <AnswerControl
            taskId={item.id}
            since={item.since ?? ""}
            session={session}
          />
        </div>
      )}

      {blocking.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[12px] tracking-wide text-term-muted uppercase">
            Blocked by
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {blocking.map((blocker) => (
              <BlockerLine key={blocker.id} blocker={blocker} />
            ))}
          </ul>
          {item.blocked?.reason != null && (
            <p className="mt-0.5 text-[13px] wrap-anywhere text-term-muted">
              {item.blocked.reason}
            </p>
          )}
        </div>
      )}

      {cleared.length > 0 && (
        <p className="mt-1.5 text-[12px] wrap-anywhere text-term-faint">
          {`${cleared.map((blocker) => blocker.id).join(", ")} landed; no longer blocking`}
        </p>
      )}
    </li>
  );
}
