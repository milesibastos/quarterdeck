import type { LandedItem, Lens } from "@/types/document.ts";
import { Badge } from "@/ui/components/badge";
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
 */
function Attribution({ item }: { item: LandedItem }) {
  const mate = item.where === "second-mate";
  return (
    <span
      data-landed-where={item.where}
      data-landed-home={item.home ?? ""}
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"
    >
      <Badge variant={mate ? "secondary" : "outline"} className="shrink-0">
        {mate ? "a mate's home" : "this home"}
      </Badge>
      {/* The home verbatim, as upstream wrote it. Shortening a path to its last
          segment is the picker's business, where the operator chose the fleet;
          here the whole thing is what tells two mates' homes apart. */}
      <span className="min-w-0 font-mono text-[0.6875rem] wrap-anywhere text-muted-foreground">
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
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 wrap-anywhere text-sm font-medium text-foreground">{item.title}</p>
        <Attribution item={item} />
      </div>

      {/*
        How it closed and when, in upstream's own word and the record's own day.
        Both are independently absent and each says so in words rather than
        with a placeholder: a dash where a date belongs is read as a date that
        is somehow empty, and "reported" is worth showing verbatim even when it
        is a word this build has never seen.
      */}
      <p className="min-w-0 font-mono text-[0.6875rem] wrap-anywhere text-muted-foreground">
        <span className={item.closedAs === null ? undefined : "text-foreground"}>
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
            <span className="text-foreground">{item.project}</span>
          </>
        )}
        {` · ${item.id}`}
      </p>

      {item.pullRequest === null ? (
        <p data-landed-artifact="none" className="text-xs text-muted-foreground">
          No pull request on the record.
        </p>
      ) : (
        <a
          data-landed-artifact="pull-request"
          href={item.pullRequest}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 font-mono text-xs wrap-anywhere text-info underline-offset-2 hover:underline"
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
      <p data-landed-empty="unknown" className="text-sm wrap-anywhere text-muted-foreground">
        {`Nothing to show: the read that carries landed work failed ${ago(status.observedAt, nowMs)}. Whether anything landed is unknown, not none.`}
      </p>
    );
  }
  return (
    <p data-landed-empty="none" className="text-sm text-muted-foreground">
      {"Nothing has landed: the read carried no finished work, here or in a mate's home."}
    </p>
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
        <p className="font-mono text-[0.6875rem] text-muted-foreground">
          {`Current as of ${ago(lens.status.asOf, nowMs)}; anything that landed since is not here.`}
        </p>
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
        <p className="font-mono text-[0.6875rem] text-muted-foreground">
          {`The read failed ${ago(lens.status.observedAt, nowMs)}; what follows is the part of it that still arrived.`}
        </p>
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
