"use client";

import { useId, useState } from "react";
import { GrokProjectPicker } from "@/ui/components/grok/grok-project-picker";
import type { AnsweringSession } from "@/ui/deck/answer-control";

/**
 * The control that answers a held decision, in the terminal grammar.
 *
 * It executes nothing. It posts what the operator typed and which close they
 * chose, and the server records that as a durable intent the fleet picks up on
 * its next check. So the honest thing to say afterwards is that the answer was
 * recorded - never that the decision is closed, because this page has not read
 * anything since, and will not know until the next reading shows it. See
 * `docs/decisions/2026-08-30-answering-a-held-decision.md`, which this reskin
 * leaves untouched.
 *
 * The two closes are the whole design. The fleet's answer intake takes a close
 * mode, and a channel is forbidden from choosing one for itself: it may only
 * carry what its card declared. So the card declares both, in the operator's
 * words, and the choice is the declaration. Deriving the mode from whether the
 * item is queued or in flight would be this panel guessing at fleet semantics
 * from a distance, which is the failure the contract names.
 *
 * ## Why this lives beside the band rather than in the deck
 *
 * The deck draws no answerable item - the band above it takes every one of them
 * - so this control only ever appears here. It is the same request in the same
 * shape as `src/ui/deck/answer-control.tsx`, whose `AnsweringSession` it still
 * takes, because the composition point hands one address to both bands.
 *
 * ## Why the closes are a radiogroup and the answer is not a composer
 *
 * `GrokProjectPicker` is grok's chooser: numbered `(●)` / `(○)` rows, real
 * arrow keys, and a hint line that names only the two keys it implements. It is
 * the honest half of the family's two approval cards - `GrokPermission`'s
 * footer hard-codes `Ctrl+o:yolo` and `Ctrl+c:cancel`, which it does not
 * implement, and a legend that promises what the surface does not do is the
 * defect this project exists to prevent. That component wants the same
 * legend-as-prop treatment `GrokShortcuts` already got; until it has one, the
 * chooser is the component that fits.
 *
 * `GrokPrompt` is the grammar's text box and is deliberately not used: it is a
 * single-line `<input>`, and an answer recorded verbatim in the operator's own
 * words has to be able to run to more than one line. The box below wears the
 * composer's chrome - a `❯` caret, a soft rule, the muted legend on the bottom
 * edge - over a `<textarea>`, so nothing accepted before this reskin got
 * smaller. See `docs/decisions/2026-08-31-the-needs-you-band-in-the-grammar.md`.
 */

/**
 * The two closes the fleet offers, in the operator's words.
 *
 * `label` is what the card declared and what is carried into the record, so the
 * fleet's durable decision can say what was on screen and not only what was
 * typed. `note` is the consequence, said plainly, because the difference
 * between them is the one thing a hurried reader must not get wrong.
 */
const CLOSES = [
  {
    mode: "done",
    label: "Answer and close",
    note: "records the answer and completes this item",
  },
  {
    mode: "release",
    label: "Answer and resume",
    note: "records the answer and lifts the hold so the work resumes",
  },
] as const;

type Outcome =
  | { readonly state: "idle" }
  | { readonly state: "sending" }
  | { readonly state: "recorded"; readonly detail: string }
  | { readonly state: "refused"; readonly detail: string };

/** Said when a close is chosen over an empty box, rather than nothing at all. */
const NOTHING_TYPED = "Type an answer first - nothing was sent.";

