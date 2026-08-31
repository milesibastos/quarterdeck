import type { Lens } from "@/types/document.ts";
import { Card } from "@/ui/components/card";
import { cn } from "@/ui/lib/utils";

/**
 * The chrome around one band: its name, how much of it can be trusted, how much
 * of it there is, and whatever the band itself draws.
 *
 * Shared so the bands cannot drift into describing the same status four
 * different ways, and so a later worker changing one band changes only what is
 * inside it. The `data-lens` and `data-lens-status` attributes are how a test
 * asserts that one band went dark while the others did not.
 *
 * ## What this used to do, and no longer does
 *
 * It used to be the fold: three columns, each pinning a header over a body that
 * scrolled inside one viewport. That layout weighted the three lenses equally,
 * which is the thing the wireframe rules out - see
 * `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`. The page
 * scrolls as a page again and nothing here clips its own content, so a band
 * that grows pushes the ones below it down instead of hiding rows behind an
 * invisible overlay scrollbar.
 *
 * The keyboard focus stop went with it. A scroll region nobody can focus is a
 * region half the operators cannot read, which is why the body carried
 * `tabindex="0"`; a region that does not scroll and takes focus anyway is just
 * a stop on the way to the next thing. It is still named by its own heading, so
 * a reader navigating by region still knows which band they are in.
 *
 * ## Why the header is a live region
 *
 * The panel re-renders under whoever is reading it. The trust word is the value
 * that changes without anybody touching the page, and a reader who cannot see
 * it turn from `Current` to `Stale` is being told something false by silence.
 * The heading is inside the region on purpose: the bands update independently,
 * so the announcement has to name which one moved.
 */

const HEADLINE: Readonly<Record<Lens<unknown>["status"]["state"], string>> = {
  fresh: "Current",
  stale: "Stale",
  unreadable: "Could not be read",
};

/**
 * The trust word's tone: three steps of emphasis, not three hues.
 *
 * `stale` gets full-strength text rather than the warn gold it first had. The
 * gold measures 3.61:1 on this surface, which is below AA for eleven-pixel
 * text - and a word nobody can read is a poor way to say a panel cannot be
 * trusted. Weight carries the same three steps and every one of them passes.
 * The word itself is the signal in any case; the colour only reinforces it.
 */
const TONE: Readonly<Record<Lens<unknown>["status"]["state"], string>> = {
  fresh: "text-muted-foreground",
  stale: "text-foreground",
  unreadable: "text-danger",
};

/**
 * How loudly a band announces itself.
 *
 * `primary` is for the one band that owns the first screen, and it is the only
 * place on this page where a difference in weight is an argument: what needs
 * the operator personally is not a peer of what the fleet is handling by
 * itself, and a layout that drew them at equal size would be saying it is. The
 * rest are `lens`.
 */
export type Prominence = "lens" | "primary";

const TITLE_SIZE: Readonly<Record<Prominence, string>> = {
  lens: "text-lg",
  primary: "text-2xl sm:text-3xl",
};

const EDGE: Readonly<Record<Prominence, string>> = {
  lens: "",
  primary: "ring-2 ring-primary/30",
};

export function LensFrame<T>({
  lens,
  name,
  title,
  summary = null,
  prominence = "lens",
  className,
  children,
}: {
  lens: Lens<T>;
  /** The band's own name, and its handle in the markup. */
  name: string;
  title: string;
  /**
   * How much this band is holding, in three or four words, or `null` when it
   * has no size worth stating.
   *
   * It sits in the pinned header because it is the one thing the heading cannot
   * otherwise say: whether what is on screen is all of it, or the first of
   * thirty. A count, never a verdict - judging the content is the band's job
   * and it has the room to do it properly below.
   */
  summary?: string | null;
  /** See `Prominence`. */
  prominence?: Prominence;
  /**
   * What the shell wants of this band's box - its share of the first screen,
   * and nothing inside it.
   *
   * The proportions are the shell's to decide and are documented there: a band
   * cannot know how much of a viewport it deserves, because that is a statement
   * about the other bands. See `src/ui/shell.tsx`.
   */
  className?: string;
  children: React.ReactNode;
}) {
  // `name` is the band's handle and is already unique on the page, so the
  // heading gets a stable id without a hook - this renders on the server.
  const headingId = `lens-${name}-title`;

  return (
    <section
      data-lens={name}
      data-lens-status={lens.status.state}
      data-prominence={prominence}
      className={cn("flex min-w-0 flex-col", className)}
    >
      <Card
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-0 py-0",
          EDGE[prominence],
        )}
      >
        <header
          role="status"
          data-lens-headline
          className="flex flex-col gap-1 border-b border-border/70 px-4 pt-3.5 pb-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <h2
              id={headingId}
              className={cn(
                "min-w-0 font-display tracking-wide text-foreground",
                TITLE_SIZE[prominence],
              )}
            >
              {title}
            </h2>
            <p className="min-w-0 font-mono text-[0.6875rem] tracking-wide uppercase">
              <span className={TONE[lens.status.state]}>
                {HEADLINE[lens.status.state]}
              </span>
              {summary !== null && (
                <span className="text-muted-foreground">{` · ${summary}`}</span>
              )}
            </p>
          </div>

          {/*
            Upstream and the panel both write these, and neither promises a
            short one: a parse refusal quotes the value it refused, which can be
            an audit token with no space in it anywhere. `wrap-anywhere` rather
            than `break-words` because this sits in a grid cell, and only
            `anywhere` shrinks the element's own minimum width - the frame it
            used to burst out of sideways.
          */}
          {lens.status.state !== "fresh" && (
            <p
              data-lens-detail
              className="text-sm wrap-anywhere text-muted-foreground"
            >
              {lens.status.detail}
            </p>
          )}
        </header>

        {/* Named by its own heading, so a reader navigating by region knows
            which band they are in without reading back up the page. */}
        <div
          data-lens-body
          role="group"
          aria-labelledby={headingId}
          className="flex min-w-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4"
        >
          {children}
        </div>
      </Card>
    </section>
  );
}
