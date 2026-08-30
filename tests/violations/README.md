# Planted violations

Each directory here is a deliberately broken `src/` tree: one per invariant
check, shaped so that exactly one check fires on it.

They exist because the checks are the foundation everything else rests on. A
check that silently stopped matching would let every rule it guards rot without
anyone noticing, and a green suite would be worse than no suite at all. So the
suite runs each check twice: against the real `src/`, asserting silence, and
against the tree below, asserting it reports the planted fault in the documented
message shape.

These are not compiled or linted - see the `tests/violations` entries in
`tsconfig.json` and `eslint.config.mjs`. They are read as text by the checks.
