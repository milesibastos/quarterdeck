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

**Text matching, not an AST - but over TypeScript's own tokens.** The checks
read imports and identifiers with regular expressions over comment-stripped
source. That comment-stripping step was originally hand-rolled, and it produced
three real bugs across three review rounds: block comments shifting reported
line numbers, a protocol-relative URL literal made invisible by the same
stripping it was meant to survive, and - the one that settled it - quote
tracking that desynced on a plain apostrophe in JSX prose, silently
misclassifying every string and comment after it in the file. Each fix repaired
one instance of the same class rather than the class itself, which is what a
hand-rolled lexer costs: it re-derives JavaScript's grammar by hand and gets
charged for every corner of it, one incident at a time. The comment and string
classification now asks `ts.createSourceFile` directly, which already
implements that grammar - JSX, template literals, regex literals - correctly,
given the right `ScriptKind`. A fourth bug, after the switch, showed that
"the right one" is not automatic: every file was parsed as TSX regardless of
extension, so an ordinary generic arrow in a plain `.ts` file read as an
unclosed JSX tag and swallowed the rest of that file into one text node.
`ScriptKind` is now derived from each file's real extension. The checks
themselves are still regular expressions over the resulting text; only the
token classification moved. The cost is `typescript` as a devDependency
loaded at test time, and the same residual trade the old approach had: a
determined author can still evade a regex-based check, and the mitigation is
still that doing so is a deliberate act rather than an accident.

**One check beyond the seven.** `provider-bypass` bans `Date.now()`,
`new Date()` and `console.*` outside `src/providers/`. The brief names this as
the reason `src/providers/` exists but does not list it as an invariant; making
it mechanical cost fifteen lines and removes the only way to quietly undo the
providers layer.

**A second joined it on 2026-08-31.** `raw-colour` bans a colour value in a
component for the same reason: it guards a decision - here, the theme - rather
than a layer boundary. See
`docs/decisions/2026-08-31-the-terminal-grammar.md`.
