import type {
  AttendanceSignal,
  DriftSignal,
  Health,
  Lens,
  OverdueSignal,
  QueueSignal,
  SupervisorSignal,
} from "@/types/document.ts";
import { LensFrame } from "@/ui/lens-frame";
import { ago } from "@/ui/lib/age";
import { SignalBlock, Unread } from "@/ui/shipshape/signal-block";
import {
  QUEUE_BACKED_UP_AT,
  QUEUE_BACKED_UP_AT_LABEL,
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
 * Five signals, and each one can independently say it could not be read - so
 * each is drawn on its own terms rather than folded into a single verdict. A
 * document with one dark signal and four live ones renders as exactly that. An
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
    <p className="border border-dashed border-term-faint px-3 py-2 font-mono text-[13px] leading-[1.55] text-term-muted">
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
        <p>
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
        <p>
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
      <p>
        {`Last seen ${seen}, inside the ${SUPERVISION_SILENT_AFTER_LABEL} this panel allows between sightings.`}
      </p>
    </SignalBlock>
  );
}

/**
 * Is the notification queue draining?
 *
 * The document carries a depth, not a verdict - and that is the whole shape of
 * this signal. A queue with things in it is a queue doing its job; a queue that
 * keeps holding them is a fleet that has stopped delivering, and the operator
 * cannot tell those apart from anything else on the page. Where the line
 * between them falls is this lens's call and lives in `thresholds.ts`, beside
 * the words the copy below quotes for it.
 *
 * `queued: 0` is a queue that was read and found empty, which is a finding and
 * is written as one. It is emphatically not the same fact as a queue that could
 * not be read, and the two never share a rendering.
 */
function Queue({ signal }: { signal: QueueSignal }) {
  if (signal.read === "unreadable") {
    return (
      <SignalBlock
        name="queue"
        question="Is the notification queue draining?"
        verdict="unreadable"
        label="Not read"
        tone="dark"
      >
        <Unread
          detail={signal.detail}
          unknown="How much the notification queue is holding, and so whether it is draining, is unknown; this is not a report of a queue with nothing in it."
        />
      </SignalBlock>
    );
  }

  const { queued } = signal;

  if (queued === 0) {
    return (
      <SignalBlock
        name="queue"
        question="Is the notification queue draining?"
        verdict="empty"
        label="Nothing queued"
        tone="good"
      >
        <p>
          {`The queue was read and found holding nothing, so everything the fleet has raised has already been delivered.`}
        </p>
      </SignalBlock>
    );
  }

  const holding = queued === 1 ? "1 notification is" : `${queued} notifications are`;

  if (queued < QUEUE_BACKED_UP_AT) {
    return (
      <SignalBlock
        name="queue"
        question="Is the notification queue draining?"
        verdict="draining"
        label={`${queued} queued`}
        tone="good"
      >
        <p>
          {`${holding} waiting, under the ${QUEUE_BACKED_UP_AT_LABEL} this panel reads as a queue that has stopped draining. A queue with work passing through it is the queue working.`}
        </p>
      </SignalBlock>
    );
  }

  return (
    <SignalBlock
      name="queue"
      question="Is the notification queue draining?"
      verdict="backed-up"
      label={`${queued} queued`}
      tone="watch"
    >
      <p>
        {`${holding} waiting, ${QUEUE_BACKED_UP_AT_LABEL} or more, which reads as events arriving faster than they are handled rather than as work passing through.`}
      </p>
    </SignalBlock>
  );
}

/**
 * Is away mode on, and is the home held by a session?
 *
 * Two facts under one question, because the document carries them as one
 * signal: they are read from the same directory in the same pass and go dark
 * together, so drawing them as two blocks would only be able to say the same
 * failure twice. The wireframe asks them as two entries and they are drawn as
 * two entries - inside one block, whose single verdict is the one thing that
 * could honestly be said about both.
 *
 * Neither is a fault. This is the attendance question: away mode changes how
 * what the fleet raises reaches the operator, and a held home means another
 * session has the helm - both change what the operator should expect from
 * everything else on screen, which is why the strip asks them at all. Away is
 * drawn as something to look at rather than as a fault; a held home is the
 * ordinary state of a fleet with a session running and is drawn as a fact.
 *
 * What it does not say is whether the session holding the lock is still alive.
 * That is the fleet's own liveness policy, and the panel does not reimplement
 * it - see `docs/quality.md`.
 */
function Attendance({ signal }: { signal: AttendanceSignal }) {
  if (signal.read === "unreadable") {
    return (
      <SignalBlock
        name="attendance"
        question="Is away mode on, and is the home locked?"
        verdict="unreadable"
        label="Not read"
        tone="dark"
      >
        <Unread
          detail={signal.detail}
          unknown="Whether away mode is on, and whether a session holds the home, are both unknown; this is not a report of an operator present at a home nobody holds."
        />
      </SignalBlock>
    );
  }

  const { away, locked } = signal;
  const attendance = away ? "Away" : "Present";

  return (
    <SignalBlock
      name="attendance"
      question="Is away mode on, and is the home locked?"
      verdict={`${away ? "away" : "present"}${locked ? "-held" : ""}`}
      label={locked ? `${attendance} · home held` : attendance}
      tone={away ? "watch" : "good"}
    >
      {/*
        The two values keep `text-foreground` rather than taking the grammar's
        `--term-fg`: `tests/shipshape-lens.test.ts` pins the whole class string
        beside `data-fact`, and the two tokens are the same stop in dark and one
        rank apart in light, where the brighter one reads as emphasis on the
        value. Not worth editing an accepted test for.
      */}
      <dl className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <dt className="min-w-0 text-term-muted">away mode</dt>
          <dd data-fact="away" className="font-mono text-foreground">
            {away ? "on" : "off"}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <dt className="min-w-0 text-term-muted">home</dt>
          <dd data-fact="locked" className="font-mono text-foreground">
            {locked ? "held by a session" : "not held"}
          </dd>
        </div>
      </dl>
      <p>
        {away
          ? `Away mode is on, so what the fleet raises reaches the operator by another route than this page.`
          : `Away mode is off, so the fleet reaches the operator the usual way.`}
        {locked
          ? ` A lock is present, so a session holds the helm here; whether that session is still running is the fleet's own check and not this one.`
          : ` No lock is present, so no session holds the helm here.`}
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
        <p>
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
            className="flex flex-wrap items-baseline justify-between gap-x-3"
          >
            <span className="min-w-0 wrap-anywhere">{item.id}</span>
            <span className="text-term-muted">
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
        <p>
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
          <li key={disagreement.record} className="flex flex-col">
            <span className="wrap-anywhere">{disagreement.record}</span>
            <span className="wrap-anywhere text-term-muted">{disagreement.detail}</span>
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
        <p className="font-mono text-[13px] leading-[1.55] text-term-faint">
          {`Last good reading, taken ${ago(status.asOf, nowMs)}.`}
        </p>
      )}
      {status.state === "unreadable" && <Dark />}

      <div className="flex flex-col gap-3">
        <Supervisor signal={content.supervisor} nowMs={nowMs} />
        <Queue signal={content.queue} />
        <Attendance signal={content.attendance} />
        <OverdueWork signal={content.overdue} nowMs={nowMs} />
        <Drift signal={content.drift} />
      </div>
    </LensFrame>
  );
}
