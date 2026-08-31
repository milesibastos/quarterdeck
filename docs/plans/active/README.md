# Active plans

Nothing is in flight. The document seam is frozen; see
`docs/plans/done/2026-08-30-document-seam.md`, and the skeleton before it.

A plan here is one file: what is being built, why now, and a decision log
appended as choices are settled. When it lands, move the file to
`docs/plans/done/` rather than deleting it - that directory is the project's
memory of why things are the way they are, and the decision logs are the part
nobody can reconstruct from the code.

## What comes next

The fleet and deck parts of the document now come from a real fleet home, or
from fixtures when none is configured - see `docs/contract.md` and
`docs/quality.md`. What is left, each item owning files nobody else touches:

1. **The fleet lens** - `src/ui/fleet/` - has its worker card and lifecycle
   rail; lanes and filters remain. The first to ask real questions of the theme
   and the layering.
2. **The shipshape lens** - `src/ui/shipshape/`, which needs `adapters/health.ts`
   pointed at what a live fleet actually publishes - it currently finds no file
   in a fleet home and goes dark, correctly, by its own contract.

The deck lens has landed - see `docs/plans/done/2026-08-30-deck-lens.md`.

Then, and not in parallel with those:

3. **The write path.** `src/adapters/intent.ts` holds the type and the marker.
   The guard in front of `/api/act` already exists; what is missing is getting
   the session secret to the page and an endpoint that does something.
4. **The shell's proportions and fold line**, which need real lens content
   before they can be tuned.
