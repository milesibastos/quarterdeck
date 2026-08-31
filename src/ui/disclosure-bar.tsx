import type { Lens, Omission, OmissionReason } from "@/types/document.ts";
import { GrokEvent } from "@/ui/components/grok/grok-event";
import { ago } from "@/ui/lib/age";

/**
 * The disclosure bar: everything the wireframe asks for that is not on this
 * page, and which of three reasons each absence has.
 *
 * ## Why it exists
 *
 * A panel that quietly omits things is worse than one that shows less. A prior
 * board undercounted open decisions - ten shown against sixteen real - and the
 * reason nobody noticed is that nothing on the page was responsible for saying
 * what was missing. This bar is that responsibility, given a place.
 *
 * ## Why it is derived and not written
 *
 * It reads `document.omissions` and renders it. It composes no sentence of its
 * own about what is missing, counts nothing itself, and has no list of features
 * to check against - because a bar somebody updates by hand is a bar that goes
 * stale silently, which is the exact failure it exists to prevent. The
 * projection knows both what upstream sent and what upstream said it could not
 * send, so the list is assembled there; see `src/domain/project.ts`.
 *
 * ## Why the three reasons are kept apart
 *
 * `not-shown` is a bound somebody chose. `not-looked-up` is work nobody has
 * done, which could still be done. `unreadable` is a read that was attempted
 * and failed. They call for three different responses from an operator - accept
 * it, ask for it, go and find out what broke - and a single apologetic sentence
 * covering all three would tell them to do nothing about any of it.
 *
 * ## Why an empty bar is still a bar
 *
 * A bar that disappears when nothing is missing is ambiguous with a bar that
 * was never built, and with a page that forgot to render it. So it says so
 * plainly instead - and only when it is entitled to, which is the subtlety
 * below.
 *
 * ## The grammar
 *
 * grok's, per `docs/decisions/2026-08-31-the-terminal-grammar.md`. The frame is
 * `grok-plan`'s box - a rule with the surface's name in its top edge - kept
 * dashed, because a box drawn around what is *not* here should not be the same
 * box the lenses draw around what is. Each absence sits behind the `┃` gutter
 * `grok-write` uses, which is the grammar's mark for a detail hanging off a
 * line above it, and every line the bar writes about itself is a `◆` event.
 */

/** The three reasons, in the order they are drawn. */
const ORDER: readonly OmissionReason[] = ["not-shown", "not-looked-up", "unreadable"];

/**
 * The operator's words for the three reasons.
 *
 * Each names what was done rather than how the panel feels about it. "Could not
 * be read" is the same phrase a dark lens carries in its header, deliberately:
 * one failure should not have two names on one page.
 */
const REASON: Readonly<Record<OmissionReason, string>> = {
  "not-shown": "Not shown",
  "not-looked-up": "Not looked up",
  unreadable: "Could not be read",
};

/** One line under each heading, saying what that reason means. */
const MEANING: Readonly<Record<OmissionReason, string>> = {
  "not-shown": "A bound was applied. It exists; this page is not drawing all of it.",
  "not-looked-up": "Nobody has asked. The read is available and has not been done.",
  unreadable: "A read was attempted and failed. What is there is unknown.",
};

/**
 * The count in the corner, which is a claim like any other.
 *
 * "Nothing omitted" is the one line here that can be false while every word
 * under it is true, so it is gated on the same read the empty state below is:
 * an empty list off a read that failed is not a page with nothing missing, it
 * is a page that does not know. A header saying one thing over a body saying
 * the other is worse than either, because a reader scanning the page takes the
 * short line and moves on.
 */
function tally(omissions: readonly Omission[], snapshot: Lens<unknown>["status"]): string {
  if (omissions.length > 0) {
    return `${omissions.length} ${omissions.length === 1 ? "absence" : "absences"}`;
  }
  return snapshot.state === "unreadable" ? "not accounted for" : "nothing omitted";
}

