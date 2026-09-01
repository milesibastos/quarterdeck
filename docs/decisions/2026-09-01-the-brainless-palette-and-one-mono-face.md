# The brainless palette, and one mono face

Date: 2026-09-01
Status: accepted. Repaints
`docs/decisions/2026-08-30-theme-and-palette.md` and the palette half of
`docs/decisions/2026-08-31-the-terminal-grammar.md`, both of which are updated
rather than left describing a tree that no longer exists.

## Context

The August work adopted brainless's grok components and their structure but not
its typography or its palette. Put side by side with
`https://brainless.swerdlow.dev/blocks`, the panel read as a warm document
wearing terminal chrome: three font families, a 30px poster-face heading, a
cream ground, sepia ink, and five accent hues with rounded corners on
everything.

Everything below was measured off both surfaces on 2026-09-01 with a canvas
probe in a real browser, not eyeballed and not carried over from the brief that
asked for the work. Three of the brief's figures did not survive that
re-measurement, and they are named where they come up, because a figure written
from someone else's reading is the defect this repository keeps finding.

## What brainless actually is

Two things share that page and they are not the same thing, which is the first
correction. The **docs shell** - header, sidebar, page title, install
instructions - is shadcn's neutral theme in Geist, a plain grotesque. The
**blocks** are the components, and those are Geist Mono. Reading a colour off
that page without saying which of the two it came from produces a palette that
belongs to neither.

Its token layer, read straight off `:root`:

| token                 | dark      | light     |
| --------------------- | --------- | --------- |
| `--background`        | `#0a0a0a` | `#ffffff` |
| `--foreground`        | `#fafafa` | `#0a0a0a` |
| `--card`, `--popover` | `#171717` | `#ffffff` |
| `--muted`, `--accent` | `#262626` | `#f5f5f5` |
| `--muted-foreground`  | `#a1a1a1` | `#737373` |
| `--border`            | white/10% | `#e5e5e5` |
| `--ring`              | `#737373` | `#737373` |
| `--radius`            | `0rem`    | `0rem`    |

and beside them the values its own components carry: `#e8e8e8` body text,
`#c0c0c0` dim, `#8b8b90` muted, `#808080` rule and marker, `#2b2b2b` box border,
`#1a1a1a` panel ground, `#4ea96f` under the success wash, `#cd694a` the rust.

Three corrections to the brief fall out of that table.

**`#cd694a` is called `--agent-claude`.** It is one of three per-agent identity
hues (`--agent-codex: #ededed`, `--agent-grok: #8b919c`), and brainless's actual
`--primary` is a neutral `#e5e5e5`. It is still the right accent for this panel -
it is the only saturated colour brainless spends on chrome, and rust is already
quarterdeck's identity - but it is not a global accent token upstream, and a
future reader following the brief to its source would not find one.

**`--radius: 0rem` is literally brainless's token**, which is the cleanest
possible warrant for squaring this panel. But "every border radius 0" is not
true of the rendered page: a `rounded-[6px]` box and twenty-one `rounded`
(4px) affordances survive, because Tailwind's fixed `rounded` scale does not
read `--radius`. Those are named under Trade-offs.

**There is a 30px heading**, the docs shell's `<h1>`, in Geist at weight 600.
What is true is the stronger claim: no _component_ on that page sets type above
14px, its section heads are 16px/600, and its own wordmark is 14px/600.

## Decision

### One face

Chango and Jost are gone - the two woff2 files, their loader entries, their
copyright lines in `OFL.txt`, their row in the fonts README, and every use.
`src/ui/fonts/` holds one family.

Jost was already dead: measured before the change, it rendered **zero visible
elements**. Everything on the page was either `font-mono` or `font-display`, and
the 42 elements computing to the sans were `<script>`, `<title>` and friends
inheriting it from `html`. It was a font file, a licence obligation and a
network-egress surface that drew nothing.

Chango drew six: the masthead `<h1>`, and the five lens headings. That is the
entire display footprint, which is what made retiring it tractable.

`--font-sans` is still declared in the theme layer, pointing at the mono,
because Tailwind's preflight and the shadcn layer both name it. A stray
`font-sans` now cannot reintroduce a second face.

### The scale, and what was tried

brainless separates a heading from body text with weight, colour and case, not
with size. Two ranks came out of trying that:

| rank                      | was              | is                                         |
| ------------------------- | ---------------- | ------------------------------------------ |
| masthead `<h1>`           | Chango 24px→30px | mono 14px/600, `tracking-tight`            |
| primary lens head         | Chango 24px→30px | mono 16px/600, `tracking-tight`            |
| the other four lens heads | Chango 18px      | mono 13px/600, `tracking-wider`, uppercase |

