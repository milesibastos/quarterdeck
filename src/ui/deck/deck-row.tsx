import type { DeckItem, Priority } from "@/types/document.ts";
import { Badge } from "@/ui/components/badge";
import { ago } from "@/ui/lib/age";
import { cn } from "@/ui/lib/utils";
import type { Blocker, DeckRow as Row } from "@/ui/deck/deck-groups";
import { isAnswerable } from "@/ui/deck/deck-groups";
import { AnswerControl, type AnsweringSession } from "@/ui/deck/answer-control";

/**
 * One line of the deck: what the work is, and whatever is in its way.
 *
 * Three piles share this component so a queued item and a held one cannot drift
 * into looking like different species of thing. What differs between them is
 * the accent down the left edge and the detail underneath, both driven by the
 * item itself rather than by which list it was drawn in.
 */

const PRIORITY_VARIANT: Readonly<Record<Priority, "default" | "secondary" | "outline">> = {
  now: "default",
  next: "secondary",
  later: "outline",
};

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
 * The accent, in the panel's state vocabulary.
 *
 * A decision that can be taken now is the only thing that gets the primary
 * accent. One deferred to a date is still waiting on a person, but it is not
 * urgent, and colouring it as though it were is the lie this lens exists to
 * avoid.
 */
function accentOf({ item, blocking }: Row): string {
  if (item.hold !== null) {
    return item.actionable && item.hold.deferredTo === null
      ? "border-primary"
      : "border-muted-foreground/40";
  }
  if (blocking.length > 0) return "border-warn";
  if (item.state === "in-flight") return "border-info";
  return "border-border";
}

/** A blocker, named as far as the document names it: a title, or bare identity. */
function BlockerLine({ blocker }: { blocker: Blocker }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5">
      <span
        className={cn(
          "min-w-0 wrap-anywhere text-sm",
          blocker.label === null && "font-mono text-xs",
        )}
      >
        {blocker.label ?? blocker.id}
      </span>
      {blocker.where !== null && (
        <span className="font-mono text-[0.6875rem] text-muted-foreground">{blocker.where}</span>
      )}
    </li>
  );
}

export function DeckItemRow({
  row,
  nowMs,
  session,
}: {
  row: Row;
  nowMs: number;
  /**
   * How an answer reaches the server, for the items that can be answered.
   * `null` when nothing is configured to carry one.
   */
  session?: AnsweringSession | null;
}) {
  const { item, blocking, cleared } = row;
  const hold = item.hold;

  return (
    <li
      data-deck-item={item.id}
      data-actionable={item.actionable}
      className={cn("border-l-2 py-1.5 pl-3", accentOf(row))}
    >
      {/*
        Title and priority sit on one row with the priority pushed to the end.
        The control that answers a held decision belongs beside it, and this
        layout has the space for it - which is the whole reason it is a flex row
        today rather than a heading with a badge after it.
      */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-heading text-sm leading-snug font-medium wrap-anywhere text-foreground">
          {item.title}
        </h4>
        <Badge variant={PRIORITY_VARIANT[item.priority]} className="shrink-0">
          {item.priority}
        </Badge>
      </div>

      {/*
        What this is and how long it has been: enough identity to recognise a
        piece of work by. Project and kind are shown only when the row said -
        a hand-written backlog line often names neither, and a guessed project
        is worse than an absent one. The date is the same: a row with no start
        says so rather than being stamped with the moment upstream looked.
      */}
      <p className="mt-0.5 font-mono text-[0.6875rem] wrap-anywhere text-muted-foreground">
        <span className={item.since === null ? undefined : "text-foreground"}>
          {item.since === null ? "no start date" : ago(item.since, nowMs)}
        </span>
        {` · ${STATE_WORDS[item.state]}`}
        {item.project !== null && (
          <>
            {" · "}
            <span className="text-foreground">{item.project}</span>
          </>
        )}
        {item.kind !== null && ` · ${KIND_WORDS[item.kind]}`}
        {` · ${item.id}`}
      </p>

      {hold !== null && (
        <div className="mt-1.5 space-y-0.5">
          <p className="text-sm text-foreground">
            Waiting on <span className="font-medium">{hold.waitingOn}</span>
          </p>
          {/* Upstream's own words, unedited: a paraphrase of a reason is a
              second-hand account of why someone stopped. */}
          {hold.reason !== null && (
            <p className="text-sm wrap-anywhere text-muted-foreground">{hold.reason}</p>
          )}
          {hold.deferredTo !== null && (
            <p className="font-mono text-[0.6875rem] text-muted-foreground">
              deferred until <time dateTime={hold.deferredTo}>{hold.deferredTo}</time>
            </p>
          )}
          {/* Only a hold that waits on a person gets the control. A queue or a
              date cannot be answered, and offering a text box against one
              would promise something pressing it could never deliver. */}
          {isAnswerable(item) && (
            <AnswerControl
              taskId={item.id}
              since={item.since ?? ""}
              session={session ?? null}
            />
          )}
        </div>
      )}

      {blocking.length > 0 && (
        <div className="mt-1.5">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Blocked by</p>
          <ul className="mt-0.5 space-y-0.5 text-foreground">
            {blocking.map((blocker) => (
              <BlockerLine key={blocker.id} blocker={blocker} />
            ))}
          </ul>
          {item.blocked?.reason != null && (
            <p className="mt-0.5 text-sm wrap-anywhere text-muted-foreground">{item.blocked.reason}</p>
          )}
        </div>
      )}

      {cleared.length > 0 && (
        <p className="mt-1.5 font-mono text-[0.6875rem] wrap-anywhere text-muted-foreground">
          {`${cleared.map((blocker) => blocker.id).join(", ")} landed; no longer blocking`}
        </p>
      )}
    </li>
  );
}
