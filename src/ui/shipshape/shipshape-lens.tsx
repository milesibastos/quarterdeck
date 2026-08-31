import type {
  DriftSignal,
  Health,
  Lens,
  OverdueSignal,
  SupervisorSignal,
} from "@/types/document.ts";
import { LensFrame } from "@/ui/lens-frame";
import { ago } from "@/ui/lib/age";
import { SignalBlock, Unread } from "@/ui/shipshape/signal-block";
import {
  SUPERVISION_SILENT_AFTER_LABEL,
  SUPERVISION_SILENT_AFTER_MS,
} from "@/ui/shipshape/thresholds";

/**
 * The shipshape lens: whether the machinery that watches the fleet is healthy.
 *
 * The other two lenses report on the fleet. This one reports on the reporting,
 * which is why its own honesty matters more than theirs: if supervision has
 * quietly stopped, every other lens keeps drawing confident cards from a
 * picture nobody is refreshing, and this is the only place that says so.
 *
 * Three signals, and each one can independently say it could not be read - so
 * each is drawn on its own terms rather than folded into a single verdict. A
 * document with one dark signal and two live ones renders as exactly that. An
 * unreadable signal never renders as a healthy one, and never implies what it
 * would have said: it names what failed, and names what is therefore unknown.
 *
 * The lens as a whole can also go dark while fleet and deck keep working. That
 * is the designed behaviour rather than a fault - see the note in
 * `src/types/document.ts` on why the document has no single degraded flag - and
 * it is drawn as a deliberate, explained condition.
 */

/**
 * The whole lens dark: what that is, and what it does not mean.
 *
 * Deliberately says nothing about the state of the other two lenses. This
 * component is handed `document.health` and nothing else, so it cannot see
 * whether they read cleanly - and a hard-coded "the others are fine" would be a
 * lie on the day both readers fail together. What it can say, because the
 * document is built that way, is that they come from a different source with a
 * status of its own, and that what is missing here is the check on it.
 */
function Dark() {
  return (
    <p className="rounded-lg border border-dashed border-muted-foreground/40 px-3 py-2 text-xs text-muted-foreground">
      Dark by design, not broken. Health is read from files that carry no
      compatibility promise, so this lens can fail on its own. Fleet and deck
      are read from a different source and carry their own status; what is gone
      is the check on whether that source is still being refreshed.
    </p>
  );
}

/**
 * Is the supervision cycle alive, and when was it last seen?
 *
 * Alive is not the whole answer. The document carries upstream's own word for
 * whether the cycle is running and the moment it was last seen, and a cycle
 * that calls itself alive but has been quiet for hours is practically dead - so
 * the age is part of the verdict rather than a footnote under it. Where the
 * line falls is this lens's judgement, and it lives in one place: see
 * `thresholds.ts`, which also holds the words the copy below uses for it.
 */
function Supervisor({ signal, nowMs }: { signal: SupervisorSignal; nowMs: number }) {
  if (signal.read === "unreadable") {
    return (
      <SignalBlock
        name="supervisor"
        question="Is the supervision cycle alive?"
        verdict="unreadable"
        label="Not read"
        tone="dark"
      >
        <Unread
          detail={signal.detail}
          unknown="Whether the cycle is running, and when it was last seen, are both unknown."
        />
      </SignalBlock>
    );
  }

  const seen = ago(signal.lastSeen, nowMs);
  const silent = nowMs - Date.parse(signal.lastSeen) > SUPERVISION_SILENT_AFTER_MS;

  if (!signal.alive) {
    return (
      <SignalBlock
        name="supervisor"
        question="Is the supervision cycle alive?"
        verdict="stopped"
        label="Stopped"
        tone="bad"
      >
        <p className="text-xs text-foreground">
          {`Last seen ${seen}. The cycle is not running, so nothing is refreshing the picture the rest of the panel draws.`}
        </p>
      </SignalBlock>
    );
  }

  if (silent) {
    return (
      <SignalBlock
        name="supervisor"
        question="Is the supervision cycle alive?"
        verdict="silent"
        label="Alive but silent"
        tone="watch"
      >
        <p className="text-xs text-foreground">
          {`Last seen ${seen}. The cycle reports itself alive, but it has been quiet for longer than ${SUPERVISION_SILENT_AFTER_LABEL}, which is long enough to read the rest of the panel as a picture that may not have been refreshed since.`}
        </p>
      </SignalBlock>
    );
  }

  return (
    <SignalBlock
      name="supervisor"
      question="Is the supervision cycle alive?"
      verdict="alive"
      label="Alive"
      tone="good"
    >
      <p className="text-xs text-foreground">
        {`Last seen ${seen}, inside the ${SUPERVISION_SILENT_AFTER_LABEL} this panel allows between sightings.`}
      </p>
    </SignalBlock>
  );
}

