# Active plans

Nothing is in flight. The skeleton is complete; see
`docs/plans/done/2026-08-30-skeleton.md`.

A plan here is one file: what is being built, why now, and a decision log
appended as choices are settled. When it lands, move the file to
`docs/plans/done/` rather than deleting it - that directory is the project's
memory of why things are the way they are, and the decision logs are the part
nobody can reconstruct from the code.

## What comes next, roughly in order

The skeleton's shape was chosen with these in mind, but none is planned yet.

1. **A real fleet source.** The injected-source position in
   `src/adapters/contract.ts` has exactly one implementation. Adding a second is
   where `adapters/health.ts` gets tested for the behaviour it exists for:
   degrading to `unknown` rather than throwing when a path moves.
2. **The write path.** `src/adapters/intent.ts` holds the type and the marker.
   The guard in front of `/api/act` already exists; what is missing is getting
   the session secret to the page and an endpoint that does something.
3. **The deck lens**, then **shipshape**.
4. **The fleet lens as designed** - lifecycle rail, lanes, filters - which is
   the first thing to ask real questions of the theme and the layering.
