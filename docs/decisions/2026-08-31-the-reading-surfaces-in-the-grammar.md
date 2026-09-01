# The deck, the landed band and the disclosure bar, in the terminal grammar

Date: 2026-08-31
Status: accepted. Extends `docs/decisions/2026-08-31-the-terminal-grammar.md`,
which named these three surfaces as unconverted and said how they would convert.
The tokens, the ranks and the raw-colour check are unchanged.

## Context

The frame converted first: masthead, fleet chooser, keyboard help. These three
are what is underneath it, and they are the part of the adoption with no
ready-made component. grok's nineteen are chrome for an agent turn - a status
bar, a tool call, a write preview, an approval box. None of them is a table, a
pile of work items, or an account of what a page is not showing.

Three rulings governed the conversion: adopt grok whole and import from no other
family; keep light mode correct; and where the grammar and the approved
wireframe disagree about layout, the wireframe wins and the disagreement is
written down. This is that writing down.

## Decision

### Four marks carry all three surfaces

The grammar these surfaces needed was already in `grok-event`, `grok-tool` and
`grok-write`, and it comes to four marks:

| mark  | where it came from                                | what it says here                        |
| ----- | ------------------------------------------------- | ---------------------------------------- |
| `◆`   | `grok-event`, `grok-tool` card                    | a thing, or something that happened      |
| `┃`   | `grok-tool` card, `grok-write`, `grok-permission` | this hangs off the line above it         |
| `[…]` | `grok-plan`'s action row, `grok-shortcuts`        | a count, a rank, a press                 |
| `─`   | `grok-plan`'s file frame                          | the top edge of a box, carrying its name |

Nothing else was invented. A deck row is the `┃` gutter with a `◆` at its head,
which is exactly `grok-tool`'s card. A pile heading is the same `◆` one rank up.
Every sentence a lens writes about its own read - how old the picture is, what a
failed read cost, what an empty list means - is a `GrokEvent`, because each of
them is an event: something that happened to the read, said in the order it
happened. The disclosure bar is `grok-plan`'s framed box with its name in the
top edge, kept dashed.

### Colour says one thing per row, and only where it is a fact

The deck's rail is the one place colour carries meaning, and it carries the same
five it always did, re-pointed at `--term-*`:

| the row                             | rail               | why                                       |
| ----------------------------------- | ------------------ | ----------------------------------------- |
| a decision that can be answered now | `--term-accent`    | the only thing here a person can act on   |
| a hold deferred to a date           | `--term-rule-soft` | still waiting on a person, but not urgent |
| blocked                             | `--term-warning`   | something is in its way                   |
| in flight                           | `--term-info`      | the fleet has it                          |
| queued                              | `--term-rule`      | nothing is wrong with it                  |

The `◆` at the row's head takes the rail's own hue and nothing else on the row
competes with it. The priority moved from a filled pill to `[now]` / `[next]` /
`[later]` in three ranks of text rather than three hues, for the reason the
frame's trust word moved the same way: a `later` badge drawn as loudly as a
`now` one is the lie these surfaces exist to avoid, and weight carries the three
steps where colour would have needed a fourth token.

`--term-accent` and `--term-danger` are the same stop, which the terminal
grammar records and accepts. Nothing on these three surfaces draws a danger
rail, so the two are never on screen together and never have to be told apart.

### The landed band takes the marks but not the tick

grok marks a finished thing with a green `✓`, and this band draws nothing but
finished things. It does not use it. Every row is the same resting box with the
same faint `◆`, because a wall of green ticks under the deck would be the
loudest thing on a page whose first screen is meant to own the operator's
attention - and `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`
settled that everything below the fold yields. The marks are grok's; which of
them a purely retrospective band is entitled to use is the band's own judgement.

grok's `✓` and `✗` do appear, in the answer control's two outcomes and nowhere
else: something did just happen there, and a person is waiting to be told which
of the two it was.

## Where the wireframe won

**The grids stayed grids.** grok is a single-column transcript: every one of its
nineteen components is a full-width line in a stream. All three of these
surfaces are `card-grid` - `auto-fill` over a fixed minimum, so a wide monitor
buys more cells at the size they were designed at. Converting them to a
transcript would have thrown that away and made the deck four times taller,
which moves the fold. The wireframe wins: the cells keep their grid and the
grammar is applied inside them. This is the largest disagreement in the
conversion and the one the ruling was written for.

**The pile heading is an `h3` and not a `GrokEvent`.** `GrokEvent` takes its
label as a string and renders it in a `span` inside a `div`, and a heading may
not wrap a `div`. Drawing a pile's name as anything but a heading would leave
the page's outline skipping from the band's `h2` straight to a row's `h4`, which
costs every reader navigating by heading their way into the deck. So the mark
and the rhythm are grok's and the element is the document's - six lines,
recorded rather than smuggled. The same applies to the disclosure bar's three
reason headings and to the bar's own `h2`.

**The answer control did not become `GrokPermission`.** The obvious component is
there: a `┃` gutter, a real radiogroup, arrow keys. It is the wrong shape. This
control's two buttons each submit on the press, and that is accepted behaviour -
the fleet's answer intake takes a close mode and a channel may only carry what
its card declared, so the press _is_ the declaration. A radiogroup would make it
select-then-confirm, which is a behaviour change wearing a reskin's clothes. The
buttons became bracketed terminal buttons and the form semantics stayed.

**No key hints were added anywhere.** `grok-plan` heads its approval card with
`a approve | s request changes | c comment | q quit plan`, and it is the most
inviting thing in the family. Nothing on these three surfaces answers to a
letter, so nothing on them shows one. A legend that promises what the surface
does not do is the defect this project exists to prevent.

## Trade-offs

**Text got denser, and every detail line is indented under its mark.** Mono at
13px with a 12px detail rank, against the product's 14px sans over an 11px mono,
and each row's detail now hangs under the title rather than starting at the
rail. The indent is what makes the `◆` read as the head of a block instead of a
bullet, and it costs a column of width: in a 26rem grid cell the longest work
item ids now wrap where they used to fit on one line. Recorded because it is a
real change to how much fits on a screen, not a neutral reskin.

**The `┃` rail is 2px of a 2.9:1 rule in light.** Inherited from the terminal
grammar's own recorded trade-off, and it is louder here than anywhere else,
because the deck draws one per row. The rail is grammar, not the message: every
row says its state in words on the line below the title.

**The disclosure bar's dashed rule is faint in light.** Same stop, same reason.
It was kept dashed deliberately - a box drawn around what is _not_ here should
not be the same box the lenses draw around what is - and the alternative was a
darker rule than the page has anywhere else.

**`LensFrame` is still the product's chrome.** Deck and landed render inside it,
so a grok body sits under a `font-display` header on a `Card`. The frame is the
foundation's file and not this change's to touch. An unconverted frame around a
converted body is the expected intermediate state, the same way an unconverted
lens under a converted frame was.

## What this does not cover

The shipshape strip. The needs-you band has since converted too - see
`docs/decisions/2026-08-31-the-needs-you-band-in-the-grammar.md`; it drew its
decisions through `DeckItemRow`'s card tone at the time of this change, which
converted with the deck, but it now draws its own `DecisionCard` instead.
