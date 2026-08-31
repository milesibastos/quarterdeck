# quarterdeck

A local command panel for a firstmate fleet: what is running now, what is queued
or held for a decision, and whether the machinery supervising it all is healthy.

Today the fleet lens draws a worker card and lifecycle rail per piece of work
under way, the deck lens draws its four piles - held, blocked, queued, in
flight - and offers a control to answer work held for a person, and the
shipshape lens draws the three health signals and its own dark state. All
three read from a configured fleet home, or from a synthetic fixture fleet
when none is configured - see `fixtures/README.md` for
`QUARTERDECK_FLEET_HOME`. An operator with more than one configured fleet
picks which they are looking at, and their browser remembers it. The panel
still executes nothing: answering a decision writes a durable record for the
fleet to pick up, never a command the page runs itself - see
`docs/decisions/2026-08-30-answering-a-held-decision.md`.

## Run it

Requires Node 24.

```sh
npm install
npm start          # builds if needed, then prints the URL it bound
```

The port is derived from this worktree's absolute path, so two checkouts can run
side by side and each always answers on the same URL.

```sh
QUARTERDECK_FIXTURE_SET=stale npm start   # see fixtures/README.md for the sets
npm test                                  # lint, invariant checks, built server
```

## Where things are

`AGENTS.md` is the map. `docs/ARCHITECTURE.md` has the six layers, the seven
invariants, and why each one exists.

The invariants are checked by `npm test`, not by convention: dependencies point
one direction, the projection does no I/O, exactly one file may write anything,
one file may name fleet-internal paths, the upstream contract is pinned and
refuses loudly when it changes, components read only the document, and nothing
is fetched from the network at runtime.
