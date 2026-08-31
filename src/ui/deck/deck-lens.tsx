import type { DeckItem, Lens, Worker } from "@/types/document.ts";
import { GrokEvent } from "@/ui/components/grok/grok-event";
import type { DeckRow } from "@/ui/deck/deck-groups";
import { DeckItemRow } from "@/ui/deck/deck-row";
import { LensFrame } from "@/ui/lens-frame";
import { ago } from "@/ui/lib/age";
import { needsYou } from "@/ui/needs-you/needs-you";

/**
 * The deck lens: what is coming, and what is stuck.
 *
 * What waits on the operator personally is not here any more. It is the band
 * that owns the first screen - see `src/ui/needs-you/needs-you-band.tsx` - and
 * this lens draws everything the fleet is handling by itself. The split is one
 * fold called from both, in `src/ui/needs-you/needs-you.ts`, rather than a
 * predicate in each: a row that belongs to one list and is drawn by neither is
 * exactly the bug the band exists to prevent, and two predicates is how that
 * bug gets written.
 *
 * The order of the piles is still an argument. A hold that waits on something
 * other than a person is drawn first, because it is the closest thing here to a
 * question, and what is merely queued comes last.
 *
 * It is handed the fleet's work items alongside its own, as a directory and
 * nothing more: a blocker arrives as a bare identity, and the work it names has
 * usually already started, so without the fleet the lens can only repeat an id
 * back. See `deck-groups.ts` for what it does and does not conclude from it.
 *
 * ## The grammar
 *
 * grok's, per `docs/decisions/2026-08-31-the-terminal-grammar.md`. Every line
 * this lens writes about itself - how old the picture is, what a failed read
 * cost, what an empty deck means - is a `◆` event line, because that is what
 * each of them is: something that happened to the read, said in the order it
 * happened. The rows underneath are the `┃` gutter, and the pile headings are
 * the same `◆` mark at the rank above.
 */

/**
 * A pile's heading, in the `◆` rhythm of `grok-event` but as a real heading.
 *
 * `GrokEvent` itself cannot do this job: it takes its label as a string and
 * renders it in a `span` inside a `div`, and a heading may not wrap a `div`.
 * Drawing the pile's name as anything but an `h3` would leave the page's
 * outline skipping from the band's `h2` straight to a row's `h4`, which costs
 * every reader navigating by heading their way into the deck. So the mark and
 * the rhythm are grok's and the element is the document's.
 */
function PileHeading({ title, count }: { title: string; count: number }) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[13px] leading-[1.55]">
      <h3 className="flex min-w-0 items-baseline gap-2 font-normal text-term-fg">
        <span aria-hidden className="shrink-0 text-term-dim">
          ◆
        </span>
        <span className="min-w-0">{title}</span>
      </h3>
      <span className="shrink-0 tabular-nums text-term-faint">[{count}]</span>
    </header>
  );
}

function Section({
  name,
  title,
  rows,
  nowMs,
}: {
  /** The pile's handle in the markup, so a test can assert one pile alone. */
  name: string;
  title: string;
  rows: readonly DeckRow[];
  nowMs: number;
}) {
  if (rows.length === 0) return null;
  return (
    <section data-deck-group={name} className="flex flex-col gap-2">
      <PileHeading title={title} count={rows.length} />
      {/* A pile of rows is a grid too: a wider monitor shows more of the queue
          at once rather than three rows of whitespace. */}
      <ul className="card-grid [--qd-card-min:26rem]">
        {rows.map((row) => (
          <DeckItemRow key={row.item.id} row={row} nowMs={nowMs} />
        ))}
      </ul>
    </section>
  );
}

/**
 * What the lens says when it has no rows to draw.
 *
 * An empty deck and an unreadable one look the same on screen unless the lens
 * says which it is, and the difference matters more than anything else here:
 * one means there is nothing waiting, the other means nobody knows.
 */
function EmptyDeck({
  status,
  nowMs,
  counted,
}: {
  status: Lens<unknown>["status"];
  nowMs: number;
  /** How many rows the deck carried, all of which the band above is drawing. */
  counted: number;
}) {
  if (status.state === "unreadable") {
    return (
      <GrokEvent
        label={`Nothing to show: the deck could not be read. Noticed ${ago(status.observedAt, nowMs)}.`}
      />
    );
  }
  if (counted > 0) {
    return (
      <GrokEvent
        label={`Nothing here: every one of the ${counted} ${counted === 1 ? "item" : "items"} the deck carried is waiting on you, and is in the band above.`}
      />
    );
  }
  return <GrokEvent label="Nothing queued, blocked or held." />;
}

/**
 * How many items this lens is holding, for the pinned header.
 *
 * What it is not is how many the deck carried: the decisions are counted by the
 * band above, and adding them here would put one work item under two headline
 * numbers. The same rule the fleet's header follows otherwise - a count says
 * whether the piles on screen are all of them, and judging them is the lens's
 * job below.
 */
function sizeOf(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? "1 item" : `${count} items`;
}

export function DeckLens({
  lens,
  fleet,
  nowMs,
}: {
  lens: Lens<readonly DeckItem[]>;
  /** The fleet's work items, read only to name and settle the deck's blockers. */
  fleet: readonly Worker[];
  /** Chosen by the composition point, so every age on the page agrees. */
  nowMs: number;
}) {
  const { rest } = needsYou(lens.content, fleet);
  const shown =
    rest.held.length + rest.blocked.length + rest.queued.length + rest.inFlight.length;

  return (
    <LensFrame lens={lens} name="deck" title="Deck" summary={sizeOf(shown)}>
      {/* How old the picture is, which the frame's one line deliberately does
          not say - it names the policy that was breached instead. */}
      {lens.status.state === "stale" && (
        <GrokEvent
            label={`Current as of ${ago(lens.status.asOf, nowMs)}.`}
        />
      )}
      {lens.status.state === "unreadable" && lens.content.length > 0 && (
        <GrokEvent
            label={`The read failed ${ago(lens.status.observedAt, nowMs)}; showing the last deck that read cleanly.`}
        />
      )}

      {shown === 0 ? (
        <EmptyDeck status={lens.status} nowMs={nowMs} counted={lens.content.length} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Held, but not for a person: a queue, a date, or a word this build
              has never heard of. None of them is a question the operator can
              answer, which is why they are here and not in the band. */}
          <Section
            name="held"
            title="Waiting on something else"
            rows={rest.held}
            nowMs={nowMs}
          />
          <Section
            name="blocked"
            title="Blocked"
            rows={rest.blocked}
            nowMs={nowMs}
          />
          <Section
            name="queued"
            title="Queued"
            rows={rest.queued}
            nowMs={nowMs}
          />
          <Section
            name="in-flight"
            title="In flight"
            rows={rest.inFlight}
            nowMs={nowMs}
          />
        </div>
      )}
    </LensFrame>
  );
}
