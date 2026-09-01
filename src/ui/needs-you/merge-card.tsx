"use client";

import { useState } from "react";
import type { Worker } from "@/types/document.ts";
import { ago } from "@/ui/lib/age";
import {
  ORDER_EXPLAINER,
  ORDER_RECORDED,
  ORDER_UNCONFIRMED,
} from "@/ui/needs-you/merge-copy";

/**
 * The card that orders a merge, and the second - and last - place the panel
 * writes.
 *
 * It merges nothing. Pressing the button records a durable merge order through
 * `src/adapters/intent.ts`, and the fleet performs the merge with
 * `bin/fm-pr-merge.sh`, the guarded command that owns every rule about when a
 * pull request may land: an unproven outcome, a merge queue, an unresolved
 * discussion, a head that moved. Every one of those refusals is that command's
 * and is reported as it wrote it. A panel that merged directly would be a
 * second authority beside it, and the guarantees behind that command would hold
 * for every channel except the one that skipped them.
 *
 * So the honest thing to say after a press is that the order was recorded -
 * never that anything merged. This page has not read the forge since, and will
 * not know until a later reading shows it. See
 * `docs/decisions/2026-08-31-ordering-a-merge.md`.
 *
 * ## Why the address is written out in full
 *
 * Because a number is not an address. `#302` is only a pull request once you
 * have decided which repository it is in, and the panel shows several projects
 * at once - so the card that carries the merge button is the last place a
 * reader should have to hold that context in their head. The full URL is what
 * the record carries and it is what the card shows, so the operator checks the
 * thing that is actually going to be acted on.
 *
 * ## Why the action is a button and not a chooser
 *
 * The decision card beside it offers two closes, which is a choice, and the
 * grammar's chooser draws it. This offers one act. A radiogroup of one row
 * would carry a hint line promising arrow keys that have nowhere to move, and a
 * legend that does not do what it says is the defect this project exists to
 * prevent. So it is the same bordered action button the frame already uses to
 * open its fleet chooser, without the bracketed key - there is no binding that
 * presses this from anywhere on the page, and a `[key]` that only works once
 * the button is focused would be claiming one.
 */

/** How the server is reached. Passed in: `src/ui/` may not read the runtime. */
export interface MergeSession {
  /** The header name the acting guard checks. */
  readonly header: string;
  /** The secret minted at start. Never leaves this origin; see the proxy's CSP. */
  readonly secret: string;
  readonly endpoint: string;
}

type Outcome =
  | { readonly state: "idle" }
  | { readonly state: "sending" }
  | { readonly state: "recorded"; readonly detail: string }
  | { readonly state: "refused"; readonly detail: string };

/**
 * What the checks said, beside the button that acts on them.
 *
 * Only one reading ever reaches this card - `isMergeReady` in
 * `src/ui/needs-you/needs-you.ts` admits nothing else - so this states that
 * reading rather than branching over readings that cannot arrive. The age is
 * here because it is the one thing that makes the count honest: six of six
 * passing as of four minutes ago is a different claim from six of six passing,
 * and the button is pressed against the older of the two.
 */
function ChecksLine({
  checks,
  nowMs,
}: {
  checks: {
    readonly finished: number;
    readonly total: number;
    readonly asOf: string;
  };
  nowMs: number;
}) {
  return (
    <p
      data-merge-checks="passing"
      className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]"
    >
      <span aria-hidden className="shrink-0 text-term-success">
        ◆
      </span>
      <span className="text-term-fg">
        {`${checks.finished} of ${checks.total} checks · passing`}
      </span>
      <span className="shrink-0 text-[12px] text-term-faint">
        {ago(checks.asOf, nowMs)}
      </span>
    </p>
  );
}

