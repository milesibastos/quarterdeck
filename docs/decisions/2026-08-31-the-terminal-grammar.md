# The terminal grammar, in quarterdeck's palette

Date: 2026-08-31
Status: accepted. Extends `docs/decisions/2026-08-30-theme-and-palette.md`:
three layers, a palette hop, computed OKLCH. The mechanism below is intact; the
values in it are not the ones it was written against. A repaint on 2026-09-01
moved the whole palette onto brainless's measured neutrals, retired the display
face and the sans, and squared every corner - see
`docs/decisions/2026-09-01-the-brainless-palette-and-one-mono-face.md`, which
this record is updated against rather than left describing a tree that is gone.
Every rank table, ratio and trade-off below is the post-repaint one.

## Context

The panel is a command surface for a fleet of terminal agents and should read
like one. The brainless registry publishes a grok family - nineteen React
components that recreate agent-CLI chrome without giving up web semantics: the
tool line is a real `<details>`, the approval box a real radiogroup with arrow
keys, the status lines `aria-live` regions. Terminal grammar over honest
markup, which is the part worth having.

They are MIT, carry no npm dependency, and cross-reference only each other. The
captain settled three things before any of it landed: adopt one family whole
(grok, the only one shaped like a panel rather than a transcript); keep light
mode working; and where the grammar and the approved wireframe disagree about
layout, the wireframe wins and the disagreement gets written down.

They also ship 22 hardcoded colour values and no theme layer at all. No
variables, no `dark:` variants, nothing to map onto. This project's style rule
forbids a colour value in a component, so converting them was the work.

## Decision

### One family, one new semantic set

The nineteen components live under `src/ui/components/grok/`. Once copied they
are ours; there is no upstream to take updates from.

A `--term-*` set joins the product tokens in `src/app/globals.css`, in the same
spirit as the `--sidebar-*` set already there. The grammar names roles the
product set has no word for: a box rule is not a `--border`, a timestamp is not
`--muted-foreground`, and a terminal box's ground is not `--card` in every place
a card is.

It is not a parallel palette. Every `--term-*` token points at a `--qd-*` stop,
so a palette change is still one edit. The reason it is not simply the existing
`--online` / `--warn` / `--danger` / `--info` is that those are chip fills with
foreground partners, and the grammar wants words on a ground. The gap is
smaller since the repaint than it was - both sets now come off the same
brainless hues - but it is still there: a fill only has to pass against its own
`--*-foreground`, and a word has to pass against the page.

### One ground

`--term-bg` is `--background`, so a terminal box and the page it sits on are the
same colour, its border is what separates them, and every rank below has exactly
one number. grok's own source says the same thing about `#1a1a1a`.

It was `--card` first. In the dark theme `--card` is two stops lighter than the
page, which split every rank in two - `--term-faint` measured 5.0:1 on the page
and 3.7:1 on a card, and the second number failed AA. A box still occludes what
is behind it, because occlusion is opacity and not contrast.

### The ranks

Mapped by the role each value was playing at its usage site, not by hex. grok is
dark-native: its `#e1e1e1` means "ordinary text on the terminal ground" and has
to invert. A per-hex find-and-replace onto a fixed pale grey would have passed
the check below and still been wrong in light, which is the trap in this
conversion.

Since the repaint the dark column is grok's own greys rather than a translation
of them, and it is the light column that is the translation. Both were read back
out of a running browser, in both themes.

