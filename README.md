# quarterdeck

A local command panel for a firstmate fleet: what is running now, what is queued
or held for a decision, and whether the machinery supervising it all is healthy.

Today the fleet lens draws a worker card and lifecycle rail per piece of work
under way; the deck and shipshape lenses are still placeholders. All three sit
over a frozen document shape, filled from a synthetic fixture fleet. It does
not read a real fleet and it cannot change anything.

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
