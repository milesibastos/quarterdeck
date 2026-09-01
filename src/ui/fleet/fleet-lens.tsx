import type { Lens, Worker } from "@/types/document.ts";
import { WorkerCard } from "@/ui/fleet/worker-card";
import type { TerminalReader } from "@/ui/fleet/worker-terminal";
import { LensFrame } from "@/ui/lens-frame";
import { ago } from "@/ui/lib/age";

/**
 * The fleet lens: what is running.
 *
 * Drawn under the operator's word for it, `Underway`, while keeping `fleet` as
 * its handle in the markup and in the document. The band sits directly under
 * the one that owns the first screen and is meant to peek rather than compete:
 * its header and the top of its first row of cards are above the fold, which is
 * how an operator knows there is more page without any of it being spent on
 * work the fleet is handling by itself. The proportions are in
 * `src/ui/shell.tsx`.
 *
 * Three shapes, and the document already distinguishes them, so this invents no
 * global notion of "broken": content with a clean read is the fleet; content
 * with a stale or unreadable read is the last good picture, labelled with how
 * old it is; no content at all is either a definitive empty fleet or a lens
 * that could not be read, and those are two different sentences.
 *
 * One gap worth naming rather than papering over, and it is now upstream's
 * rather than the document's. `Lifecycle` carries `lastActiveStage`, the stage
 * a worker was in before it stopped, and a stop that has one is placed on its
 * rail whatever shape that rail is. No fleet fills it: a live snapshot's
 * `current_state` carries six keys and none of them is a prior stage, and
 * firstmate has no vocabulary for one to publish - so on a live fleet every
 * stop still falls back to the older deduction from the pipeline step, and a
 * stop that rail cannot place says its position is not known rather than
 * guessing one. See `docs/decisions/2026-09-01-the-stage-a-stop-happened-in.md`
 * for what was checked and how.
 */

/** Nothing running. `stale` means that is only what the last good read found. */
function EmptyFleet({ stale }: { stale: boolean }) {
  return (
    <div className="rounded-sm border border-dashed border-term-rule px-4 py-8 text-center font-mono">
      <p className="text-[13px] text-term-fg-bright">No workers under way</p>
      <p className="mt-1 text-xs text-term-muted">
        {stale
          ? "The last good read reported nothing running."
          : "The fleet read cleanly and reported nothing running."}
      </p>
    </div>
  );
}

/** Nothing running, and the document does not know whether that is true. */
function NothingToShow() {
  return (
    <div className="rounded-sm border border-dashed border-term-danger/40 px-4 py-8 text-center font-mono">
      <p className="text-[13px] text-term-fg-bright">Nothing to show</p>
      <p className="mt-1 text-xs text-term-muted">
        The fleet could not be read, and the panel has no earlier picture of it.
      </p>
    </div>
  );
}

/**
 * How many workers, for the pinned header.
 *
 * A count and nothing else. Whether a fleet of thirty is healthy is the lens's
 * question and it has the room below to answer it properly; what the header has
 * to say is only whether the rows on screen are all of them. `null` at zero,
 * because the empty state below already says it in a whole sentence.
 */
function sizeOf(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? "1 worker" : `${count} workers`;
}

/**
 * How old the picture on screen is, when it is not current.
 *
 * The frame above already says which policy was breached; what it cannot say is
 * how far behind the content is, and that is the number that decides whether an
 * operator trusts what they are looking at.
 *
 * The two phrasings are not interchangeable. A stale read knows when its
 * content was taken; an unreadable one knows only when the panel noticed the
 * read fail, and dating the content from that would be a small lie about it.
 */
function LastGoodPicture({
  status,
  nowMs,
}: {
  status: Exclude<Lens<unknown>["status"], { state: "fresh" }>;
  nowMs: number;
}) {
  return (
    <p className="font-mono text-xs text-term-muted">
      {status.state === "stale"
        ? `Last good picture, taken ${ago(status.asOf, nowMs)}.`
        : `Last good picture, still on screen; the read failed ${ago(status.observedAt, nowMs)}.`}
    </p>
  );
}

export function FleetLens({
  lens,
  nowMs,
  terminal,
}: {
  lens: Lens<readonly Worker[]>;
  /** Chosen by the composition point, so the ages agree with the projection. */
  nowMs: number;
  /** How a card reads its worker's session once the operator opens it. */
  terminal: TerminalReader;
}) {
  const workers = lens.content;
  const { status } = lens;

  return (
    <LensFrame
      lens={lens}
      name="fleet"
      title="Underway"
      summary={sizeOf(workers.length)}
    >
      {(status.state === "stale" ||
        (workers.length > 0 && status.state === "unreadable")) && (
        <LastGoodPicture status={status} nowMs={nowMs} />
      )}

      {workers.length === 0 ? (
        status.state === "unreadable" ? (
          <NothingToShow />
        ) : (
          <EmptyFleet stale={status.state === "stale"} />
        )
      ) : (
        <ul className="card-grid [--qd-card-min:22rem]">
          {workers.map((worker) => (
            <li key={worker.id} className="min-w-0">
              <WorkerCard worker={worker} nowMs={nowMs} terminal={terminal} />
            </li>
          ))}
        </ul>
      )}
    </LensFrame>
  );
}