| token              | light (on `#ffffff`) | dark (on `#0a0a0a`) | ratio       | replaces                                                    |
| ------------------ | -------------------- | ------------------- | ----------- | ----------------------------------------------------------- |
| `--term-bg`        | `--background`       | `--background`      | -           | `#1a1a1a`                                                   |
| `--term-fg-bright` | `#0a0a0a`            | `#ffffff`           | 19.8 / 19.8 | `#ffffff`                                                   |
| `--term-fg`        | `#171717`            | `#e8e8e8`           | 17.9 / 16.2 | `#e8e8e8` `#e1e1e1` `#cfcfd2` `#d4d4d4`                     |
| `--term-dim`       | `#404040`            | `#c0c0c0`           | 10.4 / 10.9 | `#c0c0c0`                                                   |
| `--term-muted`     | `#525252`            | `#8b8b90`           | 7.8 / 5.8   | `#8b8b90`                                                   |
| `--term-faint`     | `#6c6c6c`            | `#808080`           | 5.3 / 5.0   | `#6c6c6c` `#6a6a6a` `#7a7a7a` `#616161` `#808080` as a mark |
| `--term-rule`      | `#808080`            | `#808080`           | 3.9 / 5.0   | `#808080` as a border                                       |
| `--term-rule-soft` | `#e5e5e5`            | `#2b2b2b`           | 1.3 / 1.4   | `#505058` `#585858` `#2f2f33`                               |
| `--term-selected`  | `#f5f5f5`            | `#1a1a1a`           | 1.1 / 1.1   | `rgba(255,255,255,0.06)`                                    |
| `--term-success`   | `#177a4a`            | `#4ea96f`           | 5.4 / 6.8   | `#00ff00`                                                   |
| `--term-warning`   | `#a16207`            | `#ffb900`           | 4.9 / 11.5  | `#ffff00`                                                   |
| `--term-danger`    | `#c10007`            | `#ff6467`           | 6.4 / 6.9   | `#ff0000`                                                   |
| `--term-info`      | `#0069a8`            | `#74d4ff`           | 5.9 / 11.9  | `#8db0ff`                                                   |
| `--term-accent`    | `#b5563a`            | `#cd694a`           | 4.8 / 5.4   | `#e0af68`                                                   |

Every ratio is against the page, measured in a browser in both themes by
painting the token to a canvas and computing it - not eyeballed, and not taken
from the arithmetic alone, which is what missed the two-grounds problem above.

### The saturated three

`#00ff00`, `#ffff00` and `#ff0000` measure **1.35:1, 1.06:1 and 3.93:1** on a
white page. Two are invisible and one is short. Reusing them in light was never
an option, and neither was tinting them: each is given a real light value at the
same rank and each clears 4.9:1.

The palette they are drawn from is brainless's since the repaint - eighteen
neutral stops, two rust, and two each of green, amber, red and sky, every value
read off `https://brainless.swerdlow.dev/blocks`. Each hue is two stops rather
than one because a contrast floor forces it: brainless's rust `#cd694a` is 5.4:1
on the dark ground and 3.7:1 on white, so the light column takes the darker stop
of each pair and the dark column takes brainless's own value.

OKLCH computed from the hex with the OKLab matrices, hex kept in the comment.
The converter is re-checked against values already in the file before each
palette change, and reproduces them exactly.

### The check

`raw-colour`, in `tests/lib/invariants.ts` beside `provider-bypass` rather than
as an eighth invariant - it guards this decision, not a layer boundary. It
catches a hex, a colour function carrying its own numbers, and Tailwind's stock
palette utilities, in code lines only. Two consequences worth stating: the
stylesheet is not scanned, because that is where the hex is supposed to be; and
`color-mix(in oklch, var(--secondary), ...)` stays legal, because it derives
from tokens rather than carrying a value. Planted tree under
`tests/violations/raw-colour/`.

## Where the wireframe won

The frame - masthead, fleet chooser, keyboard help - was rebuilt in the grammar.
Four places wanted to change the layout and did not.

**The fleet chooser is behind a disclosure.** `GrokProjectPicker` is a real
radiogroup, which is a column where the chips were a line: four fleets cost
**203 pixels of picker against the chips' 48**, and that put the fleet band's
header at 987 on a 900-pixel viewport - below the fold, where the panel before
the grammar had it at 724. The fold is the one thing the wireframe will not
trade: what needs the operator owns the first screen, and underway has to peek
under it. So the full chooser opens on demand, `f` opens it, and the status
line above it names the fleet being read at all times. The cost is a second
click to switch fleets, which is the price of the fold. Measured, not guessed.

