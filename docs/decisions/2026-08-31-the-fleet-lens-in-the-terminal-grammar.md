# The fleet lens in the terminal grammar

Date: 2026-08-31
Status: accepted. Extends `docs/decisions/2026-08-31-the-terminal-grammar.md`,
which is unchanged; this is one of the lenses its closing section listed as
unconverted. It does not change
`docs/decisions/2026-08-31-four-rails.md` or
`docs/decisions/2026-08-31-the-worker-terminal.md` - both still describe what
this lens does, and every sentence they promise is still on screen.

## Context

`src/ui/fleet/` is the densest surface in the panel: eleven or thirty cards,
each carrying a stage, a rail, upstream's own account of what the worker is
doing, four dispatch records, two pointers, a pull request with two forge
readings, the instructions, and a terminal that opens on demand. The grammar
was adopted for exactly this - a worker mid-task is what the grok family draws.

The conversion is a skin. Every string this lens said before it says now, in the
same words, and the tests that pin those words were not touched.

## Decision

### What is composed, and what is only borrowed

The instruction was to compose the vendored components before writing anything
new. Three of them carry this lens's content with props the document actually
holds, and they are mounted:

| Component            | Where                                                              | Why it fits                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GrokEvent`          | the worker's detail line                                           | `◆ <what upstream says it is doing>`. Its `hooks` and `elapsed` are optional and are not passed, because the document has neither.                                                                                                         |
| `GrokTool` (line)    | every pointer, the four dispatch records, the pull request address | a dim verb and a value is exactly the shape of `in <worktree>` and `branch <name>`. The value goes through `children` rather than `path` where it has to carry its own tone - a pointer that stopped resolving, a link that can be opened. |
| `GrokMessage` (user) | the brief's summary                                                | `❯ <what the worker was told>`. An instruction drawn as the prompt it was.                                                                                                                                                                 |

Six were considered and are **not** mounted. Each is refused for the same
reason - it can only be drawn by asserting something the panel does not know -
and that reason outranks the letter of the component map: _no key hint,
affordance or label that does not do what it says._

- **`GrokThinking` and `GrokWorking`.** Both count elapsed time from the moment
  they mount, so a card opened five minutes ago would claim a worker has been
  thinking for five minutes. `GrokWorking` additionally defaults a token count
  and draws a `[stop]` control, and this panel stops nothing. Neither has a prop
  that suppresses any of it.
- **`GrokThought`.** Its label is either `Thought for <elapsed>` or `Thinking…`.
  The document carries no per-step duration and no claim that a worker is
  reasoning right now; the projection reads a _step name_ out of upstream's
  prose, which is a much weaker thing. Drawing "Thought for 0.2s" over it would
  be inventing the number the component exists to show.
- **`GrokTurnEnd`.** "Turn completed in 8.0s." There is no turn duration
  anywhere in the document, and a worker's `observedAt` is when it was last
  seen, not how long it took.
- **`GrokPlan`.** The closest shape to the rail, and unusable as a mount: it
  hardwires an action row - `a approve | s request changes | c comment | q quit