export function MergeCard({
  worker,
  nowMs,
  session,
}: {
  /** Merge-ready by `isMergeReady`; its pull request is non-null and passing. */
  worker: Worker;
  nowMs: number;
  /** `null` when nothing is configured to carry an order to the fleet. */
  session: MergeSession | null;
}) {
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const pullRequest = worker.pullRequest;
  // Never true for a card the band draws. Narrowing rather than asserting,
  // because a `!` here would be this file promising something the fold owns.
  if (pullRequest === null || pullRequest.checks.read !== "ok") return null;
  const { url, checks } = pullRequest;

  async function send() {
    if (session === null || outcome.state === "sending") return;
    setOutcome({ state: "sending" });
    try {
      const response = await fetch(session.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [session.header]: session.secret,
        },
        body: JSON.stringify({ taskId: worker.id, url }),
      });
      const body = (await response.json()) as {
        detail?: string;
        error?: string;
      };
      if (!response.ok) {
        setOutcome({
          state: "refused",
          detail:
            body.error ?? `The panel refused the order (${response.status}).`,
        });
        return;
      }
      setOutcome({
        state: "recorded",
        detail: body.detail ?? "The merge order was recorded.",
      });
    } catch (error) {
      // The request may or may not have arrived. Saying so is the only honest
      // report, and re-pressing is safe: the identity is the same either way.
      setOutcome({
        state: "refused",
        detail: `The order could not be sent (${(error as Error).message}). Nothing here can tell whether it arrived; pressing again is safe.`,
      });
    }
  }

  return (
    /* The band's other group is drawn by `DecisionCard`, and this matches its
       gutter deliberately: a decision and a ready pull request are two kinds of
       the same thing - work waiting on this person - and drawing them as two
       different objects would say otherwise. The rule is green rather than the
       decision's accent because that is the fact this card turns on: somebody
       read the checks and they passed. */
    <li
      data-merge-card={worker.id}
      className="min-w-0 space-y-1.5 border-l-2 border-term-success pl-3 font-mono text-[13px] leading-[1.55]"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="min-w-0 wrap-anywhere text-[13px] font-semibold text-term-fg-bright">
          {worker.project}
        </h3>
        <span className="text-[12px] text-term-faint">{worker.id}</span>
      </div>
      {/* The full address, wrapping rather than truncating. A pull request
          address cut off in the middle is the one thing on this card that
          would be worse than not showing it at all: a truncated address still
          looks like an address, and the reader would check the wrong one. */}
      <p className="text-[12px] wrap-anywhere text-term-info">{url}</p>
      <ChecksLine checks={checks} nowMs={nowMs} />

      {outcome.state === "recorded" ? (
        <div
          role="status"
          data-merge-ordered={worker.id}
          className="space-y-0.5"
        >
          {/* Exactly what is true, and not one word past it. The fleet has not
              been asked yet, and this panel has read nothing since. */}
          <p className="text-[13px] wrap-anywhere text-term-fg">
            {`${outcome.detail} ${ORDER_RECORDED}`}
          </p>
          <p className="text-[12px] text-term-faint">{ORDER_UNCONFIRMED}</p>
        </div>
      ) : session === null ? (
        <p
          data-merge-unavailable={worker.id}
          className="text-[12px] text-term-faint"
        >
          Nothing is configured for this panel to record an order in, so a merge
          cannot be ordered here.
        </p>
      ) : (
        <div className="space-y-1.5">
          <button
            type="button"
            data-merge-order={worker.id}
            disabled={outcome.state === "sending"}
            title="records an order for the fleet to merge this pull request"
            onClick={() => void send()}
            className="rounded-sm border border-term-rule-soft px-2 py-0.5 text-[12px] text-term-fg outline-none hover:bg-term-selected hover:text-term-fg-bright focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            Order the merge
          </button>
          {/* What the press actually does, spelled out rather than left to a
              tooltip. A button whose label is a verb has to say who performs
              it, and here the answer is not this page. */}
          <p className="text-[12px] text-term-faint">{ORDER_EXPLAINER}</p>
          {/* An alert, not a status: a refusal is the one outcome here where
              the operator has to do something, and it lands while their
              attention is on the button they just pressed. */}
          {outcome.state === "refused" && (
            <p
              role="alert"
              className="text-[13px] wrap-anywhere text-term-danger"
            >
              {outcome.detail}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
