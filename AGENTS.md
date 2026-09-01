# quarterdeck

A local command panel giving its operator visibility into a running firstmate
fleet: what needs them personally, what is running (fleet), what is queued or
stuck (deck), and whether the machinery is healthy (shipshape). The needs-you
band owns the first screen and offers an answer control on each decision held
for a person and a merge card on each pull request that is ready to land; the
fleet lens draws a worker card and lifecycle rail, the deck lens draws what the
fleet is handling by itself, the landed band draws what finished and which
home finished it, and the shipshape lens draws the five health signals and the
designed dark state. A disclosure bar closes the page, naming every absence
the document declares and which of three reasons it has, derived from the
document rather than written by hand - see
`docs/decisions/2026-08-31-landed-work-and-the-disclosure-bar.md`. All of them
sit over a pinned document shape, filled from a configured fleet home or from
synthetic fixtures when there is none. The operator picks which of the
configured fleets they are looking at, and their browser remembers it.

The panel is drawn in a terminal grammar - the grok family from the brainless
registry, vendored under `src/ui/components/grok/` - in brainless's own measured
palette, one monospace face, and square corners. No component may carry a colour
value; `npm test` enforces it. See
`docs/decisions/2026-08-31-the-terminal-grammar.md` and
`docs/decisions/2026-09-01-the-brainless-palette-and-one-mono-face.md`.

The panel reads. The two things it writes are an answer record and a merge
order, both through one file, and the page executes nothing - the fleet's own
guarded commands do the acting. See
`docs/decisions/2026-08-30-answering-a-held-decision.md` and
`docs/decisions/2026-08-31-ordering-a-merge.md` before touching that path. A
worker card also opens that worker's terminal on demand, read only and never on
the first paint; see `docs/decisions/2026-08-31-the-worker-terminal.md` before
touching that one.

A red error on a healthy panel is a defect even when nothing failed: React says
`The destination stream closed early.` whenever a page stops listening while its
refresh is still rendering, and `src/providers/logger.ts` claims that one
sentence and says what it means. See
`docs/decisions/2026-09-01-the-error-that-is-a-page-leaving.md` before adding a
second claim, or before assuming this one is a shutdown fault.

The panel must stop when it is asked to. The change signal is a response that
never finishes on its own, and Next's shutdown waits for every open connection,
so anything that holds a connection open past a request has to close itself on
the stop - `src/runtime/shutdown.ts` is where that is registered, and
`docs/decisions/2026-09-01-stopping-the-panel.md` is why.

## Map

| Where                                                | What is there                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/types/`                                         | The document the UI reads, the terminal tail beside it, and the fleet-selection cookie's name. Imports nothing.   |
| `src/config/`                                        | Environment and defaults. The port derivation lives here.                                                         |
| `src/adapters/`                                      | The only I/O. Five files, and the forge is the only one that leaves this machine.                                 |
| `src/domain/`                                        | The projection: snapshot to document. Pure.                                                                       |
| `src/runtime/`                                       | Watch, coalesce, cache, publish the change signal.                                                                |
| `src/ui/`                                            | Server-rendered components. Reads the document, plus the terminal a card opens on demand. One directory per lens. |
| `src/providers/`                                     | The clock, the logger and the one spawn door, as dependencies.                                                    |
| `src/app/`, `src/proxy.ts`, `src/instrumentation.ts` | Next's routes, middleware and the stop path: the composition point.                                               |
| `fixtures/`                                          | Synthetic fleets, up to three files per set. Zero real data, by rule.                                             |
| `tests/`                                             | Behavioural tests against the built server, the invariant checks, and a pure-projection walk of every fixture.    |

## Run it

```sh
npm install && npm run build   # once
npm start                      # builds if needed, prints the URL it bound
npm test                       # lints, checks the invariants, drives the built server
qlty fmt                       # format: prettier is qlty's, not npm's
qlty check --all               # markdownlint, actionlint, yamllint, gitleaks, knip
bin/qlty-smells-gate           # duplication and complexity, as a verdict
```

The last three are what CI gates on, and `npm test` does not run them. Format
before you push or the `quality` job fails.

`QUARTERDECK_FLEET_HOME` points the panel at real fleet homes; unset, it reads
synthetic fixture sets picked by `QUARTERDECK_FIXTURE_SET`. Both take a
colon-separated list, and the operator switches between them in the panel; the
choice is remembered in their browser. See `fixtures/README.md`.

`QUARTERDECK_INTENT_DIR` is what lights the answer and merge controls up: a
colon-separated list too, one slot per configured fleet in the same order, each
naming the directory that fleet's own process-event sources watch. A fleet whose
slot is empty has no spool and both controls say so on the card instead of
acting. See the README's "Letting the panel answer and merge" for the operator's
copy of this, and `docs/contract.md` for the bytes each record carries.

`QUARTERDECK_READ_TIMEOUT_MS` is the budget one fleet read gets, 20s by
default. It is a measured number, not a taste: a fleet snapshot costs about a
second per live worker in series, and upstream bounds each of those at fourteen
seconds of its own, so a smaller budget gives up before the fleet's own deadline
can fire. A read that outruns it says the fleet timed out - which is a different
fact from a fleet that failed, and the page says which - keeps the last good
picture, and holds the next attempt off rather than letting every render start
another. Read
`docs/decisions/2026-09-01-the-fleet-read-budget-and-what-a-timeout-means.md`
before changing any of that; two of the three faults behind it are upstream's
and are named there.

`QUARTERDECK_READ_FORGE` is the one setting that turns on a network call: a pull
request's checks and its review comments, read through `gh`. Off by default,
never on the first paint, and never more than once a minute per pull request -
see `docs/decisions/2026-08-31-reading-the-forge.md`.

qlty owns the formatter and five checks, and CI fails on all of them. prettier
comes from qlty and not from `package.json`, pinned, so `qlty fmt` is the only
way to format this tree. eslint is the one thing qlty does not touch: it stays
on npm behind `npm run lint`, which `pretest` chains. `qlty metrics --all -d`
prints size and complexity per directory and gates nothing.

Two paths are excluded from qlty entirely: `**/*.d.ts`, and
`tests/violations/**`. That second one is load-bearing, because the invariant
checks read those files as text and assert the line each planted fault sits on.
Everything else qlty is told to overlook is scoped to one plugin, or listed in
`bin/qlty-smells-gate` with the argument for keeping it. Nine findings are kept
there. Add a tenth only with its reason, and read
`docs/decisions/2026-08-31-measuring-duplication-and-complexity.md` and
`docs/decisions/2026-08-31-what-the-parallel-lens-build-duplicated.md` first.

## Read before changing anything

- `docs/ARCHITECTURE.md` - the layers, the seven invariants, and why each exists.
- `docs/principles.md` - the mechanical rules a cleanup pass enforces.
- `docs/contract.md` - the document schema and the upstream contract it is
  pinned to.
- `docs/decisions/` - one dated file per settled decision, with its trade-offs.
- `docs/plans/active/` - what is being built now. `docs/plans/done/` is the memory.
- `docs/quality.md` - a grade per area, and where the gaps are.

The invariants are checked by `npm test`, not by memory. A violation prints the
rule, why it exists, and the edit that fixes it.

## Maintaining this file

Keep it a map. It earns its length by pointing at the file that has the detail,
never by repeating it: a long instruction file crowds out the actual task, makes
everything sound equally important, rots because nobody maintains it, and cannot
be checked mechanically. Add a row when a new top-level directory appears;
otherwise write the knowledge into `docs/` and leave this alone.
