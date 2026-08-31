# What the parallel lens build duplicated, and what was left alone

Date: 2026-08-31
Status: accepted

## Context

qlty was configured in [PR #29](https://github.com/milesibastos/quarterdeck/pull/29)
to measure the two things nothing else here measures - duplication and
complexity - and it has never been run as a gate. It is about to become one, and
a gate that is red the day it lands is ignored within a week. So the house gets
clean first.

The findings were expected. Four workers built the five lenses in parallel
behind exclusive source directories: that kept them from colliding, and it also
meant that when two lenses needed the same idea, neither could see the other's
copy. `src/ui/needs-you/answer-control.tsx` and `src/ui/deck/answer-control.tsx`
were 26 lines identical because two people solved the same problem the same way
a day apart. That is the cost of the fan-out, paid here.

The baseline on `main` at c2d0aca was 25 printed entries, which is 21 distinct
findings once each duplication pair is counted once rather than once per file:

| Kind                                           | Distinct | Printed |
| ---------------------------------------------- | -------- | ------- |
| duplication (`identical_code`, `similar_code`) | 6 pairs  | 10      |
| `function_complexity`                          | 4        | 4       |
| `return_statements`                            | 10       | 10      |
| `file_complexity`                              | 1        | 1       |

### Four shapes the task brief did not carry

The brief that commissioned this work named five duplication pairs and a
complexity set, and the run found more than that. The difference is recorded
here rather than absorbed silently, because it is worth knowing before the next
fan-out:

1. **`function_complexity` was never named as a category.** The brief filed
   `fleet-picker.tsx`, `keyboard-help.tsx` and four grok components under
   "function with many returns (count = 6)". Four of those actually fired on
   `function_complexity`, a different smell at a different threshold:
   `GrokProjectPicker` 34, `GrokSettings` 24, `KeyboardHelp` 33,
   `FleetPicker` 19.
2. **`FleetPicker` has no returns finding at all** - only the complexity one.
3. **`KeyboardHelp` returns at 7, not 6**, so it would have survived the
   threshold raise that clears the rest.
4. **`AnswerControl` in `src/ui/needs-you/answer-control.tsx` returns at 6** and
   was not on the brief's list.

The dispositions are unchanged by this: the two grok components are covered by
the vendored exclusion, `KeyboardHelp` and `FleetPicker` by the nested-closure
exclusion, and `AnswerControl` by the `return_statements` raise. Only the
accounting was short.

What follows is the disposition of each finding, on its merits.

## Fixed

### The two answer controls were not duplicated. One of them was dead

The largest finding in the repository - 26 lines identical, mass 139 - is
resolved by deleting one side rather than extracting a shared helper, because
the deck's copy could never render. The proof is three steps:

- `DeckItemRow`'s only caller is `DeckLens`, which draws `needsYou(...).rest`.
- `rest.held` is `groupDeck`'s `held` pile with every `isAnswerable` row
  removed, and the other three piles all require `hold === null`.
- The control sat behind `hold !== null && isAnswerable(item)`. No row reaching
  that component could satisfy both clauses.

Extracting a shared POST helper would have given a dead caller a home. The
needs-you band's control is now the only one, which is what its own header
comment had already claimed.

The same argument retires the rest of that file's second surface. `DeckRowTone`,
`TONE`, `HEADING` and the `session` prop existed for the needs-you band, which
grew its own `DecisionCard` and stopped calling them; `tone="card"` had no
caller at all. The deck row now has one surface and one heading level, so there
is no second prop to disagree with the first.

`AnsweringSession` moved to `src/ui/lib/answering.ts`. Six files import it and
only one of them was the deck. A shared type owned by one lens directory is the
defect this pass exists to remove, not to relocate.

### The identity line is one sentence, and now there is one copy of it

The age/state/project/kind/id line under a deck row and under a decision card
was 15 similar lines in two locations (mass 100), with byte-identical copies of
`STATE_WORDS` and `KIND_WORDS` beside them. Both files carried a comment saying
the sentence had to stay the same in both places, and nothing but memory made
that true.

`src/ui/lib/item-identity.tsx` is that mechanism. The two surfaces keep what
they were actually entitled to differ on - the rank the named parts sit at
(`emphasis`) and where the line is indented to (`className`) - and neither
changes what is said. Both call sites render the same DOM as before.

## Kept, with the reason

Two duplication findings still print. Both are the same judgement: the shape is
shared, the substance is not, and an extraction would pass 100% of the substance
back in as props.

### `Blocked by`, deck row against decision card (mass 85)

`src/ui/deck/deck-row.tsx` and `src/ui/needs-you/decision-card.tsx` draw the
same three things - a heading, a list, an optional reason - around two
deliberately different leaves. The deck's `BlockerLine` is `grok-tool`'s compact
line: blue, `break-all`, the grammar's shape for a thing named by its
identifier. The card's is two spans at the card's own ranks. Converging them is
a reskin of one lens or the other, which this pass is explicitly not doing.

What is left to extract is a heading, a `<ul>` and a paragraph - reachable only
by passing the blocker renderer in as a prop plus two class names. Six props for
ten lines of chrome is a worse artefact than the duplication.

### `NothingOmitted` against `NothingLanded` (mass 86)

`src/ui/disclosure-bar.tsx` and `src/ui/landed/landed-lens.tsx` each answer the
same question - is this empty because nothing is there, or because the read
failed? - and the answer is four bespoke sentences about four different
subjects. The wrapper they share is a `div`, a data attribute and a `GrokEvent`.

There are four of these empty states in the panel, not two: `NothingNeedsYou` in
the band is a much larger custom shape, and `EmptyDeck` has a third branch and
no wrapper element. An extraction here would serve two of four siblings, and the
two it did not serve would be the argument against it. The distinction each one
draws is the panel's central honesty rule, and it is worth four careful
sentences more than it is worth one parameterised one.

## Excluded, with the reason

`.qlty/qlty.toml` carries the full reasoning beside each pattern. In summary:

| Pattern                                               | Findings                               | Why                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/ui/components/grok/**`                           | 2 duplication, 2 complexity, 2 returns | Vendored from brainless and re-tokenised; editing them forks upstream.                                                        |
| `src/adapters/health.ts`                              | file complexity 86, 1 returns          | The quarantined module. Invariant 4 confines fleet-internal paths to it, and the complexity is in the half that cannot leave. |
| `src/ui/keyboard-help.tsx`, `src/ui/fleet-picker.tsx` | 2 complexity, 1 returns                | qlty folds nested closures into the component that declares them, which measures the React idiom rather than these files.     |

Two things were established by experiment rather than assumed, and are recorded
here so nobody repeats them:

- **There is no per-path threshold.** An `[[overrides]]` block parses and is
  silently ignored. `[[ignore]]` works but the CLI warns that it is deprecated,
  and `[[exclude]]` requires a `plugins` field this project has no use for.
  `exclude_patterns` is the mechanism, and a file named there leaves
  `qlty metrics` as well as `qlty smells`.
- **The inline `qlty-ignore` comment does not apply to smells.** The directive
  exists - the binary parses it - but only in the linter pipeline. Four
  spellings were tried against `KeyboardHelp` and none suppressed anything.

### Why health.ts is excluded rather than bought with a threshold

It is the only file over the file-complexity threshold, at 86 against 50, and
the temptation is to raise the number. That was rejected on a measurement.

Split at the file's own seam - the `health.json` parser above the
`the fleet home` divider, the fleet-home readers below it - the parser half
falls to 16 and the reader half stays at 71. The half carrying the complexity is
the half in which every function names a fleet-internal path, and invariant 4
confines those to one file. The only edit that clears the finding is the one
`npm test` refuses.

Raising `file_complexity` from 50 to clear 86 would let `src/domain/project.ts`,
at 46 today, nearly double before the check said anything. One file's exclusion
is cheaper than eighty-two files' threshold.

## Raised

`return_statements`, from qlty's default of 6 to 7. The only threshold in the
file that is not qlty's own, and `.qlty/qlty.toml` says so where it used to
claim none had been loosened.

A smell fires at the threshold, not past it, so 6 flagged every function with
exactly six returns. Measured against these six:

| Function                          | File                                   |
| --------------------------------- | -------------------------------------- |
| `keyedAnswerLine`, `submitIntent` | `src/adapters/intent.ts`               |
| `read`                            | `src/adapters/terminal.ts`             |
| `recheck`                         | `src/app/api/act/[...intent]/route.ts` |
| `ago`                             | `src/ui/lib/age.ts`                    |
| `AnswerControl`                   | `src/ui/needs-you/answer-control.tsx`  |

Four are refusal ladders: one early return per distinct reason to refuse, each
carrying the sentence an operator reads when it fires. `ago` is a ladder of
units. Nesting any of them to reach five returns would hide which refusal a
reader is looking at, which is the one thing these functions exist to make
obvious. Seven is the smallest number that clears the six and still fires on a
seventh branch nobody planned.

## Consequences

`qlty smells --all` prints four entries - the two kept pairs, each reported once
per file - and both are named above with their reason.
Everything else is fixed or excluded with the reason written where the exclusion
is. That is the state `qd-qlty-complete-h1` needs in order to make this a gate.

The cost is that four files no longer appear in `qlty metrics` either -
`src/adapters/` reads 424 LOC lighter than it is, and `src/ui/` two files
lighter. The per-directory table is a rough guide rather than a census, and this
record is where to look when a number there seems small.

Nothing the panel draws changed. Every deletion was of code proven unreachable,
and the one extraction renders the same DOM at both call sites; the five lenses
were checked in the running panel, in light and dark, rather than by reading the
diff.

## See also

- `docs/decisions/2026-08-31-measuring-duplication-and-complexity.md` - why qlty
  is here at all, and why it has no plugins.
- `docs/decisions/2026-08-31-the-terminal-grammar.md` - what vendoring the grok
  family did and did not license.
- `docs/ARCHITECTURE.md` - invariant 4, the path quarantine.
