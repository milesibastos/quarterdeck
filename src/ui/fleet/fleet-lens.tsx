import type { Lens, Worker } from "@/types/document.ts";
import { WorkerCard } from "@/ui/fleet/worker-card";
import { LensFrame } from "@/ui/lens-frame";
import { ago } from "@/ui/lib/age";

/**
 * The fleet lens: what is running.
 *
 * Three shapes, and the document already distinguishes them, so this invents no
 * global notion of "broken": content with a clean read is the fleet; content
 * with a stale or unreadable read is the last good picture, labelled with how
 * old it is; no content at all is either a definitive empty fleet or a lens
 * that could not be read, and those are two different sentences.
 *
 * One gap worth naming rather than papering over: `Lifecycle` carries the stage
 * a worker is in but not the stage it was in before it stopped. A halted worker
 * that names a pipeline step was validating - the steps only run there - but a
 * worker blocked or waiting names none, and the rail leaves its position blank
 * rather than guessing. A `lastActiveStage` on `Lifecycle` would close it.
 */

/** Nothing running. `stale` means that is only what the last good read found. */
function EmptyFleet({ stale }: { stale: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm font-medium text-foreground">No workers under way</p>
      <p className="mt-1 text-xs text-muted-foreground">
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
    <div className="rounded-lg border border-dashed border-danger/40 px-4 py-8 text-center">
      <p className="text-sm font-medium text-foreground">Nothing to show</p>
      <p className="mt-1 text-xs text-muted-foreground">
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
    <p className="text-xs text-muted-foreground">
      {status.state === "stale"
        ? `Last good picture, taken ${ago(status.asOf, nowMs)}.`
        : `Last good picture, still on screen; the read failed ${ago(status.observedAt, nowMs)}.`}
    </p>
  );
}

export function FleetLens({
  lens,
  nowMs,
}: {
  lens: Lens<readonly Worker[]>;
  /** Chosen by the composition point, so the ages agree with the projection. */
  nowMs: number;
}) {
  const workers = lens.content;
  const { status } = lens;

  return (
    <LensFrame lens={lens} name="fleet" title="Fleet" summary={sizeOf(workers.length)}>
      {(status.state === "stale" || (workers.length > 0 && status.state === "unreadable")) && (
        <LastGoodPicture status={status} nowMs={nowMs} />
      )}

      {workers.length === 0 ? (
        status.state === "unreadable" ? (
          <NothingToShow />
        ) : (
          <EmptyFleet stale={status.state === "stale"} />
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {workers.map((worker) => (
            <li key={worker.id}>
              <WorkerCard worker={worker} nowMs={nowMs} />
            </li>
          ))}
        </ul>
      )}
    </LensFrame>
  );
}
