import type { PanelDocument } from "@/types/document.ts";
import type { AnsweringSession } from "@/ui/deck/answer-control";
import { DeckLens } from "@/ui/deck/deck-lens";
import { DisclosureBar } from "@/ui/disclosure-bar";
import { FleetLens } from "@/ui/fleet/fleet-lens";
import { LandedLens } from "@/ui/landed/landed-lens";
import type { TerminalReader } from "@/ui/fleet/worker-terminal";
import { ago } from "@/ui/lib/age";
import { NeedsYouBand } from "@/ui/needs-you/needs-you-band";
import { ShipshapeLens } from "@/ui/shipshape/shipshape-lens";
import { SnapshotBadge, type Rebuild } from "@/ui/snapshot-badge";

/**
 * When the snapshot behind this page was taken, or `null` when it could not be
 * read at all.
 *
 * Read off the fleet's status rather than off `generatedAt`, which is when the
 * panel assembled the document - always a moment ago, because assembling it is
 * what serving the page does. The snapshot fills fleet, deck and landed in one
 * read, so its instant is on all three; the fleet is the one that is never
 * darkened on its own, which makes it the honest carrier. A fleet status with
 * no `asOf` is a snapshot that did not read, and the badge says that rather
 * than inventing an age for it.
 */
function snapshotAsOf(document: PanelDocument): string | null {
  const { status } = document.fleet;
  return status.state === "unreadable" ? null : status.asOf;
}

/**
 * The panel shell: the masthead, and the bands under it in the order they are
 * meant to be read.
 *
 * ## The proportions
 *
 * One rule decides this layout: **what needs the operator personally owns the
 * first screen.** Everything the fleet is handling by itself lives below it.
 *
 * The reason is not taste. A prior board undercounted open decisions - ten
 * shown against sixteen real - and nobody noticed, because the zone was sized
 * to look balanced rather than to make an omission obvious. So the needs-you
 * band's height is a rule and not a measurement: `min-h-[62svh]` at `md` and
 * up, which puts it at roughly two thirds of the first screen once the masthead
 * has taken its share, whether it is holding one decision or nine. An
 * under-filled band shows the room it is not using, and that visible slack is
 * the whole point - it is what makes a short list look short.
 *
 * Underway comes next and is meant to peek: its header and the top of its first
 * row of cards sit above the fold, so it is obvious there is more page without
 * any of it competing for the first screen. Deck, landed and shipshape follow,
 * in that order - what is coming, then what finished, then whether the
 * machinery is well - and the disclosure bar closes the page. Nothing is capped
 * and nothing scrolls inside itself - a band that grows pushes the ones below
 * it down, which is a page an operator already knows how to read.
 *
 * The bar is last on purpose and is the only thing here that is not a lens: it
 * is a statement about the page rather than a part of it, and an operator who
 * has read to the bottom has read what this page is not showing them.
 *
 * ## The width
 *
 * No centred column and no fixed column count. Every band that repeats an
 * object draws it through the `card-grid` utility in `src/app/globals.css`,
 * which is `auto-fill` over a fixed minimum: a wider monitor buys more cards at
 * the size they were designed at, never three cards stretched across it. The
 * page runs to the edges with a gutter, because a maximum width on a panel like
 * this throws away exactly the space that would have shown the sixteenth
 * decision.
 *
 * ## What replaced what
 *
 * Three equal columns inside one non-scrolling viewport, each pinning a header
 * over its own scroll area. That layout answered a real problem - a busy fleet
 * pushing the health signals off the page - but it answered it by declaring the
 * three lenses peers, which is the thing the wireframe rules out. See
 * `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md` for what
 * carries the trust signal now, and what was given up.
 *
 * This component - and everything under `src/ui/` - can only see the document
 * and what the composition point hands it. It cannot read a fleet, so it cannot
 * grow a "just fetch this one extra field" shortcut, and the whole panel stays
 * replaceable.
 */
export function Shell({
  document,
  nowMs,
  terminal,
  session = null,
  rebuild = null,
}: {
  document: PanelDocument;
  /** Chosen by the composition point, so the ages agree with the projection. */
  nowMs: number;
  /**
   * How a worker card reads its session when the operator expands it.
   *
   * The second thing on this page that is not the document, and it is here for
   * the same reason `session` is: `src/ui/` cannot read a fleet, so an on-demand
   * read has to arrive as an address built where the fleets are named. It is not
   * on the document deliberately - a tail that travelled with the document would
   * be read for every card on every pass.
   */
  terminal: TerminalReader;
  /**
   * How an answer reaches the server, for the deck's answerable items.
   *
   * One of the two things on this page that are not the document. It has to
   * come from the composition point: `src/ui/` cannot read the runtime, which
   * is what keeps the panel replaceable, and the secret lives in the runtime.
   */
  session?: AnsweringSession | null;
  /**
   * How the operator makes a newer snapshot than the one on screen, or `null`
   * when nothing this panel knows of would.
   *
   * The other one. Which command publishes a fleet's snapshot is the adapter's
   * knowledge and `src/ui/` may not import it, so it arrives as a prop.
   */
  rebuild?: Rebuild | null;
}) {
  return (
    <main
      data-panel
      className="flex w-full min-w-0 flex-col gap-4 px-4 pt-4 pb-10 sm:px-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl tracking-wide text-foreground sm:text-3xl">
            Quarterdeck
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            document v{document.version} &middot; assembled{" "}
            {ago(document.generatedAt, nowMs)}
          </p>
        </div>

        {/* Not a footnote in the corner: everything below is drawn as though it
            were true now, and it is not. See `src/ui/snapshot-badge.tsx`. */}
        <SnapshotBadge asOf={snapshotAsOf(document)} nowMs={nowMs} rebuild={rebuild} />
      </header>

      {/* The reserve. Sized by rule so an omission is physically obvious rather
          than plausible; see the proportions above. Below `md` it takes what it
          needs, because a phone has no first screen worth reserving two thirds
          of and the reading order is what matters there. */}
      <NeedsYouBand
        lens={document.deck}
        fleet={document.fleet.content}
        nowMs={nowMs}
        session={session}
        className="md:min-h-[62svh]"
      />

      <FleetLens lens={document.fleet} nowMs={nowMs} terminal={terminal} />

      {/* The deck is handed the fleet's work items as a directory: a blocker
          arrives as a bare identity, and the work it names has usually already
          started. It draws what the band above did not - the same fold, called
          once in `src/ui/needs-you/needs-you.ts`, so no row can fall between
          the two. */}
      <DeckLens
        lens={document.deck}
        fleet={document.fleet.content}
        nowMs={nowMs}
        session={session}
      />

      {/* What finished. Below the fold and drawn at ordinary weight: it is a
          record rather than a call for attention, and the first screen belongs
          to what needs the operator personally. */}
      <LandedLens lens={document.landed} nowMs={nowMs} />

      <ShipshapeLens lens={document.health} nowMs={nowMs} />

      {/* Last, and always present. Everything above draws what the document
          carries; this draws what it does not, and an operator who has read to
          the bottom of the page has read what is missing from it. The snapshot
          status goes with it because "nothing is missing" is a claim only a
          read that happened is entitled to make - see the bar itself. */}
      <DisclosureBar
        omissions={document.omissions}
        snapshot={document.fleet.status}
        nowMs={nowMs}
      />
    </main>
  );
}
