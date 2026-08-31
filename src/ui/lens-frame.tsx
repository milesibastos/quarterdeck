import type { Lens } from "@/types/document.ts";
import { Card } from "@/ui/components/card";
import { cn } from "@/ui/lib/utils";

/**
 * The chrome around one lens: its name, how much of it can be trusted, how much
 * of it there is, and whatever the lens itself draws.
 *
 * Shared so the three lenses cannot drift into describing the same status three
 * different ways, and so a later worker changing one lens changes only what is
 * inside it. The `data-lens` and `data-lens-status` attributes are how a test
 * asserts that one lens went dark while the others did not.
 *
 * ## The fold lives here
 *
 * Everything above `children` is pinned and everything below it scrolls. A
 * fleet of thirty and a fleet of two therefore put the same three things on
 * screen - each lens's name, its trust word, and its size - and only the
 * content underneath moves. See
 * `docs/decisions/2026-08-31-the-fold-line.md` for why that is the split.
 *
 * Below `md` there is one column and the page scrolls as a page: three nested
 * scroll areas stacked down a phone is worse than a long page, and nothing is
 * side by side to keep aligned.
 *
 * ## Why the header is a live region
 *
 * The panel re-renders under whoever is reading it. The trust word is the value
 * that changes without anybody touching the page, and a reader who cannot see
 * it turn from `Current` to `Stale` is being told something false by silence.
 * The heading is inside the region on purpose: three lenses update
 * independently, so the announcement has to name which one moved.
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

export function LensFrame<T>({
  lens,
  name,
  title,
  summary = null,
  children,
}: {
  lens: Lens<T>;
  /** The lens's own name, and its handle in the markup. */
  name: string;
  title: string;
  /**
   * How much this lens is holding, in three or four words, or `null` when the
   * lens has no size worth stating.
   *
   * It sits above the fold because it is the one thing the pinned header cannot
   * otherwise say: whether what is on screen is all of it, or the first of
   * thirty. A count, never a verdict - judging the content is the lens's job
   * and it has the room to do it properly below.
   */
  summary?: string | null;
  children: React.ReactNode;
}) {
  // `name` is the lens's handle and is already unique on the page, so the
  // heading gets a stable id without a hook - this renders on the server.
  const headingId = `lens-${name}-title`;

  return (
    <section
      data-lens={name}
      data-lens-status={lens.status.state}
      className="flex min-w-0 flex-col md:min-h-0"
    >
      <Card className="flex h-full min-h-0 flex-col gap-0 py-0">
        <header
          role="status"
          data-lens-headline
          className="flex shrink-0 flex-col gap-1 border-b border-border/70 px-4 pt-3.5 pb-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <h2
              id={headingId}
              className="min-w-0 font-display text-lg tracking-wide text-foreground"
            >
              {title}
            </h2>
            <p className="min-w-0 font-mono text-[0.6875rem] tracking-wide uppercase">
              <span className={TONE[lens.status.state]}>{HEADLINE[lens.status.state]}</span>
              {summary !== null && (
                <span className="text-muted-foreground">{` · ${summary}`}</span>
              )}
            </p>
          </div>

          {/*
            Upstream and the panel both write these, and neither promises a
            short one: a parse refusal quotes the value it refused, which can be
            an audit token with no space in it anywhere. `wrap-anywhere` rather
            than `break-words` because this sits in a grid column, and only
            `anywhere` shrinks the element's own minimum width - the frame it
            used to burst out of sideways.
          */}
          {lens.status.state !== "fresh" && (
            <p data-lens-detail className="text-sm wrap-anywhere text-muted-foreground">
              {lens.status.detail}
            </p>
          )}
        </header>

        {/*
          Focusable and named: at `md` and up this is the only way to reach a
          worker past the twelfth with a keyboard, and a scroll region nobody
          can put focus into is a scroll region half the operators cannot use.
        */}
        <div
          data-lens-body
          role="group"
          aria-labelledby={headingId}
          tabIndex={0}
          className={cn(
            "flex flex-col gap-3 px-4 pt-3 pb-4",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
            "md:min-h-0 md:flex-1 md:overflow-y-auto",
          )}
        >
          {children}
        </div>
      </Card>
    </section>
  );
}
