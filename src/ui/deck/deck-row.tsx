import type { Priority } from "@/types/document.ts";
import { GrokTool } from "@/ui/components/grok/grok-tool";
import { ItemIdentity } from "@/ui/lib/item-identity";
import { cn } from "@/ui/lib/utils";
import type { Blocker, DeckRow as Row } from "@/ui/deck/deck-groups";

/**
 * One line of the deck: what the work is, and whatever is in its way.
 *
 * Three piles share this component so a queued item and a held one cannot drift
 * into looking like different species of thing. What differs between them is
 * the accent down the left edge and the detail underneath, both driven by the
 * item itself rather than by which list it was drawn in.
 *
 * ## The grammar
 *
 * The `┃` gutter and the `◆` mark beside the title are grok's, taken from
 * `grok-tool`'s card form - the same two marks that head an agent's tool call
 * head a piece of work here. The rail is the one place the row carries a
 * meaning in colour, so the mark takes the rail's own hue and nothing else on
 * the row competes with it. See
 * `docs/decisions/2026-08-31-the-terminal-grammar.md`.
 */

/**
 * The priority, in grok's bracket idiom rather than as a pill.
 *
 * Three ranks of emphasis, not three hues: `now` takes the accent the rail uses
 * for a decision that can be taken, `next` is ordinary text, and `later` sits
 * at the timestamp rank. A `later` badge drawn as loudly as a `now` one is the
 * same lie the rail avoids.
 */
const PRIORITY_TONE: Readonly<Record<Priority, string>> = {
  now: "text-term-accent",
  next: "text-term-fg",
  later: "text-term-faint",
};

/**
 * The rail down the left edge, and the mark that matches it.
 *
 * A decision that can be taken now is the only thing that gets the accent. One
 * deferred to a date is still waiting on a person, but it is not urgent, and
 * colouring it as though it were is the lie this lens exists to avoid - so it
 * takes the resting rule, the quietest edge the grammar has.
 *
 * `--term-accent` and `--term-danger` are the same stop, which the terminal
 * grammar records and accepts. Nothing here draws a danger rail, so the two are
 * never on screen together and never have to be told apart.
 */
type Accent = { readonly rail: string; readonly mark: string };

const QUEUED: Accent = { rail: "border-term-rule", mark: "text-term-dim" };

function accentOf({ item, blocking }: Row): Accent {
  if (item.hold !== null) {
    return item.actionable && item.hold.deferredTo === null
      ? { rail: "border-term-accent", mark: "text-term-accent" }
      : { rail: "border-term-rule-soft", mark: "text-term-faint" };
  }
  if (blocking.length > 0) {
    return { rail: "border-term-warning", mark: "text-term-warning" };
  }
  if (item.state === "in-flight") {
    return { rail: "border-term-info", mark: "text-term-info" };
  }
  return QUEUED;
}

/**
 * A blocker, named as far as the document names it: a title, or bare identity.
 *
 * Drawn through `grok-tool`'s compact line, which is the grammar's shape for
 * exactly this - a thing referred to by its identifier, with where it lives
 * trailing after it. A blocker with no title arrives as an id and this is what
 * an id looks like in the grammar, so the two cases need no separate styling.
 */
function BlockerLine({ blocker }: { blocker: Blocker }) {
  return (
    <li className="min-w-0">
      <GrokTool
        variant="line"
        path={blocker.label ?? blocker.id}
        meta={blocker.where ?? undefined}
      />
    </li>
  );
}

/**
 * One line in a pile: a rail down the left edge and nothing else, so a deck of
 * fifteen reads as a list rather than as fifteen competing objects.
 *
 * The heading is an `h4` because a pile has its own `h3` above it, and the
 * page's outline may not skip. There is one surface and one level: the row used
 * to carry a `card` tone for the needs-you band, and the band draws its own
 * `DecisionCard` now.
 *
 * ## Why there is no answer control here
 *
 * This row cannot receive an answerable item, and the argument is worth stating
 * because it is what a second copy of the answer control used to rest on. The
 * only caller is `DeckLens`, which draws `needsYou(...).rest`: `rest.held` is
 * every hold the band did not take, the band takes every `isAnswerable` one,
 * and the other three piles are all `hold === null`. So no row arriving here
 * satisfies both `hold !== null` and `isAnswerable`.
 *
 * That held while the deck carried a control anyway - it was dead code for as
 * long as it existed. If a future change gives this component a second caller,
 * or lets an answerable row into any pile, the argument lapses and the question
 * of who offers the control has to be answered again rather than assumed. See
 * `docs/decisions/2026-08-31-what-the-parallel-lens-build-duplicated.md`.
 */
export function DeckItemRow({ row, nowMs }: { row: Row; nowMs: number }) {
  const { item, blocking, cleared } = row;
  const hold = item.hold;
  const accent = accentOf(row);

  return (
    <li
      data-deck-item={item.id}
      data-actionable={item.actionable}
      className={cn(
        "min-w-0 border-l-2 py-1.5 pl-3 font-mono text-[13px] leading-[1.55]",
        accent.rail,
      )}
    >
      {/* Title and priority on one row, with the priority pushed to the end:
          the rank is what the eye scans down, so it wants a column of its
          own rather than a badge trailing a title of unpredictable length. */}
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="flex min-w-0 items-baseline gap-2 font-normal text-term-fg-bright">
          <span aria-hidden className={cn("shrink-0", accent.mark)}>
            ◆
          </span>
          <span className="min-w-0 wrap-anywhere">{item.title}</span>
        </h4>
        <span className={cn("shrink-0", PRIORITY_TONE[item.priority])}>
          [{item.priority}]
        </span>
      </div>

      {/* Enough identity to recognise a piece of work by, in the one sentence
          the band's cards also carry. See `ItemIdentity`. */}
      <ItemIdentity
        item={item}
        nowMs={nowMs}
        emphasis="text-term-fg"
        className="pl-4"
      />

      {hold !== null && (
        <div className="mt-1.5 space-y-0.5 pl-4">
          <p className="text-term-dim">
            Waiting on{" "}
            <span className="text-term-fg-bright">{hold.waitingOn}</span>
          </p>
          {/* Upstream's own words, unedited: a paraphrase of a reason is a
              second-hand account of why someone stopped. */}
          {hold.reason !== null && (
            <p className="wrap-anywhere text-term-muted">{hold.reason}</p>
          )}
          {hold.deferredTo !== null && (
            <p className="text-[12px] text-term-faint">
              deferred until{" "}
              <time dateTime={hold.deferredTo}>{hold.deferredTo}</time>
            </p>
          )}
        </div>
      )}

      {blocking.length > 0 && (
        <div className="mt-1.5 pl-4">
          <p className="text-[12px] tracking-wide text-term-muted uppercase">
            Blocked by
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {blocking.map((blocker) => (
              <BlockerLine key={blocker.id} blocker={blocker} />
            ))}
          </ul>
          {item.blocked?.reason != null && (
            <p className="mt-0.5 wrap-anywhere text-term-muted">
              {item.blocked.reason}
            </p>
          )}
        </div>
      )}

      {cleared.length > 0 && (
        <p className="mt-1.5 pl-4 text-[12px] wrap-anywhere text-term-faint">
          {`${cleared.map((blocker) => blocker.id).join(", ")} landed; no longer blocking`}
        </p>
      )}
    </li>
  );
}
