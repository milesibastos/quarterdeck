# What needs you owns the first screen, and the width is uncapped

Date: 2026-08-31
Status: accepted
Supersedes: `docs/decisions/2026-08-31-the-fold-line.md`

## Context

The fold line decision, taken a day earlier, gave the panel three equal columns
inside a centred maximum width, each column pinning a header over its own scroll
area. It solved a real problem - a fleet of thirty pushed the shipshape lens two
thousand pixels below the fold - and it solved it well enough that the trade-offs
are still worth reading.

It also decided something it did not have the standing to decide. Three equal
columns is an argument that the three questions are peers, and the wireframe the
whole panel is built around rules that out explicitly, along with the centred
maximum width. Both rulings have the same source, and it is not taste: a prior
board undercounted open decisions - ten shown against sixteen real - and nobody
noticed, because the zone was sized to look balanced rather than to make an
omission obvious. A layout tuned for balance cannot fail visibly. Four cards in
a zone that shrank to fit four look exactly as complete as sixteen in a zone
sized for sixteen.

## Decision

**One rule: what needs the operator personally owns the first screen.** Not
because decisions matter more than health, but because an undercount there is
the failure mode this panel exists to prevent, and a zone has to be sized to
show a gap before it can show one.

**The needs-you band's height is a rule, not a measurement.** `min-h-[62svh]` at
`md` and up, which lands it at roughly two thirds of the first screen once the
picker and masthead have taken theirs. It holds that height whether it is
drawing one decision or nine, so an under-filled band shows the room it is not
using. That visible slack is the mechanism, not a styling accident.

Nothing bounds what the band draws, either. Sixteen decisions overflowing the
first screen is the correct render: the operator scrolls, and the count in the
header says how far. A cap would put back exactly the silence the band removes.

**The count comes from the deck the document carries, folded once.**
`src/ui/needs-you/needs-you.ts` returns both halves - what needs a person, and
the four piles the deck draws - from a single call, so a row that belongs to one
list and is drawn by neither cannot be written. Membership is
`hold.waitingOn === "captain"`, which is the panel's existing `isAnswerable`
test rather than a second one; how many of those can be answered right now is
upstream's `actionable`, carried and reported, never recomputed. A count taken
off the rendered cards would agree with the render by construction, which is
another way of saying it could not detect the bug above.

**The band never reports a count it did not count.** `sizeOf` returns null
whenever the count is zero, whatever the deck's status, so a read that never
happened can never surface as the number zero - the one number that tells an
operator to stop looking. That is not the same as going blank the moment a read
fails. A deck that read cleanly and holds no decision draws "Nothing needs
you", and names how many rows it counted to get there. A deck that could not be
read and carries nothing behind it draws "Unknown, not nothing". A deck that
could not be read but still carries decisions from the last clean read draws
those decisions and their count, under a caveat naming when the read failed and
that the count may be short - last-known-good, labelled, which is the same rule
the deck and fleet lenses already follow rather than a special case invented
here.

**Underway comes next and peeks.** Its header and the top of its first row of
cards sit above the fold. Deck, landed and shipshape follow. The bands stack
in one order at every width, because a layout that reorders itself between
breakpoints teaches an operator two panels.

**No centred maximum width, and no fixed column count.** Every band that repeats
an object draws it through one utility, `card-grid` in `src/app/globals.css`:
`repeat(auto-fill, minmax(min(100%, var(--qd-card-min)), 1fr))`. A wider monitor
buys more cards at the size they were designed at. The `min(100%, ...)` is what
keeps a 24rem floor from overflowing a 360px phone, since a track's minimum is a
width the container may not shrink below.

**The age badge carries the trust signal above the fold.** Three states at two
named thresholds - current under five minutes, ageing past five, old past
thirty - in `src/ui/lib/snapshot-age.ts`, with the words the badge says about
them beside the numbers. It is measured from the snapshot's own instant, read
off the fleet's status, and not from `generatedAt`, which is when the panel
assembled the document and is therefore always a moment ago. A snapshot that
could not be read at all has no age and gets its own rendering rather than a
fourth step on the scale.

