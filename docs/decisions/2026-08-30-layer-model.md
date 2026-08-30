# Six layers, one direction, plus two positions off the line

Date: 2026-08-30
Status: accepted

## Context

Agents will maintain this for years. An agent reproduces the patterns it finds,
so a shortcut taken once becomes the house style. The failure mode this guards
against is not a bad commit; it is twenty reasonable commits that together turn
the panel into one module where everything can reach everything.

## Decision

    types -> config -> adapters -> domain -> runtime -> ui

Dependencies point forward only. `src/providers/` is a single door for the clock
and the logger, importable from anywhere. `src/app/` and `src/proxy.ts` are the
composition point. The permission table lives in `tests/lib/invariants.ts` and
is checked on every test run.

## The two judgement calls

**`src/app/` is a seventh position, not part of `src/ui/`.** The brief puts
pages in `src/ui/`, but invariant 6 says `src/ui/` may import only the document
type and providers - and a page has to read the fleet from somewhere. Next also
owns the `app/` directory name. Rather than weaken invariant 6 or fight the
framework, the route files are a position outside the six that may import from
all of them, and they stay thin: read, translate, hand to a component. The cost
is one more position to explain, and the discipline that route files stay thin
is checked by nothing.

**`src/domain/` may import `src/adapters/` with `import type`.** The projection
needs the snapshot's shape, and the alternatives are worse: moving the upstream
shape into `src/types/` would put an upstream concern in the file that defines
the panel's own document and would let `src/ui/` import it, or duplicating the
shape would create two definitions that drift silently. A type-only import is
erased before anything runs, so it cannot carry behaviour across the boundary,
and invariant 2 - no `node:*` in domain, at all - independently guarantees the
purity that matters. The cost is one exemption in the checker, and a rule with
an exemption is a rule people misremember; the checker's message names it.

## Rejected

**One flat `src/` with conventions.** This is what the invariants exist to
prevent, and it is exactly what an agent will drift back toward.

**Enforcing the layers with a package-per-layer workspace.** Real enforcement
from the module resolver rather than from a test. Rejected as far too much
machinery for a skeleton, and it would not have expressed the type-only
exemption or invariants 3 through 7 at all.
