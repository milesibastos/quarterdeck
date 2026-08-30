import type { DeckItem, Lens, Worker } from "@/types/document.ts";
import { groupDeck, type DeckRow } from "@/ui/deck/deck-groups";
import { DeckItemRow } from "@/ui/deck/deck-row";
import { LensFrame } from "@/ui/lens-frame";
import { ago } from "@/ui/lib/age";
import { cn } from "@/ui/lib/utils";

/**
 * The deck lens: what is coming, what is stuck, and what is waiting on a
 * person.
 *
 * The order of the piles is the whole argument. A decision nobody knows is
 * pending is the failure this lens exists to prevent, so what waits on a person
 * is drawn first and what is merely queued last - and within the first pile,
 * what can be answered right now leads what has been deferred to a date.
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
  note,
  urgent = false,
}: {
  /** The pile's handle in the markup, so a test can assert one pile alone. */
  name: string;
  title: string;
  rows: readonly DeckRow[];
  nowMs: number;
  /** One line to the right of the heading, or `null` when there is nothing to add. */
  note?: string | null;
  /** Draw the note in the accent colour: something here is waiting on the reader. */
  urgent?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section data-deck-group={name} className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-display text-sm tracking-wide text-foreground">{title}</h3>
        <span
          className={cn(
            "font-mono text-[0.6875rem] tracking-wide uppercase",
            urgent ? "text-primary" : "text-muted-foreground",
          )}
        >
          {note ?? `${rows.length}`}
        </span>
      </header>
      <ul className="flex flex-col gap-2">
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
function EmptyDeck({ status, nowMs }: { status: Lens<unknown>["status"]; nowMs: number }) {
  if (status.state === "unreadable") {
    return (
      <p className="text-sm text-muted-foreground">
        {`Nothing to show: the deck has not read cleanly since the panel started. Noticed ${ago(status.observedAt, nowMs)}.`}
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">Nothing queued, blocked or held.</p>;
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
  const groups = groupDeck(lens.content, fleet);
  const actionable = groups.held.filter((row) => row.item.actionable).length;

  return (
    <LensFrame lens={lens} name="deck" title="Deck">
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

      {lens.content.length === 0 ? (
        <EmptyDeck status={lens.status} nowMs={nowMs} />
      ) : (
        <div className="flex flex-col gap-4">
          <Section
            name="held"
            title="Waiting on a person"
            rows={groups.held}
            nowMs={nowMs}
            note={actionable > 0 ? `${actionable} to answer` : "none actionable"}
            urgent={actionable > 0}
          />
          <Section name="blocked" title="Blocked" rows={groups.blocked} nowMs={nowMs} />
          <Section name="queued" title="Queued" rows={groups.queued} nowMs={nowMs} />
          <Section name="in-flight" title="In flight" rows={groups.inFlight} nowMs={nowMs} />
        </div>
      )}
    </LensFrame>
  );
}
