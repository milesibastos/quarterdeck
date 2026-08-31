import type { PanelDocument } from "@/types/document.ts";
import type { AnsweringSession } from "@/ui/deck/answer-control";
import { DeckLens } from "@/ui/deck/deck-lens";
import { FleetLens } from "@/ui/fleet/fleet-lens";
import { ago } from "@/ui/lib/age";
import { ShipshapeLens } from "@/ui/shipshape/shipshape-lens";

/**
 * The panel shell: the envelope, and the three lenses side by side.
 *
 * ## The proportions
 *
 * Three equal columns, and deliberately equal. The panel asks three questions -
 * what is happening, what is coming, can I trust this - and none of them is a
 * subordinate of another: an operator who cannot see the third has no reason to
 * believe the first two. Weighting the fleet column because it usually holds
 * the most rows would make the panel's shape a function of how busy the fleet
 * is, which is the one thing it must not be.
 *
 * ## The fold
 *
 * At `md` and up the shell is exactly one viewport tall and does not scroll.
 * Each column scrolls inside itself under a pinned header, so the answer to all
 * three questions is on screen at a fleet of two and at a fleet of thirty, and
 * the difference between them shows up as a scrollbar rather than as shipshape
 * disappearing off the bottom of the page. Below `md` there is one column and
 * the page scrolls as a page. The reasoning, and what was tried instead, is in
 * `docs/decisions/2026-08-31-the-fold-line.md`.
 *
 * This component - and everything under `src/ui/` - can only see the document.
 * It cannot read a fleet, so it cannot grow a "just fetch this one extra field"
 * shortcut, and the whole panel stays replaceable.
 */
export function Shell({
  document,
  nowMs,
  session = null,
}: {
  document: PanelDocument;
  /** Chosen by the composition point, so the ages agree with the projection. */
  nowMs: number;
  /**
   * How an answer reaches the server, for the deck's answerable items.
   *
   * The one thing on this page that is not the document. It has to come from
   * the composition point: `src/ui/` cannot read the runtime, which is what
   * keeps the panel replaceable, and the secret lives in the runtime.
   */
  session?: AnsweringSession | null;
}) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-4 pb-6 sm:px-6 md:min-h-0 md:flex-1 md:pb-4">
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="font-display text-2xl tracking-wide text-foreground sm:text-3xl">
          Quarterdeck
        </h1>
        <p className="font-mono text-xs text-muted-foreground">
          document v{document.version} &middot; assembled{" "}
          {ago(document.generatedAt, nowMs)}
        </p>
      </header>

      <div className="grid gap-4 md:min-h-0 md:flex-1 md:grid-cols-3">
        <FleetLens lens={document.fleet} nowMs={nowMs} />
        {/* The deck is handed the fleet's work items as a directory: a blocker
            arrives as a bare identity, and the work it names has usually
            already started. */}
        <DeckLens
          lens={document.deck}
          fleet={document.fleet.content}
          nowMs={nowMs}
          session={session}
        />
        <ShipshapeLens lens={document.health} nowMs={nowMs} />
      </div>
    </main>
  );
}
