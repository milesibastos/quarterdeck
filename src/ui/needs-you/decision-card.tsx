import type { DeckItem } from "@/types/document.ts";
import type { Blocker, DeckRow } from "@/ui/deck/deck-groups";
import type { AnsweringSession } from "@/ui/lib/answering";
import { AnswerControl } from "@/ui/needs-you/answer-control";
import { agoAtPrecision } from "@/ui/lib/age";
import { cn } from "@/ui/lib/utils";

/**
 * One decision held for a person, drawn as the terminal grammar's gutter card.
 *
 * The band's own card rather than the deck's row on a card surface. The two
 * lists are answered with different gestures and are now drawn by the two
 * directories that own them; what they still share is the fold in
 * `src/ui/needs-you/needs-you.ts`, which is the thing that makes "drawn by
 * neither" impossible to write. The identity line below is deliberately the
 * same sentence the deck's rows carry - a decision an operator answers here and
 * the same work seen in the deck must not read as two different jobs.
 *
 * The grammar's box is a `┃` gutter over the page's own ground: `--term-bg` is
 * `--background`, so a card and the page it sits on are the same colour and the
 * rule down its edge is what separates them. That is the whole of the skin
 * change here - the grid, the card width and the band's share of the first
 * screen are the wireframe's and did not move.
 */

const STATE_WORDS: Readonly<Record<DeckItem["state"], string>> = {
  queued: "queued",
  "in-flight": "in flight",
};

/** The same two words the fleet's cards use, so one job reads the same in both. */
const KIND_WORDS: Readonly<Record<NonNullable<DeckItem["kind"]>, string>> = {
  build: "build",
  research: "research",
};

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

      {/*
        What this is and how long it has been: enough identity to recognise a
        piece of work by, and the first thing under the title so it is never
        pushed below anything. Project and kind are shown only when the row said
        - a hand-written backlog line often names neither, and a guessed project
        is worse than an absent one. The date is the same: a row with no start
        says so rather than being stamped with the moment upstream looked, and a
        row whose start is a day reads as a day rather than as an hour count
        measured from a midnight the record never stated.
      */}
      <p className="mt-0.5 text-[12px] wrap-anywhere text-term-faint">
        <span className={item.since === null ? undefined : "text-term-dim"}>
          {item.since === null ? "no start date" : agoAtPrecision(item.since, nowMs)}
        </span>
        {` · ${STATE_WORDS[item.state]}`}
        {item.project !== null && (
          <>
            {" · "}
            <span className="text-term-dim">{item.project}</span>
          </>
        )}
        {item.kind !== null && ` · ${KIND_WORDS[item.kind]}`}
        {` · ${item.id}`}
      </p>

      {hold !== null && (
        <div className="mt-1.5 space-y-0.5">
          <p className="text-[13px] text-term-fg">
            Waiting on <span className="font-semibold text-term-fg-bright">{hold.waitingOn}</span>
          </p>
          {/* Upstream's own words, unedited: a paraphrase of a reason is a
              second-hand account of why someone stopped. */}
          {hold.reason !== null && (
            <p className="text-[13px] wrap-anywhere text-term-muted">{hold.reason}</p>
          )}
          {hold.deferredTo !== null && (
            <p className="text-[12px] text-term-faint">
              deferred until <time dateTime={hold.deferredTo}>{hold.deferredTo}</time>
            </p>
          )}
          <AnswerControl taskId={item.id} since={item.since ?? ""} session={session} />
        </div>
      )}

      {blocking.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[12px] tracking-wide text-term-muted uppercase">Blocked by</p>
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
