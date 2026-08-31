"use client";

import { useId, useState } from "react";
import { Button } from "@/ui/components/button";

/**
 * The control that answers a held decision, and the only place the panel writes.
 *
 * It executes nothing. It posts what the operator typed and which button they
 * pressed, and the server records that as a durable intent the fleet picks up on
 * its next check. So the honest thing to say afterwards is that the answer was
 * recorded - never that the decision is closed, because this page has not read
 * anything since, and will not know until the next reading shows it.
 *
 * The two buttons are the whole design. The fleet's answer intake takes a close
 * mode, and a channel is forbidden from choosing one for itself: it may only
 * carry what its card declared. So the card declares both, in the operator's
 * words, and the press is the declaration. Deriving the mode from whether the
 * item is queued or in flight would be this panel guessing at fleet semantics
 * from a distance, which is the failure the contract names.
 */

/** How the server is reached. Passed in: `src/ui/` may not read the runtime. */
export interface AnsweringSession {
  /** The header name the acting guard checks. */
  readonly header: string;
  /** The secret minted at start. Never leaves this origin; see the proxy's CSP. */
  readonly secret: string;
  readonly endpoint: string;
}

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
    variant: "default",
  },
  {
    mode: "release",
    label: "Answer and resume",
    note: "records the answer and lifts the hold so the work resumes",
    variant: "outline",
  },
] as const;

type Outcome =
  | { readonly state: "idle" }
  | { readonly state: "sending" }
  | { readonly state: "recorded"; readonly detail: string }
  | { readonly state: "refused"; readonly detail: string };

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
        className="mt-2 font-mono text-[0.6875rem] text-muted-foreground"
      >
        No answer spool is configured, so this decision cannot be answered here.
      </p>
    );
  }

  async function send(mode: string, label: string) {
    if (session === null || answer.trim() === "") return;
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
      <div data-answered={taskId} className="mt-2 space-y-0.5">
        {/* Exactly what is true, and not one word past it. The fleet has not
            been asked yet, and this panel has read nothing since. */}
        <p className="text-sm text-foreground">
          {outcome.detail} The fleet will act on it at its next check.
        </p>
        <p className="font-mono text-[0.6875rem] text-muted-foreground">
          This panel cannot say the decision is closed until a later reading shows it.
        </p>
      </div>
    );
  }

  const sending = outcome.state === "sending";
  const empty = answer.trim() === "";

  return (
    <div data-answer-control={taskId} className="mt-2 space-y-1.5">
      <label htmlFor={fieldId} className="block text-xs tracking-wide text-muted-foreground uppercase">
        Your answer
      </label>
      <textarea
        id={fieldId}
        rows={2}
        value={answer}
        disabled={sending}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder="In your own words. Recorded verbatim."
        className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      {/* Wraps rather than crowds: at a narrow width the two closes stack, and
          each keeps the line that says what it does. */}
      <div className="flex flex-wrap gap-1.5">
        {CLOSES.map((close) => (
          <Button
            key={close.mode}
            size="xs"
            variant={close.variant}
            disabled={sending || empty}
            data-close-mode={close.mode}
            title={close.note}
            onClick={() => void send(close.mode, close.label)}
          >
            {close.label}
          </Button>
        ))}
      </div>
      {/* The consequence of each close, spelled out rather than left to a
          tooltip: a pointer is not available to every reader, and choosing the
          wrong close is the one mistake here that is awkward to undo. */}
      <ul className="space-y-0.5 font-mono text-[0.6875rem] text-muted-foreground">
        {CLOSES.map((close) => (
          <li key={close.mode}>{`${close.label} — ${close.note}.`}</li>
        ))}
      </ul>
      {outcome.state === "refused" && (
        <p className="text-sm text-destructive">{outcome.detail}</p>
      )}
    </div>
  );
}