**This paragraph was edited on 2026-09-01, and two of its numbers changed.**
Not by a decision revisited: a pass re-measuring the fold figures in
`docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md` found that
this record was where that one's 778 came from, so both had to be checked or
neither was. 203 and 987 survived it and reproduce exactly at the commit that
drew the chooser inline. The chips cost 48 rather than 60. And the sentence
used to read "from 778 to 987": 778 is a position no build of this panel has
ever put that header in - with the disclosure it is 798 with four fleets
configured and 816 with one - so the comparison now names the panel before the
grammar, which is where 724 comes from. The method is written down in that
record.

**The start menu is gone.** grok's launch card lists what its keys do; so does
the help panel, two lines away. Drawing both cost 75 more pixels of first screen
to say one thing twice.

**The keyboard help is inline, not floating.** `GrokShortcuts` is a
`role="dialog"` and grok draws it over the session. A floating overlay needs a
stacking context, a backdrop, a focus trap and a position that survives 360
pixels. A non-modal disclosure needs none of them, and a panel whose job is to
be read loses nothing by leaving the page behind it usable.

**The mark is ours.** `GrokLogo` now takes its 1-bit sprite as a prop and the
masthead passes quarterdeck's sail and deck. The grammar being adopted is the
dot matrix and the shimmer sweep; a product that ships grok's braille mark has
borrowed a logo rather than a grammar.

## Trade-offs

**`--term-accent` and `--term-danger` used to be the same stop**, because
quarterdeck's identity and its destructive colour were both rust. They stayed
two tokens so that a palette which later separated them would only have to say
so once, and the repaint is that palette: the accent is brainless's rust and
danger is its red. The two tokens now hold two values.

**`--term-rule` used to be 2.9:1 in light**, under the 3:1 a bounding line
wants, recorded rather than fixed because fixing it meant a darker rule than the
page had anywhere else. The neutral ramp has that grey: the rule is `#808080` in
both themes now, 3.9:1 light and 5.0:1 dark. The miss is closed.

**Five text ranks where grok has more, and one of them raised.** grok's faintest
grey is `#6c6c6c`, 3.8:1 on the ground it is drawn on. Reproducing it would have
put unreadable timestamps on the page, so the rank was lifted to its `#808080` -
grok's own next grey up, so nothing was invented. That makes `--term-faint` and
`--term-rule` the same stop in dark; grok has the two adjacent as well, its
`#808080` serving as both a border and a marker.

**Six vendored defaults named real repositories under a real home directory**,
which invariant 4 and the synthetic-fixtures rule both forbid. The two that are
props now have none, because the panel always names its own.

**Four other things were fixed rather than carried.** The logo's shimmer was a
full-bleed rect cut to shape by a luminance mask, which needs an opaque white
the theme has no name for - the gradient paints the dots directly now. The
status bar drew its branch mark with U+E0A0, the Powerline glyph, which is in
the private use area and draws as an empty box in every font this project
vendors; U+2387 is the standard one. `usePrefersReducedMotion` set state inside
an effect. And the shortcuts modal's footer claimed four keys the component does
not implement, so the legend became a prop and the panel says what is true of
it.

## What this does not cover

The shipshape strip has since converted - see
`docs/decisions/2026-08-31-the-shipshape-strip-in-the-grok-grammar.md`. The
deck, the landed band and the disclosure bar have since converted too - see
`docs/decisions/2026-08-31-the-reading-surfaces-in-the-grammar.md`, which named
no new token. The needs-you band has since converted as well - see
`docs/decisions/2026-08-31-the-needs-you-band-in-the-grammar.md`. The fleet
lens has since converted too - see
`docs/decisions/2026-08-31-the-fleet-lens-in-the-terminal-grammar.md`. Every
lens now draws in the grammar.
A surface converts against the tokens above; if one wants a role this table
has no word for, the answer is a new token in all three layers of the
stylesheet, not an exception in the component.
