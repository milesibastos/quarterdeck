import type { PanelDocument } from "@/types/document.ts";
import type { AnsweringSession } from "@/ui/deck/answer-control";
import { DeckLens } from "@/ui/deck/deck-lens";
import { FleetLens } from "@/ui/fleet/fleet-lens";
import { ago } from "@/ui/lib/age";
import { ShipshapeLens } from "@/ui/shipshape/shipshape-lens";

/**
 * The panel shell: the envelope, and the three lenses side by side.
 *
 * Layout only. The proportions and the fold line need real content before they
 * can be tuned, so this places the three lenses and stops there.
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="font-display text-3xl tracking-wide text-foreground">
          Quarterdeck
        </h1>
        <p className="font-mono text-xs text-muted-foreground">
          document v{document.version} &middot; assembled{" "}
          {ago(document.generatedAt, nowMs)}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
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