The masthead is 14px/600 because that is exactly what brainless sets its own
wordmark in. The primary lens head is 16px/600 because that is what brainless
sets its section heads in. The remaining four are 13px/600 uppercase because
below 16px the honest step down is case, not another size - and because 13px is
the size 359 of this page's elements already are, so a fifth size would have
been invented rather than found.

**What was tried and rejected.** A flat 13px for all six, which is where a
literal reading of brainless's component scale lands: it removes the difference
between the band that owns the first screen and the four below it, and the
prominence distinction the lens frame draws is the one thing the wireframe will
not trade. Keeping the primary head at 18px was tried too and abandoned for the
opposite reason - it is not a size brainless uses anywhere, so it read as a
leftover rather than a decision. Where this stopped is one step above brainless
on the masthead pair and level with it on the section heads.

The resulting scale, measured on the running panel, against brainless's:

|            | quarterdeck | brainless (components) |
| ---------- | ----------- | ---------------------- |
| 13px / 400 | 359         | 209                    |
| 12px / 400 | 176         | 83                     |
| 13px / 600 | 14          | 19                     |
| 11px / 400 | 9           | 20                     |
| 16px / 600 | 1           | -                      |
| 14px / 600 | 1           | 1                      |
| families   | **1**       | 2 (one for components) |

**The fold did not move.** The fleet lens header sits at **816** with one fleet
configured, which is exactly the figure
`docs/decisions/2026-08-31-the-terminal-grammar.md` records for that
configuration. Shrinking six headings did not raise it, because the needs-you
band's 62% floor absorbed the change into its own empty space, which is what
that floor is for.

### The palette

The `--qd-*` layer is now eighteen neutral stops, two rust, and two each of
green, amber, red and sky. Every value is one read off brainless. The old warm
ramp - paper, cream, ink, navy, gold, ocean, sea - is gone entirely.

Each hue is two stops rather than one, and the reason is a contrast floor rather
than a preference: `#cd694a` is 5.4:1 on `#0a0a0a` and **3.7:1 on white**, so a
light theme that used brainless's own accent as text would fail AA. The light
column takes the darker stop of each pair; the dark column takes brainless's own
value. The full measured table is under `--term-*` in the stylesheet, and every
number in it was read back out of the running browser rather than computed
alone.

Two departures from brainless's values, both forced by a measurement:

- **`--muted-foreground` light is `#6c6c6c`, not brainless's `#737373`.** The
  badge hovers to `bg-muted text-muted-foreground`, and `#737373` on `#f5f5f5`
  is 4.3:1. One stop darker clears the wash as well as the page. `--ring` takes
  the same stop for the same reason.
- **`--term-faint` dark is `#808080`, not grok's `#6c6c6c`.** grok's faintest
  grey is 3.8:1 on its own ground. This panel's promise is that all five text
  ranks clear 4.5:1 in both themes, and lifting the rank is how it keeps it.
  `#808080` is grok's own next grey up, so nothing was invented.

One thing the repaint **fixed** rather than carried: `--term-rule` measured
2.9:1 in the old light theme, under the 3:1 a bounding line wants, and the
terminal-grammar record logged the miss. On a neutral ramp the same role takes
`#808080`, which is 3.9:1 light and 5.0:1 dark. The recorded miss is gone.

### One accent, four meanings

`#cd694a` is the only identity colour on the page. Navy and gold are gone:
`--secondary` moved onto the neutral ramp (`#404040` light, `#c0c0c0` dark) and
`--ring` with it, and `--chart-*`, which no component names, went neutral too.

The four **status** hues stayed, and that is a deliberate line rather than an
oversight. `--online`, `--warn`, `--danger` and `--info` are meaning, not
decoration - the lifecycle rail tells ten stages apart with them - and brainless
colours its own status lines green and red for the same reason. Collapsing them
would not have made the panel more like brainless; it would have made a lens
stop being scannable, which the brief named as the line to stop at.

**The rule is one accent, not one hue, and the difference is what the colour is
spent on.** An accent is a brand spend: it says whose page this is, it is
arbitrary, and a second one competes with the first for the same job, which is
why the panel has exactly one and why navy and gold had to go. A status hue is
an information spend: it says which of four things is true, the reader decodes
it rather than recognises it, and removing it does not tidy the page - it
deletes a channel and pushes the work onto text somebody then has to read
instead. Four of those is not four accents; it is one four-valued signal.

So this record does not want the next reader to "fix" it. If the count of status
hues ever looks like a violation of one-accent, the thing to check is whether
each one is still carrying meaning no other channel carries - the rail also
gives every stage a glyph and a solid-or-dashed edge, precisely so hue is never
the only carrier - not whether there are more than one of them. Adding a fifth
identity colour would be the violation. Deleting a meaning to get the count down
would be the worse one.

