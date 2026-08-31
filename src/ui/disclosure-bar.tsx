import type { Lens, Omission, OmissionReason } from "@/types/document.ts";
import { Card } from "@/ui/components/card";
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
    <section data-omission-group={reason} className="flex min-w-0 flex-col gap-1">
      <h3 className="font-display text-sm tracking-wide text-foreground">
        {REASON[reason]}
        <span className="ml-2 font-mono text-[0.6875rem] tracking-wide text-muted-foreground uppercase">
          {omissions.length}
        </span>
      </h3>
      <p className="text-xs text-muted-foreground">{MEANING[reason]}</p>
      <ul className="mt-0.5 flex min-w-0 flex-col gap-1.5">
        {omissions.map((omission) => (
          <li
            key={`${omission.reason}:${omission.what}`}
            data-omission-reason={omission.reason}
            className="min-w-0 border-l-2 border-border pl-2.5"
          >
            <p className="min-w-0 wrap-anywhere text-sm text-foreground">{omission.what}</p>
            {/* Upstream's own account of the absence, or the panel's own, as
                written. A paraphrase here would be the bar restating a fact it
                did not establish. */}
            <p className="min-w-0 wrap-anywhere text-xs text-muted-foreground">{omission.detail}</p>
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
      <p data-disclosure-empty="unknown" className="text-sm wrap-anywhere text-foreground">
        {`The read that would say what is missing is the read that failed, ${ago(snapshot.observedAt, nowMs)}. This page cannot account for what it is not showing.`}
      </p>
    );
  }
  return (
    <p data-disclosure-empty="none" className="text-sm text-foreground">
      Nothing is missing. Everything this page draws from was read, and every read was
      complete.
    </p>
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
      <Card className="flex min-w-0 flex-col gap-3 border-dashed px-4 py-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2
            id="disclosure-title"
            className="font-display text-lg tracking-wide text-foreground"
          >
            What is not on this page
          </h2>
          <p className="font-mono text-[0.6875rem] tracking-wide text-muted-foreground uppercase">
            {tally(omissions, snapshot)}
          </p>
        </div>

        {omissions.length === 0 ? (
          <NothingOmitted snapshot={snapshot} nowMs={nowMs} />
        ) : (
          <>
            {/* A list carried over from the last clean read is still the best
                account there is, and it is still worth drawing - but it is an
                account of a page other than this one, and saying so is the
                same honesty the list itself is for. */}
            {snapshot.state === "unreadable" && (
              <p className="font-mono text-[0.6875rem] wrap-anywhere text-muted-foreground">
                {`The read failed ${ago(snapshot.observedAt, nowMs)}; this account is the last one that read cleanly, and absences raised since are not in it.`}
              </p>
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
      </Card>
    </section>
  );
}