function Group({ reason, omissions }: { reason: OmissionReason; omissions: readonly Omission[] }) {
  if (omissions.length === 0) return null;
  return (
    <section
      data-omission-group={reason}
      className="flex min-w-0 flex-col gap-1 font-mono text-[13px] leading-[1.55]"
    >
      <h3 className="flex flex-wrap items-baseline gap-2 font-normal text-term-fg">
        <span aria-hidden className="shrink-0 text-term-dim">
          ◆
        </span>
        <span className="min-w-0">{REASON[reason]}</span>
        <span className="shrink-0 tabular-nums text-term-faint">[{omissions.length}]</span>
      </h3>
      <p className="pl-4 text-[12px] wrap-anywhere text-term-muted">{MEANING[reason]}</p>
      <ul className="mt-0.5 flex min-w-0 flex-col gap-1.5 pl-4">
        {omissions.map((omission) => (
          <li
            key={`${omission.reason}:${omission.what}`}
            data-omission-reason={omission.reason}
            className="min-w-0 border-l-2 border-term-rule pl-2.5"
          >
            <p className="min-w-0 wrap-anywhere text-term-fg">{omission.what}</p>
            {/* Upstream's own account of the absence, or the panel's own, as
                written. A paraphrase here would be the bar restating a fact it
                did not establish. */}
            <p className="min-w-0 text-[12px] wrap-anywhere text-term-faint">{omission.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What the bar says when it carries nothing - which is two different things.
 *
 * "Nothing is missing" is a claim, and it can only be made off a read that
 * happened. When the snapshot could not be read at all, the document's list of
 * omissions is empty for the worst possible reason: the read that would have
 * said what is missing is the read that failed, and the last good list is all
 * there ever was to carry forward. Announcing "nothing was left out" there
 * would be the page dropping an absence silently - precisely the failure this
 * bar was built to make impossible.
 *
 * The snapshot's own status arrives on the fleet lens, which is the one this
 * page never darkens on its own; see `snapshotAsOf` in `src/ui/shell.tsx`.
 */
function NothingOmitted({
  snapshot,
  nowMs,
}: {
  snapshot: Lens<unknown>["status"];
  nowMs: number;
}) {
  if (snapshot.state === "unreadable") {
    return (
      <div data-disclosure-empty="unknown" className="min-w-0">
        <GrokEvent
          label={`The read that would say what is missing is the read that failed, ${ago(snapshot.observedAt, nowMs)}. This page cannot account for what it is not showing.`}
        />
      </div>
    );
  }
  return (
    <div data-disclosure-empty="none" className="min-w-0">
      <GrokEvent label="Nothing is missing. Everything this page draws from was read, and every read was complete." />
    </div>
  );
}

export function DisclosureBar({
  omissions,
  snapshot,
  nowMs,
}: {
  /** The document's own account of what it does not carry. */
  omissions: readonly Omission[];
  /**
   * The status of the read the omissions were assembled from.
   *
   * Handed in rather than looked up, because the bar's one judgement is whether
   * it may say "nothing is missing" - and that is a claim about the read, not
   * about the list. See `NothingOmitted`.
   */
  snapshot: Lens<unknown>["status"];
  /** Chosen by the composition point, so every age on the page agrees. */
  nowMs: number;
}) {
  return (
    <section
      data-disclosure
      data-disclosure-count={omissions.length}
      aria-labelledby="disclosure-title"
      className="flex min-w-0 flex-col"
    >
      <div className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-dashed border-term-rule bg-term-bg">
        {/*
          The box's top edge carries the surface's name, which is the shape
          `grok-plan` frames a file in. The rule that runs into the heading is
          the grammar's; the words are the page's own.
        */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-dashed border-term-rule px-4 py-2 font-mono text-[13px]">
          <h2 id="disclosure-title" className="min-w-0 font-normal text-term-fg-bright">
            <span aria-hidden className="text-term-dim">
              {"─ "}
            </span>
            What is not on this page
          </h2>
          <p className="min-w-0 text-[12px] tracking-wide text-term-faint uppercase">
            {tally(omissions, snapshot)}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-3 px-4 py-3">
          {omissions.length === 0 ? (
            <NothingOmitted snapshot={snapshot} nowMs={nowMs} />
          ) : (
            <>
              {/* A list carried over from the last clean read is still the best
                  account there is, and it is still worth drawing - but it is an
                  account of a page other than this one, and saying so is the
                  same honesty the list itself is for. */}
              {snapshot.state === "unreadable" && (
                <GrokEvent
                  label={`The read failed ${ago(snapshot.observedAt, nowMs)}; this account is the last one that read cleanly, and absences raised since are not in it.`}
                />
              )}
              {/*
                As many columns as there are reasons to draw, and one of them per
                column on a wide screen. `auto-fit` rather than a fixed three:
                with one reason present a three-column track would leave two
                thirds of the bar empty, and an absence list padded out with
                whitespace reads as though something belongs there. Below the
                minimum it stacks, in the same order - a bound, then a read
                nobody did, then a read that failed.
              */}
              <div className="grid min-w-0 gap-x-6 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]">
                {ORDER.map((reason) => (
                  <Group
                    key={reason}
                    reason={reason}
                    omissions={omissions.filter((omission) => omission.reason === reason)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
