# quarterdeck

A local command panel giving its operator visibility into a running firstmate
fleet: what is running (fleet), what is queued or held for a decision (deck),
and whether the machinery is healthy (shipshape). The fleet lens draws a worker
card and lifecycle rail; the deck and shipshape lenses are still placeholders.
All three sit over a frozen document shape, filled from synthetic fixtures
rather than a real fleet.

## Map

| Where | What is there |
| --- | --- |
| `src/types/` | The document the UI reads. Imports nothing. |
| `src/config/` | Environment and defaults. The port derivation lives here. |
| `src/adapters/` | The only I/O. Exactly three files. |
| `src/domain/` | The projection: snapshot to document. Pure. |
| `src/runtime/` | Watch, coalesce, cache, publish the change signal. |
| `src/ui/` | Server-rendered components. Reads the document, nothing else. One directory per lens. |
| `src/providers/` | The clock and the logger, as dependencies. |
| `src/app/`, `src/proxy.ts` | Next's routes and middleware: the composition point. |
| `fixtures/` | Synthetic fleets, two files per set. Zero real data, by rule. |
| `tests/` | Behavioural tests against the built server, the invariant checks, and a pure-projection walk of every fixture. |

## Run it

```sh
npm install && npm run build   # once
npm start                      # builds if needed, prints the URL it bound
npm test                       # lints, checks the invariants, drives the built server
```

`QUARTERDECK_FIXTURE_SET` picks the fleet; see `fixtures/README.md`.

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