/**
 * Is anything waiting longer than it should?
 *
 * An empty list is an answer, not an empty area: the check ran and found
 * nothing, and saying so plainly is what tells it apart from the check not
 * having run. That distinction is the whole reason this signal is drawn rather
 * than left blank when there is nothing in it.
 */
function OverdueWork({ signal, nowMs }: { signal: OverdueSignal; nowMs: number }) {
  if (signal.read === "unreadable") {
    return (
      <SignalBlock
        name="overdue"
        question="Is anything waiting too long?"
        verdict="unreadable"
        label="Not read"
        tone="dark"
      >
        <Unread
          detail={signal.detail}
          unknown="Whether anything has been waiting too long is unknown; this is not a report of nothing overdue."
        />
      </SignalBlock>
    );
  }

  if (signal.overdue.length === 0) {
    return (
      <SignalBlock
        name="overdue"
        question="Is anything waiting too long?"
        verdict="clear"
        label="Nothing overdue"
        tone="good"
      >
        <p className="text-xs text-foreground">
          The check read cleanly and found nothing waiting longer than it should.
        </p>
      </SignalBlock>
    );
  }

  const count = signal.overdue.length;
  return (
    <SignalBlock
      name="overdue"
      question="Is anything waiting too long?"
      verdict="overdue"
      label={`${count} overdue`}
      tone="watch"
    >
      <ul className="flex flex-col gap-1">
        {signal.overdue.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
          >
            <span className="min-w-0 truncate font-mono text-foreground">{item.id}</span>
            <span className="font-mono text-muted-foreground">
              {`waiting since ${ago(item.waitingSince, nowMs)}`}
            </span>
          </li>
        ))}
      </ul>
    </SignalBlock>
  );
}

/**
 * Does any durable record disagree with what is actually happening?
 *
 * The same rule as above: none is a finding, and it is written as one. Each
 * disagreement names the record and upstream's one line on how it disagrees -
 * the panel adds no interpretation of its own, because it has none to add.
 */
function Drift({ signal }: { signal: DriftSignal }) {
  if (signal.read === "unreadable") {
    return (
      <SignalBlock
        name="drift"
        question="Does any record disagree with reality?"
        verdict="unreadable"
        label="Not read"
        tone="dark"
      >
        <Unread
          detail={signal.detail}
          unknown="Whether any record disagrees is unknown; this is not a report of records that agree."
        />
      </SignalBlock>
    );
  }

  if (signal.disagreements.length === 0) {
    return (
      <SignalBlock
        name="drift"
        question="Does any record disagree with reality?"
        verdict="clear"
        label="No disagreement"
        tone="good"
      >
        <p className="text-xs text-foreground">
          The records were compared and every one of them agrees with what the fleet is doing.
        </p>
      </SignalBlock>
    );
  }

  const count = signal.disagreements.length;
  return (
    <SignalBlock
      name="drift"
      question="Does any record disagree with reality?"
      verdict="disagreeing"
      label={`${count} disagreeing`}
      tone="watch"
    >
      <ul className="flex flex-col gap-1.5">
        {signal.disagreements.map((disagreement) => (
          <li key={disagreement.record} className="flex flex-col text-xs">
            <span className="truncate font-mono text-foreground">{disagreement.record}</span>
            <span className="break-words text-muted-foreground">{disagreement.detail}</span>
          </li>
        ))}
      </ul>
    </SignalBlock>
  );
}

export function ShipshapeLens({
  lens,
  nowMs,
}: {
  lens: Lens<Health>;
  /** Chosen by the composition point, so the ages agree with the projection. */
  nowMs: number;
}) {
  const { content, status } = lens;

  return (
    <LensFrame lens={lens} name="shipshape" title="Shipshape">
      {/*
        A stale reading knows when it was taken, so it can be dated. An
        unreadable one knows only when the panel noticed, which dates nothing -
        it gets the note below instead.
      */}
      {status.state === "stale" && (
        <p className="text-xs text-muted-foreground">
          {`Last good reading, taken ${ago(status.asOf, nowMs)}.`}
        </p>
      )}
      {status.state === "unreadable" && <Dark />}

      <div className="flex flex-col gap-2">
        <Supervisor signal={content.supervisor} nowMs={nowMs} />
        <OverdueWork signal={content.overdue} nowMs={nowMs} />
        <Drift signal={content.drift} />
      </div>
    </LensFrame>
  );
}
