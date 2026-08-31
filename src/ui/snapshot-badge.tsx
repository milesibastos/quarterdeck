import { ago } from "@/ui/lib/age";
import { cn } from "@/ui/lib/utils";
import {
  snapshotAge,
  SNAPSHOT_AGEING_AFTER_LABEL,
  SNAPSHOT_OLD_AFTER_LABEL,
  type SnapshotAge,
} from "@/ui/lib/snapshot-age";

/**
 * How old the picture is, said where it cannot be missed.
 *
 * Everything else on this page is drawn as though it were true now. It is not:
 * it is a snapshot, assembled at an instant, and the single most useful thing
 * the panel can tell an operator about to act on a card is how long ago that
 * instant was. So this is not a footnote in the corner - it is the second thing
 * in the masthead, it carries a colour, and it says its state in a word as well
 * as in a hue so it does not vanish for a reader who cannot separate the two.
 *
 * The three states and the two thresholds that divide them live in
 * `src/ui/lib/snapshot-age.ts`, once, beside the words this component says
 * about them.
 *
 * ## Why the rebuild command is part of the badge
 *
 * "This may no longer be true" is only half a message; the other half is what
 * to do about it. The command sits inside the badge rather than in a menu
 * because the moment an operator distrusts the age is the moment they need it,
 * and a panel that reports a problem it will not help with is a panel that gets
 * ignored.
 *
 * It arrives as a prop from the composition point, like the answering session:
 * `src/ui/` may not read the configuration or the adapters, which is what keeps
 * the panel replaceable. See `src/app/page.tsx`.
 */

/** How an operator makes a newer snapshot than the one on screen. */
export interface Rebuild {
  /** The command, verbatim, as it would be typed. Never an absolute path. */
  readonly command: string;
  /** Where to run it, named the way the operator names that fleet. */
  readonly where: string;
}

/**
 * The three states in words.
 *
 * Not decoration and not a duplicate of the colour: a badge whose only signal
 * is a hue says nothing at all to a reader who cannot tell gold from rust, and
 * this is the one element on the page that must reach every operator.
 */
const WORD: Readonly<Record<SnapshotAge, string>> = {
  current: "Current",
  ageing: "Ageing",
  old: "Old",
};

/**
 * What each state means for whether the page can be acted on, in one line.
 *
 * The thresholds are named rather than implied, so an operator can tell the
 * difference between a panel that is worried and a panel that has a rule.
 */
const MEANING: Readonly<Record<SnapshotAge, string>> = {
  current: `Taken inside the ${SNAPSHOT_AGEING_AFTER_LABEL} this panel calls current.`,
  ageing: `Older than ${SNAPSHOT_AGEING_AFTER_LABEL}. A worker may have moved since this was taken.`,
  old: `Older than ${SNAPSHOT_OLD_AFTER_LABEL}. This is a picture of the fleet, not the fleet.`,
};

/** Three tones, from the panel's own state vocabulary. Light and dark both. */
const TONE: Readonly<Record<SnapshotAge, string>> = {
  current: "border-online/50 bg-online/10 text-foreground",
  ageing: "border-warn/60 bg-warn/15 text-foreground",
  old: "border-danger/60 bg-danger/15 text-foreground",
};

const DOT: Readonly<Record<SnapshotAge, string>> = {
  current: "bg-online",
  ageing: "bg-warn",
  old: "bg-danger",
};

export function SnapshotBadge({
  asOf,
  nowMs,
  rebuild = null,
}: {
  /**
   * ISO-8601 instant the snapshot was taken, or `null` when it could not be
   * read at all.
   *
   * Not the instant the document was assembled: that is always a moment ago,
   * because assembling it is what serving this page does. What an operator
   * needs is how old the fleet's own reading is, and the two are only the same
   * number when everything is working.
   */
  asOf: string | null;
  /** Chosen by the composition point, so every age on the page agrees. */
  nowMs: number;
  /** `null` when nothing this panel knows of would produce a newer snapshot. */
  rebuild?: Rebuild | null;
}) {
  if (asOf === null) return <Unread rebuild={rebuild} />;
  const age = snapshotAge(asOf, nowMs);

  return (
    <div
      data-snapshot-age={age}
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-lg border px-3 py-2",
        TONE[age],
      )}
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-xs tracking-wide">
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", DOT[age])}
        />
        <span className="uppercase">{`Snapshot · ${ago(asOf, nowMs)}`}</span>
        <span data-snapshot-word className="font-medium uppercase">
          {WORD[age]}
        </span>
      </p>

      <p className="text-xs wrap-anywhere text-muted-foreground">
        {MEANING[age]}
      </p>

      <HowToRebuild rebuild={rebuild} />
    </div>
  );
}

/**
 * The snapshot could not be read, so it has no age.
 *
 * Not a fourth step on the same scale: an unknown age is not a long one, and
 * putting it on the scale would be the badge inventing the one number it exists
 * to report. It gets the loudest tone because it is the worst case - nothing on
 * the page below is dated at all - and the same command underneath, which is
 * the one thing still worth doing about it.
 */
function Unread({ rebuild }: { rebuild: Rebuild | null }) {
  return (
    <div
      data-snapshot-age="unread"
      className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-danger/60 bg-danger/15 px-3 py-2 text-foreground"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-xs tracking-wide">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-danger" />
        <span className="uppercase">Snapshot</span>
        <span data-snapshot-word className="font-medium uppercase">
          Could not be read
        </span>
      </p>

      <p className="text-xs wrap-anywhere text-muted-foreground">
        Nothing on this page is dated, because there is no reading to date it
        from.
      </p>

      <HowToRebuild rebuild={rebuild} />
    </div>
  );
}

/** What to do about the age, wherever the badge has just reported one. */
function HowToRebuild({ rebuild }: { rebuild: Rebuild | null }) {
  if (rebuild === null) {
    return (
      <p className="text-xs wrap-anywhere text-muted-foreground">
        No command here makes a newer one; the panel redraws when its source
        changes.
      </p>
    );
  }
  return (
    <p
      data-snapshot-rebuild
      className="font-mono text-[0.6875rem] wrap-anywhere text-muted-foreground"
    >
      {"rebuild: "}
      <code className="text-foreground">{rebuild.command}</code>
      {` in ${rebuild.where}`}
    </p>
  );
}