The rebuild command sits inside the badge, because the moment an operator
distrusts the age is the moment they need it. It is upstream's own command,
relative to the home and never joined to a path, and it arrives as a prop from
`src/app/page.tsx` - `src/ui/` may not import the adapters. A fixture set has no
such command and the badge says so rather than inventing one.

## What this delivers

Measured in a browser against the built panel, with the `crowded` set as the
only configured fleet. How, and under which conditions, is at the end of this
section; both matter, and neither was written down the first time.

At 1440x900 the needs-you band runs from 242 to 800 - 558 of the 900 pixels
above the fold, or 62% - holding four decision cards in three columns of 442
pixels. Underway's header sits at 816, leaving 84 pixels of it on the first
screen: enough that there is obviously more page, not enough to compete for it.
The page's `scrollWidth` equals its `clientWidth`.

**Underway's header is derived, not free, and what moves it is worth knowing.**
The band's top is whatever the picker and the masthead leave, and the band is
62svh below that. So the header moves with the viewport height - and it moves
by one line of the picker the moment more than one fleet is configured,
because the note naming the only fleet is drawn only when there is one. Both
were measured, at three heights and at two fleet counts. What the header does
not move with is the fixture set, as long as the band's content fits inside the
height the rule reserves for it.

Width buys cards and not stretch. The needs-you band draws 2 columns at 1024, 3
at 1440, 4 at 1920 and 6 at 2560; underway, whose cards are narrower, draws 2,
3, 5 and 6. `tests/width.test.ts` asserts the same property without a browser,
by reading the grid rule out of the served stylesheet and the card minimum out
of the class the band actually carries, then computing column counts at three
content widths - so a change to either moves the arithmetic rather than leaving
a stale constant passing.

Swept across four viewports - 360, 768, 1440, 2560 - in both themes, no element's
right edge passes the document's client width in any of the eight pages, and the
five bands are in the same order in all of them.

Nothing moves under the reader. With the fleet band scrolled to 1400 pixels and
one worker card's brief disclosure open, a snapshot rewritten under the running
panel changed that card's text with the scroll position unchanged, the
disclosure still open, and its position on the page identical to the pixel.
React reconciles rather than rebuilds, which is the same contract the refresh
loop always had; taking the scroll area out of the lens frame did not disturb
it.

The degraded pages hold. `deck-dark` draws a current badge over a band saying
the count is unknown; `all-dark` draws a badge saying the snapshot could not be
read at all, over the same band.

### How every figure above was taken

Written down so the next reader repeats the measurement rather than derives it
again. Re-measured on 2026-09-01, against a panel built from this commit:

```sh
npm run build
QUARTERDECK_FIXTURE_SET=crowded npm start   # one fleet, and only one
```

Then, against the URL it prints, in headless Chrome through
`chrome-devtools-axi`: `emulate --viewport "1440x900"` to set the viewport,
and `eval` to read `getBoundingClientRect()` and `window.scrollY` off
`[data-lens="needs-you"]`, off `[data-lens="fleet"] [data-lens-headline]`, and
off the `.card-grid` in each band. A column count is the number of tracks in
the grid's computed `grid-template-columns`, not the number of cards drawn
into them: the needs-you band holds four decisions and so fills four of the
six tracks it is given at 2560.

Two conditions decide the fold and neither is optional. The set named above
must be the only fleet configured, because a second one takes a line out of
the picker and lifts everything below it by that line. And the viewport height
is most of the answer, since the band is a fraction of it by rule.

### What the 2026-09-01 pass corrected

The pre-grammar paragraph - 150, 708, 724, 176 - was right when it was written
and still right at the commit before the terminal grammar. The grammar moved
all four and they were not re-measured; they are re-measured above.

The addendum that replaced 724 with 778 is a different kind of wrong. No build
of this panel puts underway's header at 778: not before the grammar, not while
the fleet chooser was drawn open inline, and not since it went behind a
disclosure, which is where 816 comes from and where it has stayed. Where 778
was taken is not established, and the record should not pretend otherwise.