plan` - a `[↗]` open mark that opens nothing, and a composer in plan-approval
  mode. None of them is behind a prop. Mounting it would put four keys on every
  worker card that do nothing, which is the defect this project exists to
  prevent. Its _frame_ is borrowed instead: the rail is drawn as a bordered box
  with a `─ <name>` head, in this directory's own markup.
- **`GrokSessionActive`.** Takes no props at all; it is a canned transcript
  about a theme toggle. There is nothing to give it.
- **`GrokWrite`.** Before/after diff chrome with `before:` and `after:`
  announced to assistive technology. A pane capture is neither half of a diff,
  and labelling fifteen lines of a worker's output "before" would be a lie told
  only to screen readers.

The vendored components may not be edited - the foundation owns them, and three
other lenses are being converted against the same copies - so the honest end of
this is: mount what is true, and draw the rest in the grammar's own alphabet
(`◆ ✓ ✗ ❙ ─`, the `--term-*` ranks, mono at 13px, a box on the page's ground)
inside `src/ui/fleet/`.

### The card is a terminal box on the page's ground

`Card` is gone from the worker card. The box is `--term-bg` with a
`--term-rule` outline, which is the ruling the grammar was adopted under: every
rank in the `--term-*` table was measured against the page and against nothing
else, and a box painted `--card` in the dark theme puts those ranks on a ground
two stops lighter than the one they were measured on.

The left edge stays: four pixels, stage-toned, and dashed - along with the rest
of the outline - for a worker that has left the track.

### The stage is a marked word, not a filled pill

A pill needs a ground, and a ground needs its own contrast budget. The grammar
puts words on the terminal ground, so the chip became `◆ VALIDATING`: a glyph,
then the same word in the stage's tone. Shape and hue, which is the same
two-channel signal the pill carried, with one ground fewer to measure.

Five glyphs: `◆` on the track, `◇` not started or not seen, `✓` finished, `✗` a
fault, `❙` stopped without failing. Four of them are already drawn by the
vendored components. `◇` is not - it is the one codepoint this lens introduces,
and it was checked on screen in both themes rather than assumed, which is the
check U+E0A0 failed when the frame was converted.

### The one place this lens does not take the grammar's palette

**The stage tones are the panel's own status tokens, not `--term-*`.** This is
deliberate and it is countable.

The terminal set has four saturated stops, and `--term-accent` is _the same
stop_ as `--term-danger` - the trade-off the foundation already recorded. The
panel needs five: `working`, `pr-open`, `held`, `waiting` and `failed` all want
a hue, and `blocked` and `landed` want a fifth. A stage vocabulary drawn from
`--term-*` alone would paint `blocked` exactly like `failed`, and the whole
point of the four off-track tones is that only one of them is an alarm.
`--secondary` is the fifth tone, which the terminal set has no word for at all.
It was navy; the 2026-09-01 repaint moved it onto the neutral ramp, where it
measures **10.4:1 light and 10.9:1 dark** as text on the page and reads as the
receded thing a landed or blocked stage is. See `docs/decisions/2026-09-01-the-brainless-palette-and-one-mono-face.md`.

The two obligations are split where the contrast rule needs them split:

- **The word** takes a rank that passes as text. `--warn` is the pale amber a
  chip fill wants, so `held` reads in `--term-warning` - the same hue at the
  stop that passes as text, 4.9:1 light and 11.5:1 dark - and `waiting` in
  `--term-info`.
- **The edge and the pip** take the status token. Neither carries a contrast
  obligation, because nothing has to be read out of a four-pixel rule or a
  six-pixel dot; they are the redundant channel, and `docs/quality.md` already
  records that rule for the checks pip.

`tests/fleet-lens.test.ts` asserts the four off-track states carry four distinct
`border-l-*` classes. That assertion is about a behaviour - four tones for four
states - and it survives, which is the point; it is not the reason for the
decision, and the argument above stands without it.

### Where the wireframe won

**The rail is still a horizontal track, not a numbered column.** `GrokPlan`'s
list grammar - one numbered row per step - is a better _reading_ of a rail, and
it is six rows tall. The card's proportions are the wireframe's, this band peeks
under the fold rather than owning it, and eleven cards each six rows taller is a
different page. So the rail borrows the frame and the `─ <name>` head and keeps
its own track: pips for the shape, and the sentence underneath for everything
the pips say.

**The rail's honesty is unchanged, to the character.** The framed box is solid,
never dashed - dashed is this rail's own word for an end nobody promised, and a
dashed frame would say that about every rail on the page. A stop with nothing to
place it by still says `position not known`. A rail whose length nobody recorded
still draws only how far the worker got, plus one dashed open end, and still
says which of the two reasons it has. The two sentences are still the whole of
what the rail claims; the track is still `aria-hidden`.

**The head is new, and it is a fact from dispatch.** `─ validated delivery`,
`─ local delivery`, `─ an investigation`, or `─ rail not known`. It names the
rail being drawn, from the same table the sentence below already used, so there
is still one spelling of a delivery contract in the panel. Previously the panel
only named the contract when it was missing.

### The terminal is unchanged below the skin

`docs/decisions/2026-08-31-the-worker-terminal.md` still holds in full: a closed
card is one `<details>` element and no read at all, nothing is fetched on the
first paint, the disclosure is native and React never sets `open`, the lines
live in the client island's state so a refresh leaves them where the reader left
them, and ligatures stay off in the box. What changed is the box - a
`--term-rule` outline on the terminal ground rather than a muted fill - and the
ranks around it. The three absences are still three sentences.

## Trade-offs

**A worker card no longer looks like a card.** It is a box on the same ground as
the page, separated by a rule that measures 2.9:1 in the light theme - the
foundation's own recorded trade-off for `--term-rule`. It reads correctly in
both themes, checked in a browser at 1440 and 360, but it is a quieter
separation than the ring the card had.

**Three glyphs carry two stages each.** `◆` is on-track and `❙` is stopped, so
`working` and `validating` share a mark, as do `blocked`, `held` and `waiting`.
The word beside it is different in every case and the tone is different in all
but one; the glyph is the coarse channel, not the whole answer.

**`blocked` and `landed` share a tone.** They did before this change too. They
have different glyphs, different words, and one of them is on the track.

## Verified

- `npm test` 463/463 green, which includes `tests/fleet-lens.test.ts`,
  `tests/terminal.test.ts`, `tests/width.test.ts` and `tests/invariants.test.ts`
  with its `raw-colour` check. `npm run lint` clean.
- Driven in a browser against the built server, in both themes, at 1440 and at
  360 CSS pixels: no sideways overflow at 360, the brief and the terminal both
  open, and the terminal reads its tail on the first open and not before.
