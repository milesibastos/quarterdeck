# The invariants are checks, not conventions

Date: 2026-08-30
Status: accepted

## Context

A rule that lives in a document is a rule an agent will follow until the first
time following it is inconvenient. There will be no reviewer present for most
changes to this repository.

## Decision

Each invariant is a function over a source tree returning violations, wired into
`npm test`. Each has a deliberately broken tree under `tests/violations/` and a
test asserting the check reports it in the documented message shape.

Every message states what broke, why the rule exists, and the edit that fixes
it, produced by one formatter so a new check cannot invent a new format.

## Why the checks are themselves tested

This is the part that is easy to skip and expensive to skip. Everything else
rests on these checks, so a check that silently stopped matching - a regex that
no longer fires after a refactor, a path assumption that broke when a directory
moved - would let every rule it guards rot while the suite stayed green. That is
strictly worse than having no check, because it also removes the suspicion that
would make somebody look. So each check takes a root directory rather than
hardcoding `src/`, purely so it can be pointed at a tree planted to break it.

## Trade-offs

**Written as a `node:test` structural check, not ESLint rules.** ESLint would
give in-editor feedback and per-line suppression. It would also mean writing
custom rules in a plugin, and the message shape the brief specifies is not the
shape ESLint prints. A plain function over the file list is a tenth of the code
and produces the exact output required. The cost is no editor squiggle: an agent
finds out at `npm test` rather than while typing.

**Text matching, not an AST.** The checks read imports and identifiers with
regular expressions over comment-stripped source. An AST would be exact. Two
things made text matching the better trade here: it is a fraction of the code,
and every false positive it produced during this task was a real signal - a
generic word in the deny-list matching a Tailwind class name, a loopback URL in
a field nothing used. The cost is that a determined author can evade it, and
that a novel syntax could slip past. The mitigation is that the checks fire on
the shapes an agent actually writes, and that evading one is a deliberate act
rather than an accident.

**One check beyond the seven.** `provider-bypass` bans `Date.now()`,
`new Date()` and `console.*` outside `src/providers/`. The brief names this as
the reason `src/providers/` exists but does not list it as an invariant; making
it mechanical cost fifteen lines and removes the only way to quietly undo the
providers layer.
