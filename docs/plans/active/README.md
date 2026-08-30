# Active plans

Nothing is in flight. The document seam is frozen; see
`docs/plans/done/2026-08-30-document-seam.md`, and the skeleton before it.

A plan here is one file: what is being built, why now, and a decision log
appended as choices are settled. When it lands, move the file to
`docs/plans/done/` rather than deleting it - that directory is the project's
memory of why things are the way they are, and the decision logs are the part
nobody can reconstruct from the code.

## What comes next

Four workers, two on each side of the document, able to run at the same time
because the shape between them is frozen and the build enforces it. Each owns
files nobody else touches.

1. **A real fleet source.** The injected-source position in
   `src/adapters/contract.ts` has exactly one implementation. Adding a second is
   where `adapters/health.ts` gets tested for the behaviour it exists for:
   degrading rather than throwing when a path moves. The open assumptions at the
   end of `docs/contract.md` are this worker's list.
2. **The fleet lens** - `src/ui/fleet/` - lifecycle rail, lanes, filters. The
   first thing to ask real questions of the theme and the layering.
3. **The deck lens** - `src/ui/deck/`.
4. **The shipshape lens** - `src/ui/shipshape/`.

Then, and not in parallel with those:

5. **The write path.** `src/adapters/intent.ts` holds the type and the marker.
   The guard in front of `/api/act` already exists; what is missing is getting
   the session secret to the page and an endpoint that does something.
6. **The shell's proportions and fold line**, which need real lens content
   before they can be tuned.
