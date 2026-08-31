import type { DeckItem, Lens, Worker } from "@/types/document.ts";
import type { DeckRow } from "@/ui/deck/deck-groups";
import { DeckItemRow } from "@/ui/deck/deck-row";
import type { AnsweringSession } from "@/ui/deck/answer-control";
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
 */

function Section({
  name,
  title,
  rows,
  nowMs,
  session,
}: {
  /** The pile's handle in the markup, so a test can assert one pile alone. */
  name: string;
  title: string;
  rows: readonly DeckRow[];
  nowMs: number;
  session: AnsweringSession | null;
}) {
  if (rows.length === 0) return null;
  return (
    <section data-deck-group={name} className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-display text-sm tracking-wide text-foreground">{title}</h3>
        <span className="font-mono text-[0.6875rem] tracking-wide uppercase text-muted-foreground">
          {rows.length}
        </span>
      </header>
      {/* A pile of rows is a grid too: a wider monitor shows more of the queue
          at once rather than three rows of whitespace. */}
      <ul className="card-grid [--qd-card-min:26rem]">
        {rows.map((row) => (
          <DeckItemRow key={row.item.id} row={row} nowMs={nowMs} session={session} />
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
      <p className="text-sm text-muted-foreground">
        {`Nothing to show: the deck could not be read. Noticed ${ago(status.observedAt, nowMs)}.`}
      </p>
    );
  }
  if (counted > 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {`Nothing here: every one of the ${counted} ${counted === 1 ? "item" : "items"} the deck carried is waiting on you, and is in the band above.`}
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">Nothing queued, blocked or held.</p>;
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
  session = null,
}: {
  lens: Lens<readonly DeckItem[]>;
  /** The fleet's work items, read only to name and settle the deck's blockers. */
  fleet: readonly Worker[];
  /** Chosen by the composition point, so every age on the page agrees. */
  nowMs: number;
  /**
   * How an answer reaches the server. Handed down from the composition point
   * because `src/ui/` may not read the runtime, and `null` when the panel has
   * nowhere to record one.
   */
  session?: AnsweringSession | null;
}) {
  const { rest } = needsYou(lens.content, fleet);
  const shown =
    rest.held.length + rest.blocked.length + rest.queued.length + rest.inFlight.length;

  return (
    <LensFrame lens={lens} name="deck" title="Deck" summary={sizeOf(shown)}>
      {/* How old the picture is, which the frame's one line deliberately does
          not say - it names the policy that was breached instead. */}
      {lens.status.state === "stale" && (
        <p className="font-mono text-[0.6875rem] text-muted-foreground">
          {`Current as of ${ago(lens.status.asOf, nowMs)}.`}
        </p>
      )}
      {lens.status.state === "unreadable" && lens.content.length > 0 && (
        <p className="font-mono text-[0.6875rem] text-muted-foreground">
          {`The read failed ${ago(lens.status.observedAt, nowMs)}; showing the last deck that read cleanly.`}
        </p>
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
            session={session}
          />
          <Section
            name="blocked"
            title="Blocked"
            rows={rest.blocked}
            nowMs={nowMs}
            session={session}
          />
          <Section
            name="queued"
            title="Queued"
            rows={rest.queued}
            nowMs={nowMs}
            session={session}
          />
          <Section
            name="in-flight"
            title="In flight"
            rows={rest.inFlight}
            nowMs={nowMs}
            session={session}
          />
        </div>
      )}
    </LensFrame>
  );
}
