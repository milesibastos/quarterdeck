import type { LandedItem, Lens } from "@/types/document.ts";
import { GrokEvent } from "@/ui/components/grok/grok-event";
import { inLandingOrder, sizeOf } from "@/ui/landed/landed-order";
import { LensFrame } from "@/ui/lens-frame";
import { ago } from "@/ui/lib/age";

/**
 * The landed lens: work that finished, including what a second mate landed in
 * its own home.
 *
 * ## Why it is here at all
 *
 * The panel used to show what is running, queued and held, and then forget work
 * the moment it landed. That is a board an operator cannot answer "what got
 * done" from without leaving it, and the answer is not decoration: it is how
 * they see that the thing they unblocked on Tuesday actually shipped.
 *
 * ## Why it is below the fold and drawn quietly
 *
 * Nothing here needs the operator. It is the one band on this page that is
 * purely a record, so it takes the ordinary `lens` prominence, sits under the
 * deck, and never draws an accent that could read as a call for attention. The
 * band that owns the first screen owns it precisely because everything else
 * yields; a landed band that competed would be taking back what
 * `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md` settled.
 *
 * That rule is what decides the grammar here. grok marks a finished thing with
 * a green `✓`, and the deck's rows carry a rail whose hue is the message. This
 * band takes neither: every row is the same resting box with the same faint
 * `◆`, because a wall of green ticks under the deck would be the loudest thing
 * on a page whose first screen is meant to own the operator's attention. The
 * marks are grok's; which of them a purely retrospective band is entitled to
 * use is this band's own judgement. See
 * `docs/decisions/2026-08-31-the-terminal-grammar.md`.
 *
 * ## Why every row says whose home it landed in
 *
 * Because prior boards lost a second mate's work entirely, and the failure mode
 * that produced is quieter than losing it: two homes' work merged into one
 * undifferentiated list, where the operator cannot tell whose fleet did what
 * and so cannot tell that a home is missing from it. The home is on the row,
 * from `where` and `home` on the record - never inferred from which list the
 * item arrived in, because by the time it reaches here there is only one list.
 *
 * What a home that could not be read costs is an entry in the disclosure bar,
 * not a row here. This band draws what arrived; the bar names what did not.
 */

/** The verb this build has no word of its own for, said in the operator's. */
const NOT_RECORDED = "not recorded";

/**
 * Whose home a piece of work landed in, in three or four words.
 *
 * The unnamed second-mate case gets words rather than a blank badge. Upstream
 * rolls a mate's work up without always stamping the home on it, and the
 * document keeps that as `null` rather than answering "here" - so the row says
 * the work is a mate's and that which mate was not recorded. A row that showed
 * only "landed elsewhere" would be true and useless; one that filled in this
 * home would be false.
 *
 * The bracket is grok's, and the two cases are told apart by rank rather than
 * by hue: a mate's home is the one worth noticing, so it takes ordinary text
 * where this home takes the timestamp rank.
 *
 * It carries the row's own indent so that when the card is too narrow to hold
 * the title and the home on one line, the home drops into the column the rest
 * of the row's detail already sits in rather than hanging out to the left of
 * everything above and below it.
 */
function Attribution({ item }: { item: LandedItem }) {
  const mate = item.where === "second-mate";
  return (
    <span
      data-landed-where={item.where}
      data-landed-home={item.home ?? ""}
      className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 pl-4"
    >
      <span className={mate ? "shrink-0 text-term-fg" : "shrink-0 text-term-faint"}>
        [{mate ? "a mate's home" : "this home"}]
      </span>
      {/* The home verbatim, as upstream wrote it. Shortening a path to its last
          segment is the picker's business, where the operator chose the fleet;
          here the whole thing is what tells two mates' homes apart. */}
      <span className="min-w-0 text-[12px] wrap-anywhere text-term-muted">
        {item.home ?? `home ${NOT_RECORDED}`}
      </span>
    </span>
  );
}

/**
 * One piece of finished work.
 *
 * The delivery artifact is the whole address and never a bare number - the same
 * rule the worker card's pull request follows, and for the same reason: which
 * repository and which number is what identifies it, and a link reading "pull
 * request" answers neither. Work that closed without one says so; it is an
 * ordinary shape here, because a scout's report and a locally delivered change
 * both land without a pull request.
 */
