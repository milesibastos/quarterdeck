# The needs-you band in the terminal grammar

Date: 2026-08-31
Status: accepted. Extends `docs/decisions/2026-08-31-the-terminal-grammar.md`,
which is unchanged. Leaves
`docs/decisions/2026-08-30-answering-a-held-decision.md` and
`docs/decisions/2026-08-31-ordering-a-merge.md` untouched: this is a skin, and
the two write paths are byte-for-byte what they were.

## Context

The grammar landed on the frame - masthead, fleet chooser, keyboard help - and
named the lenses under it as the expected unconverted intermediate state. This
converts the first of them, and it is the one that acts: the band offers a real
answer control on every decision held for a person and a real merge control on
every pull request that is ready to land. The captain's ruling of 2026-08-29
stands - v1 acts, it does not only show - so nothing here may become decoration.

## Decision

### The band draws its own decision card

`src/ui/needs-you/decision-card.tsx` and `src/ui/needs-you/answer-control.tsx`
are new, and the band no longer draws `DeckItemRow` in its `card` tone or the
deck's `AnswerControl`.

Not a preference. The deck lens is being converted by someone else at the same
time, and a band that reaches into `src/ui/deck/` to restyle a shared component
lands its change in that work. The thing that actually has to be shared is the
fold - `src/ui/needs-you/needs-you.ts`, untouched - which is what makes "a deck
row drawn by neither band" unwriteable. The drawing was never the guarantee.

What is copied rather than shared is the answer request: the same body, the same
`since ?? ""` identity, the same three outcomes, the same sentences. It still
takes the deck's `AnsweringSession` type, because the composition point mints one
address and hands it to both bands. Two copies of one POST is the price of the
ownership boundary and is written down here so the next pass can collapse them
deliberately rather than notice them by accident.

### The chooser, not the approval card - and the approval card's legend, fixed

The obvious component was `GrokPermission` - grok's left-border approval box
with `(●)` / `(○)` radios. Two things were wrong with reaching for it.

The first was a false legend, and it is now fixed rather than worked around. Its
footer hard-coded `1/3:select │ Ctrl+o:yolo │ Ctrl+c:cancel` and the component
implements none of those three; what it binds is the arrow keys and Enter or
space. So the legend became a prop defaulting to `↑/↓ nav · Enter/Space select`,
the treatment `GrokShortcuts` and `GrokSettings` already carry - a host that has
genuinely wired a key says so, and one that has not inherits no claim. The keys
were deliberately not implemented to make the old label true: building behaviour
to justify a label is the same defect wearing the other hat. Upstream's live
`2/3` count went with the footer, because it sat where the number keys were
named and read as one of them; the `(●)` in the list above says which row is
selected without claiming a binding.

The second is mechanical and stands: `GrokPermission`'s options are bare
strings, so a row cannot carry the `data-close-mode` that says which close the
fleet was asked for. `GrokProjectPicker` is the same grammar - left rule,
numbered radios, arrow keys, honest hint line - and it already spreads per-row
`data`. So the two closes are drawn by the chooser. Driven in the running panel:
arrow keys move the selection without sending, Enter on the second row wrote one
record to the spool.

The boundary around `src/ui/components/grok/` was lifted for that one file, on
the day, because no other lens draws it - only the vendored `GrokSession`
showcase, which no route renders.

### The composer's chrome over a textarea

`GrokPrompt` is the grammar's text box and is a single-line `<input>`. An answer
is recorded verbatim in the operator's own words and has to be able to run to
more than one line, so it is not used: the box wears the composer's chrome - the
`❯` caret, the soft rule, the legend punched into the bottom edge - over the
`<textarea rows={2}>` that was already accepted. A reskin that shortened the
answer field would have made the panel able to carry less than it did.

The legend sits on the left edge rather than grok's right. A box that can be
dragged taller puts its resize grip in the bottom-right corner, and two things
in one corner is one of them unreadable. Measured by looking at it.

### The merge control is a button

The decision card offers two closes, which is a choice, and the chooser draws
it. The merge card offers one act. A radiogroup of one row would carry a hint
line promising arrow keys with nowhere to move, so it is the bordered action
button the frame already uses to open its fleet chooser - the same grammar at
the size a single act deserves, and without the `[key]` bracket, because there
is no binding that presses it from anywhere on the page.

### A refusal said out loud, where a disabled button used to be

The two closes used to be `<Button disabled>` while the answer box was empty.
The rows of a radiogroup cannot be disabled one at a time, so choosing a close
over an empty box now says `Type an answer first - nothing was sent.` in a
`role="alert"`. A control that silently does nothing is the same broken promise
as a key hint that does nothing; this is the smaller of the two changes and the
honest one.

### One ground

The cards lost `bg-card` and their ring and became `border-l-2 … pl-3` gutters
over the page's own colour, which is what `--term-bg: var(--background)` already
decided. The gutter carries the state: `--term-accent` for a decision that can
be taken now, `--term-rule` for one deferred to a date, `--term-success` for a
pull request whose checks somebody read and they passed, `--term-danger` for the
two absences that might be ignorance. The priority chip became the grammar's
bracketed meta - `[now]`, `[next]` - because a filled pill is a second visual
language on a card that has no fills anywhere else.

No new token was needed. Every colour on these surfaces resolves to a `--term-*`
stop already in the table.

## Where the wireframe won

**The layout did not move.** Same `card-grid` at `[--qd-card-min:24rem]`, same
two groups in the same order - decisions, then merges, because a question nobody
has answered is holding work up and a green pull request is not - same
`md:min-h-[62svh]` reserve from the shell, same pinned header and the same
counts in it. The band's visible slack is still the feature, and an under-filled
band still shows the room it is not using.

**The nested gutter stayed nested.** The chooser draws its own left rule inside
the card's, so an answerable decision has two rules at two indents. grok nests
gutter cards the same way, and the alternative - stripping the chooser's rule -
would have been keeping the component and throwing away the grammar that was the
reason for taking it.

## Trade-offs

**Two copies of the answer POST**, as above. The deck's copy is now dead code as
far as the page is concerned - no answerable item reaches the deck lens - but it
is that directory's to remove.

**`DeckRowTone`'s `card` tone has no caller left**, and its doc comment still
says the needs-you band draws its decisions with it. Both are in
`src/ui/deck/deck-row.tsx`, which this task does not own. Reported rather than
fixed.

**The band and the deck can now drift.** They draw the same item's identity line
from two files. The line is pinned by `tests/panel.test.ts`, which reads it
without caring which band drew it, so a drift that changes the words fails; a
drift that changes only the styling will not.

All three of the above were the next pass this section asked for, and it has
since happened: the deck's dead `AnswerControl` and `DeckRowTone` are deleted,
`AnsweringSession` moved to `src/ui/lib/answering.ts`, and the identity line is
`src/ui/lib/item-identity.tsx`, called from both surfaces. See
`docs/decisions/2026-08-31-what-the-parallel-lens-build-duplicated.md`.