**A second record moved in the same commit.** The addendum cited
`docs/decisions/2026-08-31-the-terminal-grammar.md` as the source of 778, and
that record carried the number too, so correcting only this one would have left
the two contradicting each other about the same header. Its figures were
re-measured with these, and the two that were wrong were corrected there rather
than left for a third pass to find.

Underway's column count at 1440 was wrong in the quieter way, and for longer:
three tracks, not four, at the commit that wrote the row as well as today. The
needs-you row beside it was right at both.

## Trade-offs

**Shipshape is below the fold now.** That is the thing the superseded decision
was for, and giving it up is the real cost here. What replaces it above the
fold is the age badge: a supervision cycle that has stopped is a snapshot that
stops being refreshed, which turns the badge amber and then red without anything
else on the page having to notice. That is a weaker signal than three named
health verdicts and it is not a full substitute - a cycle that is alive but
drifting is invisible until the operator scrolls. The wireframe's answer is a
thin shipshape strip in the masthead, which is lens-internal work this task did
not own; the lens is unchanged and drawn in full, one band lower.

**A band sized by rule wastes space on a quiet day.** On a fleet with two
decisions, two thirds of the first screen is a card and a large gap. That is the
design working, and it will still read as waste to somebody who has not been
undercounted before. The alternative is a zone that shrinks to fit, which is the
defect.

**`svh` reserves against the small viewport.** On a phone browser whose toolbar
retracts, `62svh` is measured against the smaller of the two states, so the band
takes slightly less of a scrolled-down viewport than of a fresh one. The
reserve only applies at `md` and up in any case, so this is a tablet-in-portrait
concern rather than a phone one.

**Suppressing the count on an unreadable deck was considered and rejected.**
Blanking the header the moment a read fails would be a blank where information
still exists, and it would make the needs-you band the one place on the page
that behaves differently from the deck and fleet lenses, which already show a
real count off last-known-good content when their own reads fail. An operator
who learns the rule in one lens and finds it does not hold in the next has been
misled by the inconsistency itself - and the danger this band guards against is
a _silent_ undercount; a count that announces the read failed and may be short
is the opposite of silent.

**Three focus stops went away with the scroll areas.** Each lens body carried
`tabindex="0"` because it was the only route to the thirteenth worker card with
a keyboard. Nothing scrolls inside itself any more, so a focusable body would be
a stop on the way to nothing. The bodies are still named by their own headings.

**The width test is arithmetic, not layout.** It proves the rule the stylesheet
ships and the number the markup asks for; it does not prove the browser laid
them out that way. The browser sweep above is what covers that, and it is a
measurement in a document rather than a check that runs.

**Nothing enforces a minimum viewport height.** Unchanged from the superseded
decision, and slightly worse: a short window now squeezes a band that has been
told to take 62% of it.

## What was tried instead

**Keeping three columns and merely reordering them.** It cannot satisfy the
ruling: any layout that gives the three lenses one row gives them equal weight,
whatever the order.

**Rebuilding the shipshape lens as a chip strip in the masthead**, the way the
wireframe draws it. It is the right end state and it is a different task: the
lens's three signals each carry prose and an unreadable arm, and compressing
them is a change to what the lens says rather than to where it sits.

**Putting blocked work in the band.** The wireframe draws a blocked card there.
Blocked work waits on the fleet, not on the reader, and the band's emptiness only
means something if everything in it is genuinely a question for the operator.
Blocked rows stay in the deck.

**Counting the band's own rendered cards for the header.** Cheaper, and exactly
the bug: a count derived from the render agrees with the render whatever the
render dropped.

## See also

- `src/ui/shell.tsx` - the proportions, and the order of the bands.
- `src/ui/needs-you/needs-you.ts` - the fold both halves are drawn from.
- `src/ui/lib/snapshot-age.ts` - the two thresholds, in one place.
- `src/app/globals.css` - `card-grid`, the one answer to "what happens on a
  bigger monitor".
- `tests/needs-you.test.ts`, `tests/width.test.ts`, `tests/snapshot-age.test.ts`,
  `tests/shell.test.ts` - what of this is asserted through the built server.
- `docs/decisions/2026-08-31-the-fold-line.md` - superseded, and worth reading
  for the problem it solved.
