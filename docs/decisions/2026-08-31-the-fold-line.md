# The fold line: one viewport, three columns, each scrolling on its own

Date: 2026-08-31
Status: superseded by `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`

> Superseded the same day. The layout below weighted the three lenses equally
> inside a centred maximum width, and the wireframe rules both out: what needs
> the operator personally owns the first screen, and width buys cards. The
> problem this decision solved is real and the successor names what it gave up
> to solve a different one - read both.

## Context

All three lenses now draw real content, which is the condition this decision was
waiting on. Until they did, nobody knew how much each lens would have to say, so
`src/ui/shell.tsx` placed three columns and stopped there - and said so in its
own docstring.

With the content in place the problem is legible. A fleet of two and a fleet of
thirty are different design problems: the deck and the shipshape lenses are
roughly the same height whatever the fleet is doing, and the fleet column is
not. Laid out as one page that scrolls, thirty worker cards push the shipshape
lens about two thousand pixels below the fold - which means the busier the fleet
is, the less likely the operator is to see the one lens that says whether any of
what they are reading can be trusted. The panel's own shape would be a function
of how busy the fleet is, and it would degrade in exactly the direction that
matters.

The `crowded` fixture set exists for this: thirty workers and fifteen deck rows,
which is the large end of the range the layout has to survive.

## Decision

**Three equal columns.** The panel asks three questions - what is happening,
what is coming, can I trust this - and none of them is a subordinate of another.
Weighting the fleet column because it usually holds the most rows would make the
layout an argument that the fleet matters most, which is the opposite of what
the shipshape lens is for.

**At `md` and up the page is exactly one viewport tall and does not scroll.**
The height chain runs `html` and `body` (`src/app/layout.tsx`), through the
fleet picker that wraps everything the panel draws, to the shell's grid. Each
lens is a flex column inside its cell.

**Each lens pins a header and scrolls its own body.** Above the fold, always:
the lens's name, its trust word, and how much it is holding. Below it, whatever
the lens draws. That is the whole fold decision, and it lives in
`src/ui/lens-frame.tsx` so the three lenses cannot answer it three different
ways.

**The count in the header is the size, never a verdict.** `30 workers`,
`15 items`. What the header cannot otherwise say is whether the rows on screen
are all of them; judging them is the lens's job, and it has room below to do it
properly. A lens with nothing in it says so in a sentence instead, so the header
stays quiet rather than reading `0 workers` above a paragraph that already
explains why.

**Below `md` there is one column and the page scrolls as a page.** Three nested
scroll areas stacked down a phone is worse than a long page, and at one column
there is nothing side by side to keep aligned.

## What this delivers

Measured in a browser against the built panel, at 1440x900 with the `crowded`
set: the page's `scrollWidth` equals its `clientWidth`, `body.scrollHeight`
equals the viewport, the fleet column holds 2233 pixels of content inside 713
pixels of viewport, and the shipshape lens sits fully on screen. At the
`healthy` set - eleven workers - the same three headers are in the same three
places. The difference between two workers and thirty shows up as a scrollbar,
not as a lens leaving the page.

At 360 CSS pixels, with the `wide-detail` set on screen, no element's right edge
passes the document's client width. Swept across three viewports, both themes
and four sets - twenty-four pages - nothing overflows sideways in any of them.

Scroll preservation moved with the scroll and survives it. The refresh loop's
whole argument is that a card being read is not rebuilt underneath the reader,
and that claim was demonstrated against a page that scrolled as a page. Re-done
against this layout: with the fleet column scrolled to 1029 pixels and one
card's `dispatched with` disclosure open, a snapshot rewritten under the running
panel changed the card's text with the scroll position and the open disclosure
both untouched. React reconciles the scroll container rather than rebuilding it,
which is the same contract as before, applied one element deeper.

## Trade-offs

**A scroll region inside a page is a keyboard trap unless it is focusable.** At
`md` and up, a lens body is the only route to the thirteenth worker card, so
each one carries `tabindex="0"` and is named by its own heading through
`aria-labelledby`. The cost is three focus stops on a narrow screen where the
regions do not scroll at all. Three stops is cheaper than a column half the
operators cannot reach.

**A clipped card is the only cue that there is more.** macOS overlay scrollbars
are invisible until they are used, so what says "there is more below" is the
count in the pinned header and a card visibly cut off at the bottom edge. Both
are real cues and neither is loud. A permanent scrollbar or a fade would be
louder; neither was worth the ink on a panel this dense.

**A short viewport squeezes every column at once.** The layout assumes a window
tall enough for a lens header plus a few rows. Below that the columns get small
together rather than one of them winning, which is the behaviour to want, but
nothing enforces a floor.

**What was tried instead.** Letting the page scroll and capping only the fleet
list keeps a familiar page but makes the fleet the special case, and the deck
grows without bound in exactly the same way once a backlog is real. Ordering the
columns so shipshape comes first at narrow widths was rejected because a layout
that reorders itself between breakpoints teaches an operator two panels.

## See also

- `src/ui/lens-frame.tsx` - the fold itself, and why the header is a live region.
- `src/ui/shell.tsx` - the proportions.
- `tests/shell.test.ts` - what of this is asserted through the built server.
- `docs/decisions/2026-08-31-the-theme-follows-the-system.md` - the other half of
  this pass.
