# The terminal grammar, in quarterdeck's palette

Date: 2026-08-31
Status: accepted. Extends `docs/decisions/2026-08-30-theme-and-palette.md`,
which is unchanged: three layers, a palette hop, computed OKLCH.

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
foreground partners, and the grammar wants words on a ground: `--warn` is
gold-600, which measures 3.2:1 as text on the light page.

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

| token | light | dark | ratio | replaces |
| --- | --- | --- | --- | --- |
| `--term-bg` | `--background` | `--background` | - | `#1a1a1a` |
| `--term-fg-bright` | ink-900 | white | 14.3 / 16.5 | `#ffffff` |
| `--term-fg` | ink-700 | paper-100 | 10.6 / 14.3 | `#e8e8e8` `#e1e1e1` `#cfcfd2` `#d4d4d4` |
| `--term-dim` | ink-600 | paper-300 | 7.6 / 11.7 | `#c0c0c0` |
| `--term-muted` | ink-500 | cream-line | 5.3 / 10.2 | `#8b8b90` |
| `--term-faint` | ink-400 | ink-300 | 4.7 / 5.0 | `#6c6c6c` `#6a6a6a` `#7a7a7a` `#616161` `#808080` as a mark |
| `--term-rule` | ink-300 | ink-300 | 2.9 / 5.0 | `#808080` as a border |
| `--term-rule-soft` | cream-line | ink-500 | 1.4 / 2.7 | `#505058` `#585858` `#2f2f33` |
| `--term-selected` | paper-300 | ink-700 | 1.2 / 1.4 | `rgba(255,255,255,0.06)` |
| `--term-success` | sea-500 | sea-200 | 5.4 / 10.6 | `#00ff00` |
| `--term-warning` | gold-700 | gold-300 | 4.9 / 11.5 | `#ffff00` |
| `--term-danger` | rust-600 | rust-300 | 5.4 / 6.1 | `#ff0000` |
| `--term-info` | ocean-600 | ocean-200 | 5.3 / 10.8 | `#8db0ff` |
| `--term-accent` | rust-600 | rust-300 | 5.4 / 6.1 | `#e0af68` |

Every ratio is against the page, measured in a browser in both themes by
painting the token to a canvas and computing it - not eyeballed, and not taken
from the arithmetic alone, which is what missed the two-grounds problem above.

### The saturated three

`#00ff00`, `#ffff00` and `#ff0000` measure **1.35:1, 1.06:1 and 3.93:1** on the
light page. Two are invisible and one is short. Reusing them in light was never
an option, and neither was tinting them: each is given a real light value at the
same rank, from the product's own palette, and each clears 4.9:1.

Three palette stops were added and no more, each because a measured gap needed
one:

- `--qd-ink-600` `#574734` and `--qd-ink-400` `#78654e` - the light theme had
  three legible greys where the grammar wants five ranks of text.
- `--qd-gold-700` `#8a5c14` - the darkest existing gold measures 3.2:1 as text
  on the light page.

OKLCH computed from the hex with the OKLab matrices, hex kept in the comment,
as the existing thirty-four are. The converter was checked against the file's
own values first: it reproduces all of them exactly.

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
**203 pixels of masthead against the chips' 60**, and that pushed the fleet
band's header from 778 to 987 on a 900-pixel viewport - below the fold. The
fold is the one thing the wireframe will not trade: what needs the operator owns
the first screen, and underway has to peek under it. So the full chooser opens
on demand, `f` opens it, and the status line above it names the fleet being read
at all times. The cost is a second click to switch fleets, which is the price of
the fold. Measured, not guessed.

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

**`--term-accent` and `--term-danger` are the same stop.** grok's brand amber
wears the product's identity colour, and quarterdeck's identity and its
destructive colour are both rust. `--primary` - rust-500, the obvious choice -
measures 4.3:1 as text on the light page, so the accent takes rust-600, where
danger already is. They stay two tokens so a palette that later separates them
only has to say so once.

**`--term-rule` is 2.9:1 in light**, under the 3:1 a bounding line wants. It is
twice what `--border` gives the rest of the panel, and a box here is legible
without its rule - the rule is grammar, not the message. Recorded rather than
fixed; fixing it means a darker rule than the page has anywhere else.

**Five text ranks where grok has more, and one of them raised.** grok's faintest
grey is 3.0:1 on its own ground. Reproducing it would have put unreadable
timestamps on the page, so the rank was lifted rather than copied. Below
`--term-faint` the ink ramp reaches 2.7:1 in dark, so `--term-faint` and
`--term-rule` share a stop there; grok has the two adjacent as well, its
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

The needs-you band, the fleet lens, the deck, the landed band and the
disclosure bar are unconverted. (The shipshape strip has since converted -
see `docs/decisions/2026-08-31-the-shipshape-strip-in-the-grok-grammar.md`.)
An unconverted lens under a converted frame is the expected intermediate
state. They convert against the tokens above; if one of them wants a role
this table has no word for, the answer is a new token in all three layers of
the stylesheet, not an exception in the component.