`--destructive` was rust and is now the red, which separates identity from
destruction. The terminal-grammar record's standing trade-off - "`--term-accent`
and `--term-danger` are the same stop" - is resolved by that, not carried.

### Square

`--radius: 0rem`, brainless's own token value, squares everything derived:
`rounded-sm`, `-lg`, `-xl`, `-4xl` and the two `rounded-[min(var(--radius-md),…)]`
button sizes. Four things do not derive from it and were changed by hand:

- `rounded-[6px]` on the grok header box, and the bare `rounded` on its menu
  rows - both of which brainless itself keeps. See Trade-offs.
- five `rounded-full`: two status dots and the lifecycle rail's segment bars.
  A pill-shaped progress segment is the least terminal thing the panel drew.

Measured after: the running panel reports **no element with a non-zero border
radius**, in either theme.

## Trade-offs

**Squaring the two corners brainless rounds.** Its grok header keeps a 6px box
and 4px selection rows, so on those two the panel is now _less_ like brainless,
not more. Squaring won because one 6px box among several hundred square edges
reads as an oversight rather than as fidelity, and because "square wherever the
grammar reaches" was the instruction. It is a one-line revert in
`src/ui/components/grok/grok-header.tsx` if that judgement is ever reversed.

**One ground where brainless has two.** brainless nests: a `#0a0a0a` page, a
`#1a1a1a` panel, and a transparent box on top. Quarterdeck keeps `--term-bg:
var(--background)`, which the terminal-grammar record argued for and which this
repaint does not reopen - two grounds split every rank into two ratios, and the
faint rank failed AA on the second one. The visible cost is that a quarterdeck
box is separated from the page by its rule alone.

**The light theme has no counterpart upstream.** brainless's components stay
dark when its site goes light, so there is nothing to copy: every light value
here is a translation, and the ratio beside each one is the only thing keeping
it honest. The captain has kept light mode twice, the second time knowing that.

**`--secondary` and `--term-dim` are the same stop in both themes**, as
`--term-faint` and `--term-rule` are in dark. Two names for one value is what a
neutral palette costs when six roles want a grey; they stay separate tokens so a
palette that later distinguishes them says so once.

## What the repaint found in the tests

Worth more than the repaint that surfaced it.

`tests/fleet-lens.test.ts` counted a lifecycle rail's segments by matching the
string `flex-1 rounded-full` in the markup. Squaring the corners took that count
to **zero on every rail in the suite**, and not one rail had changed - the
panel drew exactly the segments it drew the day before.

The defect is not that the pattern broke. It is what the pattern was: **a test
asserting on styling as a proxy for structure.** How many segments a rail draws
is a claim about the work - four stages, six, an open end where nobody recorded
a length - and the test was reading it out of a corner radius. Those two facts
had no reason to move together, and the moment they came apart the test was
free to be wrong in either direction. It broke loudly here, which is the lucky
case. The unlucky one is a class that survives a restyle: the count keeps
matching, the rails change underneath it, and a green test measures nothing.
It would have gone on passing forever without asserting anything.

The segments now carry `data-rail-segment`, which is the hook convention the
rest of this suite already uses - `data-rail`, `data-stages`, `data-fact`,
`data-lens` - and the test counts that. The fix is three lines. The finding is
that a presentational class had been load-bearing in an assertion about
behaviour, and a repaint is exactly the kind of change that finds them, because
it moves every class and no behaviour at all.

Worth a sweep for the same shape elsewhere in the suite. This pass did not do
one; it changed the rail because the rail is what it broke.

## Where the panel still differs

Named on purpose, after a side-by-side screenshot of both surfaces at 1440×900:

1. **brainless has a sans; quarterdeck has none.** Its docs shell is Geist. The
   panel is 602 mono elements and nothing else - more monospace than the thing
   it is imitating, because it has no docs chrome to set.
2. **Nested grounds**, above.
3. **Per-agent identity hues.** brainless carries three, plus a tokyo-night
   `#c0caf5` inside one block. The panel has one accent, which is what it was
   asked for.
4. **Rail weight.** brainless draws its left rails at 2px; the worker card draws
   its own at 4px. Left alone: this is a repaint, and the 4px edge is a
   prominence decision from the fleet-lens record.
5. **No syntax or diff washes.** brainless's blocks render code with green and
   red diff bands. The panel draws no code, so it has no counterpart and did not
   invent one.
6. **brainless colours a sidebar group label with its accent.** Quarterdeck's
   lens headings are `--foreground`. A change worth considering; not a repaint.

## What this does not cover

Layout, copy, and what any lens shows are untouched. The fold figures in
`docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md` were
re-measured after the repaint and are unchanged.
