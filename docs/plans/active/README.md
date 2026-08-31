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

The deck lens has landed - see `docs/plans/done/2026-08-30-deck-lens.md`. The
shipshape lens has landed too - see
`docs/plans/done/2026-08-30-shipshape-lens.md`. The write path has landed too -
see `docs/decisions/2026-08-30-answering-a-held-decision.md`.

Then, and not in parallel with those:

2. **The shell's proportions and fold line**, which need real lens content
   before they can be tuned.
