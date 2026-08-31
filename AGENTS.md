# quarterdeck

A local command panel giving its operator visibility into a running firstmate
fleet: what is running (fleet), what is queued or held for a decision (deck),
and whether the machinery is healthy (shipshape). The fleet lens draws a worker
card and lifecycle rail, the deck lens draws its four piles and offers an
answer control on work held for a person, and the shipshape lens draws the
five health signals and the designed dark state. All three sit over a pinned
document shape, filled from a configured fleet home or from synthetic fixtures
when there is none. The operator picks which of the configured fleets they are
looking at, and their browser remembers it.

The panel reads. The one thing it writes is an answer record, and the page
executes nothing - see
`docs/decisions/2026-08-30-answering-a-held-decision.md` before touching that
path. A worker card also opens that worker's terminal on demand, read only and
never on the first paint; see `docs/decisions/2026-08-31-the-worker-terminal.md`
before touching that one.

## Map

| Where | What is there |
| --- | --- |
| `src/types/` | The document the UI reads, the terminal tail beside it, and the fleet-selection cookie's name. Imports nothing. |
| `src/config/` | Environment and defaults. The port derivation lives here. |
| `src/adapters/` | The only I/O. Five files, and the forge is the only one that leaves this machine. |
| `src/domain/` | The projection: snapshot to document. Pure. |
| `src/runtime/` | Watch, coalesce, cache, publish the change signal. |
| `src/ui/` | Server-rendered components. Reads the document, plus the terminal a card opens on demand. One directory per lens. |
| `src/providers/` | The clock, the logger and the one spawn door, as dependencies. |
| `src/app/`, `src/proxy.ts` | Next's routes and middleware: the composition point. |
| `fixtures/` | Synthetic fleets, up to three files per set. Zero real data, by rule. |
| `tests/` | Behavioural tests against the built server, the invariant checks, and a pure-projection walk of every fixture. |

## Run it

```sh
npm install && npm run build   # once
npm start                      # builds if needed, prints the URL it bound
npm test                       # lints, checks the invariants, drives the built server
```

`QUARTERDECK_FLEET_HOME` points the panel at real fleet homes; unset, it reads
synthetic fixture sets picked by `QUARTERDECK_FIXTURE_SET`. Both take a
colon-separated list, and the operator switches between them in the panel; the
choice is remembered in their browser. See `fixtures/README.md`.

`QUARTERDECK_READ_FORGE` is the one setting that turns on a network call: a pull
request's checks and its review comments, read through `gh`. Off by default,
never on the first paint, and never more than once a minute per pull request -
see `docs/decisions/2026-08-31-reading-the-forge.md`.

## Read before changing anything

- `docs/ARCHITECTURE.md` - the layers, the seven invariants, and why each exists.
- `docs/principles.md` - the mechanical rules a cleanup pass enforces.
- `docs/contract.md` - the document schema and the upstream contract it is pinned to.
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
