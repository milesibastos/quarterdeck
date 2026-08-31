# The shipshape strip in the grok grammar

Date: 2026-08-31
Status: accepted. Extends `docs/decisions/2026-08-31-the-terminal-grammar.md`,
which is unchanged: one family, both themes, the wireframe wins on layout.

## Context

The frame landed in the grok grammar and named the shipshape strip as one of
the six unconverted surfaces. This converts it.

The strip is the smallest lens and the one where a dishonest render costs the
most: it answers whether the machinery that watches the fleet is itself
healthy, and an operator who trusts a calm strip stops looking. So the
conversion had one hard constraint beyond the grammar - nothing the lens
truthfully said before may read as less true afterwards, and an unknown may
never come out looking like a clean reading.

## Decision

### `GrokEvent` per signal, verdict first

A health signal is an event the supervision cycle reported, not a gauge the
panel is sampling, so it is drawn as one: `◆`, the verdict, then the question
it answers. `label` carries the verdict string unchanged and the question is
the component's `children`, in `--term-muted`.

The five blocks keep the arrangement they already had - verdict, then question,
then whatever detail the document carries, stacked in one column inside the
lens frame. Only the skin changed.

### The wash is gone; the gutter is the edge

Each block was a rounded box on `bg-muted/40` with a four-pixel left rule. The
grammar is one ground with rules separating boxes, so the wash went and the
block is now a two-pixel left gutter and its indent, the same gutter grok's own
tool card uses. That is a skin change: nothing moved, nothing was re-cut.

### Tone by rebinding one token

`GrokEvent` paints its label from `--term-fg` with an inline style and exposes
no tone. The verdict is where this lens does its scanning work - five verdicts
read without reading a word - so uniform ink was not an option: `Stopped` in
ordinary text would read calmer than it is, which is the one direction this
lens may never drift.

So the tone is applied by rebinding `--term-fg` on the single element wrapping
the event line: `--term-success`, `--term-warning`, `--term-danger`, and for an
unread signal a rank rather than a hue. Token to token, so `raw-colour` is
untouched; scoped to one wrapper, so it reaches nothing else; and no edit to a
vendored file three other workers are building on at the same time. If the
foundation later gives `GrokEvent` a tone prop, this wrapper is what it
replaces.

### An unread signal takes a rank, never a hue

`dark` is not a fourth severity and is not drawn as one. The gutter is
`--term-faint` and **dashed**, so an unread signal is told apart from a read one
by the shape of its edge and not by hue alone - the same convention the
lifecycle rail uses, and it survives both themes and a reader who cannot see
colour.

The verdict itself takes `--term-dim`, not the `--term-muted` the question
beside it uses. Measured on the page with all five signals unread: at the same
rank the verdict and the question ran together as one grey line, and that is
the state this lens is most likely to be read in on a bad day. Brighter than
the question, still colourless, still dashed.

## Where the wireframe won

**The strip is still a stacked band, not a row of pills.** The wireframe draws
shipshape as a 46-pixel strip of chips above the needs-you band -
`supervision · alive 8s`, `notifications · 0 queued`. The shipped layout is a
band low on the page holding five stacked blocks, settled by
`docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`, which
postdates the SVG. A pill has room for a verdict and nothing else, and this
lens's whole argument is the two sentences under each verdict - the ones that
say what failed and what is therefore unknown. Restoring the strip would have
been a re-cut of the page dressed as a reskin, so the accepted layout stands.

## `GrokStatus` was declined

The brief nominated it as the closest fit: a status line carrying counts and a
usage reading, which is roughly the shape of a signal with a queue depth in it.
Reading the vendored source rules it out. It hardcodes `aria-label="Session
status"`, an `sr-only` "steps complete" after its `✓`, and a branch glyph
before its directory. Composed here, a screen reader would be told this lens is
a session status reporting completed turn steps - none of which the strip does.
That is precisely the legend-without-an-implementation defect the grammar
decision exists to prevent, and it is a worse lie than a plainer render.

The fix is a props change on a vendored file the foundation owns and three
other lenses share, so it is reported here rather than taken. `GrokEvent`,
which hardcodes nothing about what it is describing, carries the line instead.

## Trade-offs

**The verdict is coloured text, not a filled chip.** The old chip was a solid
fill with a foreground partner and carried further across a scan than a coloured
word does. grok has no filled chip, and inventing one would have been the third
visual language the captain ruled out. The gutter carries the tone with the
word, so the verdict is still legible at a glance from two signals at once -
just less loudly than a pill.

**The two attendance values keep `text-foreground`.**
`tests/shipshape-lens.test.ts` pins the whole class string beside `data-fact`,
and the two tokens are the same stop in dark and one rank apart in light, where
the brighter one reads as emphasis on the value. Recorded rather than fixed:
editing an accepted test to change nothing visible is a poor trade.

**The detail paragraphs are mono now.** Terminal grammar is mono throughout, so
two or three sentences of prose per block are set in it. At 13px/1.55 that is
larger than the 12px sans they replaced, and it wraps correctly at 360 pixels.

## What was verified

`npm test`: the thirty-two shipshape tests pass, the seven invariants pass, and
`raw-colour` passes. Two failures in `needs-you.test.ts` predate this branch -
they reproduce on `3885448` with `src/ui/shipshape/` reverted - and are
untouched by it.

Driven in a browser against the built panel, both themes: the `healthy` set
(five clean verdicts), `stale` (a stopped cycle beside three concerns, and the
dated stale note), `health-unread` (all five dark at once) and `health-dark`
(the lens's own dark state). At 360 CSS pixels no element in the band passes the
document's client width, and the event line wraps to put the question under the
verdict rather than truncating either.