export function AnswerControl({
  taskId,
  since,
  session,
}: {
  taskId: string;
  /**
   * Part of the request identity: a re-held task is a new question.
   *
   * The empty string is how "the row recorded no start date" is carried, and it
   * is unambiguous - upstream's prose reader never yields an empty `since`, and
   * the digest is length-prefixed. It is also a stable name, where the moment
   * upstream looked was not: an item with no start date used to mint a fresh
   * request id on every read, which quietly cost it its replay protection.
   */
  since: string;
  /** `null` when nothing is configured to carry an answer to the fleet. */
  session: AnsweringSession | null;
}) {
  const fieldId = useId();
  const [answer, setAnswer] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });

  if (session === null) {
    return (
      <p
        data-answer-unavailable={taskId}
        className="mt-2 font-mono text-[12px] text-term-faint"
      >
        No answer spool is configured, so this decision cannot be answered here.
      </p>
    );
  }

  async function send(mode: string, label: string) {
    if (session === null || outcome.state === "sending") return;
    // A chosen close over an empty box used to be a disabled button. The rows of
    // a radiogroup cannot be disabled one at a time, so the refusal is said out
    // loud instead - a control that silently does nothing is the same broken
    // promise as a key hint that does nothing.
    if (answer.trim() === "") {
      setOutcome({ state: "refused", detail: NOTHING_TYPED });
      return;
    }
    setOutcome({ state: "sending" });
    try {
      const response = await fetch(session.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [session.header]: session.secret,
        },
        body: JSON.stringify({ taskId, since, answer, label, mode }),
      });
      const body = (await response.json()) as { detail?: string; error?: string };
      if (!response.ok) {
        setOutcome({
          state: "refused",
          detail: body.error ?? `The panel refused the answer (${response.status}).`,
        });
        return;
      }
      setOutcome({ state: "recorded", detail: body.detail ?? "The answer was recorded." });
    } catch (error) {
      // The request may or may not have arrived. Saying so is the only honest
      // report, and re-pressing is safe: the identity is the same either way.
      setOutcome({
        state: "refused",
        detail: `The answer could not be sent (${(error as Error).message}). Nothing here can tell whether it arrived; pressing again is safe.`,
      });
    }
  }

  if (outcome.state === "recorded") {
    return (
      <div role="status" data-answered={taskId} className="mt-2 space-y-0.5">
        {/* Exactly what is true, and not one word past it. The fleet has not
            been asked yet, and this panel has read nothing since. */}
        <p className="text-[13px] wrap-anywhere text-term-fg">
          {outcome.detail} The fleet will act on it at its next check.
        </p>
        <p className="text-[12px] text-term-faint">
          This panel cannot say the decision is closed until a later reading shows it.
        </p>
      </div>
    );
  }

  const sending = outcome.state === "sending";

  return (
    <div data-answer-control={taskId} className="mt-2 space-y-2 font-mono">
      <label htmlFor={fieldId} className="block text-[12px] tracking-wide text-term-muted">
        Your answer
      </label>
      {/* The composer's chrome over a box that can hold more than one line:
          a caret, a soft rule, and the legend punched into the bottom edge
          saying what becomes of the text. See the note at the top of the file
          for why `GrokPrompt` itself is not used here. */}
      <div className="relative min-w-0 rounded-sm border border-term-rule-soft bg-term-bg px-2 py-1.5">
        <div className="flex min-w-0 items-start gap-0">
          <span aria-hidden className="shrink-0 leading-6 text-term-fg">
            ❯
          </span>
          <textarea
            id={fieldId}
            rows={2}
            value={answer}
            disabled={sending}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="In your own words."
            className="min-w-0 flex-1 resize-y bg-transparent pl-[1ch] text-[13px] leading-6 text-term-fg outline-none placeholder:text-term-faint disabled:opacity-50"
          />
        </div>
        {/* The legend punched into the bottom edge, as the grammar's composer
            draws it - on the left rather than the right, because a box that can
            be dragged taller puts its resize grip in the other corner and two
            things in one corner is one of them unreadable. */}
        <span className="absolute -bottom-2.5 left-2 max-w-[calc(100%-1rem)] truncate bg-term-bg px-1 text-[12px] text-term-faint">
          recorded verbatim
        </span>
      </div>

      {/*
        The two closes, as the grammar's chooser. Choosing one sends it, which
        is what the hint line under it says and what the two buttons it replaced
        did. Arrow keys move the selection without sending; only Enter, space or
        a click does.
      */}
      <GrokProjectPicker
        className="pt-1.5"
        title="Close this how?"
        description={null}
        custom={false}
        projects={CLOSES.map((close) => ({
          id: close.mode,
          name: close.label,
          data: { "data-close-mode": close.mode },
        }))}
        onChoose={(index) => {
          if (index === "custom") return;
          const close = CLOSES[index];
          void send(close.mode, close.label);
        }}
      />

      {/* The consequence of each close, spelled out rather than left to a
          tooltip: a pointer is not available to every reader, and choosing the
          wrong close is the one mistake here that is awkward to undo. */}
      <ul className="space-y-0.5 text-[12px] text-term-faint">
        {CLOSES.map((close) => (
          <li key={close.mode}>{`${close.label} — ${close.note}.`}</li>
        ))}
      </ul>

      {sending && (
        <p role="status" className="text-[12px] text-term-muted">
          Sending the answer…
        </p>
      )}

      {/* An alert, not a status: a refusal is the one outcome here where the
          operator has to do something, and it lands while their attention is
          on the row they just chose. */}
      {outcome.state === "refused" && (
        <p role="alert" className="text-[13px] wrap-anywhere text-term-danger">
          {outcome.detail}
        </p>
      )}
    </div>
  );
}