function LandedRow({ item }: { item: LandedItem }) {
  return (
    <li
      data-landed-item={item.id}
      className="flex min-w-0 flex-col gap-1 rounded-sm border border-term-rule-soft bg-term-bg px-3 py-2.5 font-mono text-[13px] leading-[1.55]"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex min-w-0 items-baseline gap-2 text-term-fg-bright">
          <span aria-hidden className="shrink-0 text-term-faint">
            ◆
          </span>
          <span className="min-w-0 wrap-anywhere">{item.title}</span>
        </p>
        <Attribution item={item} />
      </div>

      {/*
        How it closed and when, in upstream's own word and the record's own day.
        Both are independently absent and each says so in words rather than
        with a placeholder: a dash where a date belongs is read as a date that
        is somehow empty, and "reported" is worth showing verbatim even when it
        is a word this build has never seen.
      */}
      <p className="min-w-0 pl-4 text-[12px] wrap-anywhere text-term-faint">
        <span className={item.closedAs === null ? undefined : "text-term-fg"}>
          {item.closedAs ?? `closed, how ${NOT_RECORDED}`}
        </span>
        {" · "}
        {/*
          The day, and no age beside it. `landedOn` is a calendar date rather
          than an instant, so an age computed from it would be off by up to a
          day and would state a precision the record never had - and the ages
          elsewhere on this page are about whether the picture is current,
          which is not what a landing date is for.
        */}
        {item.landedOn === null ? (
          `landing date ${NOT_RECORDED}`
        ) : (
          <time dateTime={item.landedOn}>{item.landedOn}</time>
        )}
        {item.project !== null && (
          <>
            {" · "}
            <span className="text-term-fg">{item.project}</span>
          </>
        )}
        {` · ${item.id}`}
      </p>

      {item.pullRequest === null ? (
        <p data-landed-artifact="none" className="pl-4 text-[12px] text-term-muted">
          No pull request on the record.
        </p>
      ) : (
        <a
          data-landed-artifact="pull-request"
          href={item.pullRequest}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 pl-4 text-[12px] wrap-anywhere text-term-info underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
        >
          {item.pullRequest}
        </a>
      )}
    </li>
  );
}

/**
 * Nothing landed - and which kind of nothing it is.
 *
 * The same distinction every other band on this page draws, and it is sharper
 * here than most: an empty landed band reads as "nothing has shipped", which is
 * a statement about the fleet, and a band that could not be read must never be
 * allowed to make it.
 */
function NothingLanded({
  status,
  nowMs,
}: {
  status: Lens<unknown>["status"];
  nowMs: number;
}) {
  if (status.state === "unreadable") {
    return (
      <div data-landed-empty="unknown" className="min-w-0">
        <GrokEvent
          label={`Nothing to show: the read that carries landed work failed ${ago(status.observedAt, nowMs)}. Whether anything landed is unknown, not none.`}
        />
      </div>
    );
  }
  return (
    <div data-landed-empty="none" className="min-w-0">
      <GrokEvent label="Nothing has landed: the read carried no finished work, here or in a mate's home." />
    </div>
  );
}

export function LandedLens({
  lens,
  nowMs,
}: {
  lens: Lens<readonly LandedItem[]>;
  /** Chosen by the composition point, so every age on the page agrees. */
  nowMs: number;
}) {
  const items = inLandingOrder(lens.content);

  return (
    <LensFrame lens={lens} name="landed" title="Landed" summary={sizeOf(items)}>
      {lens.status.state === "stale" && (
        <GrokEvent
          label={`Current as of ${ago(lens.status.asOf, nowMs)}; anything that landed since is not here.`}
        />
      )}
      {/*
        Deliberately not the deck's "showing the last that read cleanly" line.
        This lens goes dark when upstream could not read the backlog, and what
        survives that is a second mate's work - rolled up separately, and as
        current as the read that produced it. Calling it a last-known-good
        picture would be a claim about its age that nothing established. The
        frame above already says what could not be read; this says only when.
      */}
      {lens.status.state === "unreadable" && items.length > 0 && (
        <GrokEvent
          label={`The read failed ${ago(lens.status.observedAt, nowMs)}; what follows is the part of it that still arrived.`}
        />
      )}

      {items.length === 0 ? (
        <NothingLanded status={lens.status} nowMs={nowMs} />
      ) : (
        <ul className="card-grid [--qd-card-min:26rem]">
          {items.map((item) => (
            <LandedRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </LensFrame>
  );
}
